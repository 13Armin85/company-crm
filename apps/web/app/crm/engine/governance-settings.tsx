import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { Button } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useEngineCatalog, useEngineQuery, useEngineMutation } from "./api";
import type { FieldDefinition } from "./api";

type UniqueRule = {
  id: string;
  title: string;
  fields: string[];
  mode: "block" | "warn";
  is_active: boolean;
  existing_policy: "resolve" | "new_only";
};
type NumberingRule = {
  id: string;
  field: string;
  title: string;
  prefix: string;
  start: number;
  padding: number;
  next: string;
  shared_sequence: boolean;
  subtype_prefixes: Record<string, string>;
};

export function EntityRules({ code, mode: panel = "all" }: { code: string; mode?: "all" | "unique" | "numbering" }) {
  const { data: access } = useWorkspaceAccess();
  const mutation = useEngineMutation();
  const catalog = useEngineCatalog();
  const fields = useEngineQuery<FieldDefinition[]>("fields", "definitions/fields/", Boolean(access?.can("Field.View")));
  const schema = useEngineQuery<{ fields: { code: string; title: string }[] }>(
    "view-schema",
    `entities/${code}/view-schema/`
  );
  const unique = useEngineQuery<{ results: UniqueRule[] }>(
    "unique-rules",
    `entities/${code}/unique-rules/`,
    Boolean(access?.can("UniqueRule.Manage"))
  );
  const numbering = useEngineQuery<{ results: NumberingRule[] }>(
    "numbering-rules",
    `entities/${code}/numbering-rules/`,
    Boolean(access?.can("NumberingRule.Manage"))
  );
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState("block");
  const [conflicts, setConflicts] = useState<Record<string, unknown>[]>([]);
  const [uniqueError, setUniqueError] = useState("");
  const [number, setNumber] = useState({
    field: "",
    title: "",
    prefix: "TT",
    start: 1921,
    padding: 0,
    shared_sequence: true,
    subtype_prefixes: {} as Record<string, string>,
  });
  const [preview, setPreview] = useState<{
    count: number;
    sample: { id: string; number: string }[];
    confirmation_token: string;
  } | null>(null);
  const [editing, setEditing] = useState<NumberingRule | null>(null);
  const saveUnique = async (existing_policy = "resolve") => {
    setUniqueError("");
    try {
      await mutation.mutateAsync({
        path: `entities/${code}/unique-rules/`,
        data: { title, fields: selected, mode, existing_policy },
      });
      setTitle("");
      setSelected([]);
      setConflicts([]);
    } catch (error) {
      const data = (error as { response?: { data?: { duplicates?: Record<string, unknown>[] } } }).response?.data;
      setConflicts(data?.duplicates || []);
      setUniqueError(errorMessage(error, "ذخیره قاعده انجام نشد."));
    }
  };
  const updateNumber = (patch: Partial<typeof number>) => {
    setNumber({ ...number, ...patch });
    setPreview(null);
  };
  return (
    <div className="engine-editor-grid">
      {panel !== "numbering" && access?.can("UniqueRule.Manage") && (
        <section className="engine-view-settings">
          <h3>جلوگیری از رکورد تکراری</h3>
          {unique.error && <p role="alert">{errorMessage(unique.error, "دریافت قواعد یکتایی انجام نشد.")}</p>}
          {unique.data?.results.map((rule) => (
            <div key={rule.id} className="engine-view-rule">
              <strong>{rule.title}</strong>
              <p>
                {rule.fields
                  .map((fieldCode) => schema.data?.fields.find((field) => field.code === fieldCode)?.title || fieldCode)
                  .join(" + ")}{" "}
                · {rule.mode === "block" ? "مسدود کن" : "هشدار بده"}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  if (window.confirm(rule.is_active ? "قاعده یکتایی غیرفعال شود؟" : "قاعده یکتایی فعال شود؟"))
                    void mutation
                      .mutateAsync({
                        path: `entities/${code}/unique-rules/${rule.id}/`,
                        method: "patch",
                        data: { is_active: !rule.is_active },
                      })
                      .catch(() => {});
                }}
              >
                {rule.is_active ? "غیرفعال کردن" : "فعال کردن"}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void mutation
                    .mutateAsync({
                      path: `entities/${code}/unique-rules/${rule.id}/`,
                      method: "patch",
                      data: { mode: rule.mode === "block" ? "warn" : "block" },
                    })
                    .catch(() => {})
                }
              >
                تغییر به {rule.mode === "block" ? "هشدار" : "مسدودسازی"}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm("قاعده یکتایی حذف شود؟"))
                    void mutation
                      .mutateAsync({ path: `entities/${code}/unique-rules/${rule.id}/`, method: "delete" })
                      .catch(() => {});
                }}
              >
                حذف
              </Button>
            </div>
          ))}
          <label>
            نام گروه یکتا
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} />
          </label>
          <SearchableSelect
            label="افزودن ستون به گروه"
            value=""
            options={(schema.data?.fields || [])
              .filter((field) => !field.code.includes(".") && !selected.includes(field.code))
              .map((field) => ({ id: field.code, title: field.title }))}
            onChange={(field) => setSelected([...selected, field])}
          />
          {selected.map((fieldCode) => (
            <Button
              key={fieldCode}
              variant="ghost"
              onClick={() => setSelected(selected.filter((field) => field !== fieldCode))}
            >
              {schema.data?.fields.find((field) => field.code === fieldCode)?.title || fieldCode} ×
            </Button>
          ))}
          <SearchableSelect
            label="روش اجرا"
            value={mode}
            options={[
              { id: "block", title: "مسدود کن" },
              { id: "warn", title: "فقط هشدار بده و اجازه ثبت بده" },
            ]}
            onChange={setMode}
          />
          <Button disabled={!title.trim() || !selected.length || mutation.isPending} onClick={() => void saveUnique()}>
            ثبت گروه یکتا
          </Button>
          {uniqueError && <p role="alert">{uniqueError}</p>}
          {conflicts.length > 0 && (
            <div role="alert">
              <p>گروه‌های تکراری موجود:</p>
              {conflicts.map((group) => (
                <p key={JSON.stringify(group)}>
                  {Object.entries(group)
                    .filter(([key]) => key.startsWith("_unique"))
                    .map(([, value]) => String(value))
                    .join(" + ")}{" "}
                  · {String(group.count)} رکورد
                </p>
              ))}
              <Button variant="secondary" onClick={() => setConflicts([])}>
                اول رفع کنم
              </Button>
              <Button onClick={() => void saveUnique("new_only")}>فقط برای رکوردهای جدید اعمال شود</Button>
            </div>
          )}
        </section>
      )}
      {panel !== "unique" && access?.can("NumberingRule.Manage") && (
        <section className="engine-view-settings">
          <h3>ستون‌های شماره‌گذاری خودکار</h3>
          {numbering.error && <p role="alert">{errorMessage(numbering.error, "دریافت شماره‌گذاری انجام نشد.")}</p>}
          {numbering.data?.results.map((rule) => (
            <div className="engine-view-rule" key={rule.id}>
              <strong>{rule.title}</strong>
              <p>
                رکورد بعدی: <bdi>{rule.next}</bdi>
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(rule);
                  setNumber({ ...rule });
                  setPreview(null);
                }}
              >
                تنظیمات
              </Button>
            </div>
          ))}
          <label>
            عنوان ستون
            <input
              value={number.title}
              disabled={Boolean(editing)}
              onChange={(event) => updateNumber({ title: event.target.value })}
            />
          </label>
          {!editing && (
            <label>
              کد انگلیسی ستون
              <input dir="ltr" value={number.field} onChange={(event) => updateNumber({ field: event.target.value })} />
            </label>
          )}
          <label>
            پیشوند
            <input
              dir="ltr"
              value={number.prefix}
              onChange={(event) => updateNumber({ prefix: event.target.value })}
              maxLength={60}
            />
          </label>
          <label>
            شروع توالی
            <input
              type="number"
              min={1}
              value={number.start}
              onChange={(event) => updateNumber({ start: Number(event.target.value) })}
            />
          </label>
          <label>
            تعداد ارقام؛ صفر یعنی بدون صفر پیشرو
            <input
              type="number"
              min={0}
              max={18}
              value={number.padding}
              onChange={(event) => updateNumber({ padding: Number(event.target.value) })}
            />
          </label>
          {(catalog.data?.entities || [])
            .filter(
              (entity) => entity.parent === catalog.data?.entities.find((candidate) => candidate.code === code)?.id
            )
            .map((entity) => (
              <label key={entity.id}>
                پیشوند {entity.title}
                <input
                  value={number.subtype_prefixes[entity.code] ?? number.prefix}
                  onChange={(event) =>
                    updateNumber({
                      subtype_prefixes: { ...number.subtype_prefixes, [entity.code]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
          <label className="engine-checkbox">
            <input
              type="checkbox"
              checked={number.shared_sequence}
              onChange={(event) => updateNumber({ shared_sequence: event.target.checked })}
            />
            توالی عددی مشترک زیرنوع‌ها
          </label>
          <p>
            نمونه رکورد بعدی:{" "}
            <bdi>
              {number.prefix}
              {String(number.start).padStart(number.padding, "0")}
            </bdi>
          </p>
          {editing ? (
            <>
              <Button
                disabled={mutation.isPending}
                onClick={() =>
                  void mutation
                    .mutateAsync({
                      path: `entities/${code}/numbering-rules/${editing.id}/`,
                      method: "patch",
                      data: number,
                    })
                    .then(() => setEditing(null))
                    .catch(() => {})
                }
              >
                ذخیره تنظیمات شماره‌گذاری
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                انصراف
              </Button>
            </>
          ) : (
            <Button
              disabled={
                !number.field ||
                !number.title ||
                mutation.isPending ||
                fields.data?.some((field) => field.code === number.field)
              }
              onClick={() =>
                void mutation
                  .mutateAsync({ path: `entities/${code}/numbering-rules/`, data: { ...number, action: "preview" } })
                  .then((result) => setPreview(result as NonNullable<typeof preview>))
                  .catch(() => {})
              }
            >
              پیش‌نمایش شماره‌دهی
            </Button>
          )}
          {preview && (
            <div>
              <p>{preview.count.toLocaleString("fa-IR")} رکورد قدیمی شماره می‌گیرند.</p>
              {preview.sample.map((row) => (
                <p key={row.id}>
                  <bdi>{row.number}</bdi>
                </p>
              ))}
              <Button
                disabled={mutation.isPending}
                onClick={() => {
                  if (window.confirm("شماره‌دهی رکوردهای قدیمی طبق این پیش‌نمایش اجرا شود؟"))
                    void mutation
                      .mutateAsync({
                        path: `entities/${code}/numbering-rules/`,
                        data: { ...number, confirmation_token: preview.confirmation_token },
                      })
                      .then(() => setPreview(null))
                      .catch(() => {});
                }}
              >
                تأیید و ایجاد ستون
              </Button>
            </div>
          )}
          {mutation.error && <p role="alert">{errorMessage(mutation.error, "عملیات انجام نشد.")}</p>}
        </section>
      )}
    </div>
  );
}

export function GovernanceSettings({ generalOnly = false }: { generalOnly?: boolean } = {}) {
  const { data: access } = useWorkspaceAccess();
  const catalog = useEngineCatalog();
  const settings = useEngineQuery<{ personal_view_limit: number }>(
    "engine-settings",
    "settings/",
    Boolean(access?.can("View.Official.Manage"))
  );
  const mutation = useEngineMutation();
  const [limit, setLimit] = useState<number | null>(null);
  const [code, setCode] = useState("");
  if (!access?.can("UniqueRule.Manage") && !access?.can("NumberingRule.Manage") && !access?.can("View.Official.Manage"))
    return null;
  return (
    <section className="engine-view-settings">
      <h2>قواعد داده و جدول‌های شخصی</h2>
      {access?.can("View.Official.Manage") && (
        <div>
          <label>
            حداکثر جدول شخصی هر کاربر برای هر موجودیت
            <input
              type="number"
              min={1}
              max={1000}
              value={limit ?? settings.data?.personal_view_limit ?? 20}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
          <Button
            disabled={limit === null || mutation.isPending}
            onClick={() =>
              void mutation
                .mutateAsync({ path: "settings/", method: "put", data: { personal_view_limit: limit } })
                .catch(() => {})
            }
          >
            ذخیره سقف جدول‌ها
          </Button>
          {(settings.error || mutation.error) && (
            <p role="alert">{errorMessage(settings.error || mutation.error, "ذخیره تنظیمات انجام نشد.")}</p>
          )}
        </div>
      )}
      {!generalOnly && (
        <SearchableSelect
          label="موجودیت"
          value={code}
          options={(catalog.data?.entities || [])
            .filter((entity) => !entity.parent)
            .map((entity) => ({ id: entity.code, title: entity.title }))}
          onChange={setCode}
        />
      )}
      {!generalOnly && code && <EntityRules key={code} code={code} />}
    </section>
  );
}
