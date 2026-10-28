import { useState } from "react";
import { Hash, Plus, ShieldCheck } from "lucide-react";
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
    <div className="engine-rules-layout">
      {panel !== "numbering" && access?.can("UniqueRule.Manage") && (
        <section className="engine-rules-card" aria-labelledby="unique-rules-title">
          <header className="engine-rules-card-header">
            <span className="engine-rules-card-icon" aria-hidden="true">
              <ShieldCheck size={22} />
            </span>
            <div>
              <span className="engine-rules-eyebrow">کنترل کیفیت داده</span>
              <h3 id="unique-rules-title">جلوگیری از رکورد تکراری</h3>
              <p>ترکیبی از ستون‌ها را یکتا کنید و رفتار سیستم را هنگام ثبت رکورد مشابه تعیین کنید.</p>
            </div>
            <span className="engine-rules-count">
              {(unique.data?.results.length || 0).toLocaleString("fa-IR")} قاعده
            </span>
          </header>
          {unique.error && <p role="alert">{errorMessage(unique.error, "دریافت قواعد یکتایی انجام نشد.")}</p>}
          <div className="engine-rules-card-body">
            <div className="engine-rules-existing">
              <h4>قواعد موجود</h4>
              {!unique.data?.results.length && !unique.isLoading && (
                <p className="engine-rules-empty">هنوز قاعده‌ای تعریف نشده است.</p>
              )}
              {unique.data?.results.map((rule) => (
                <div key={rule.id} className="engine-rules-rule">
                  <div className="engine-rules-rule-heading">
                    <strong>{rule.title}</strong>
                    <span className={`engine-rules-state${rule.is_active ? " is-active" : ""}`}>
                      {rule.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </div>
                  <p>
                    {rule.fields
                      .map(
                        (fieldCode) => schema.data?.fields.find((field) => field.code === fieldCode)?.title || fieldCode
                      )
                      .join(" + ")}
                  </p>
                  <span className="engine-rules-mode">
                    {rule.mode === "block" ? "ثبت تکراری مسدود می‌شود" : "فقط هشدار نمایش داده می‌شود"}
                  </span>
                  <div className="engine-rules-rule-actions">
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
                </div>
              ))}
            </div>
            <div className="engine-rules-form">
              <div className="engine-rules-form-heading">
                <span className="engine-rules-form-icon" aria-hidden="true">
                  <Plus size={17} />
                </span>
                <div>
                  <h4>قاعده جدید</h4>
                  <p>ستون‌هایی را انتخاب کنید که ترکیبشان باید یکتا باشد.</p>
                </div>
              </div>
              <label>
                نام گروه یکتا
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={255}
                  placeholder="مثلاً کد ملی و نوع مشتری"
                />
              </label>
              <SearchableSelect
                label="افزودن ستون به گروه"
                value=""
                options={(schema.data?.fields || [])
                  .filter((field) => !field.code.includes(".") && !selected.includes(field.code))
                  .map((field) => ({ id: field.code, title: field.title }))}
                onChange={(field) => setSelected([...selected, field])}
              />
              {!!selected.length && (
                <div className="engine-rules-chips" aria-label="ستون‌های انتخاب‌شده">
                  {selected.map((fieldCode) => (
                    <button
                      key={fieldCode}
                      type="button"
                      className="engine-rules-chip"
                      aria-label={`حذف ${schema.data?.fields.find((field) => field.code === fieldCode)?.title || fieldCode} از گروه`}
                      onClick={() => setSelected(selected.filter((field) => field !== fieldCode))}
                    >
                      {schema.data?.fields.find((field) => field.code === fieldCode)?.title || fieldCode} ×
                    </button>
                  ))}
                </div>
              )}
              <SearchableSelect
                label="روش اجرا"
                value={mode}
                options={[
                  { id: "block", title: "مسدود کن" },
                  { id: "warn", title: "فقط هشدار بده و اجازه ثبت بده" },
                ]}
                onChange={setMode}
              />
              <Button
                disabled={!title.trim() || !selected.length || mutation.isPending}
                onClick={() => void saveUnique()}
              >
                ثبت گروه یکتا
              </Button>
              {uniqueError && <p role="alert">{uniqueError}</p>}
              {conflicts.length > 0 && (
                <div role="alert" className="engine-rules-conflict">
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
            </div>
          </div>
        </section>
      )}
      {panel !== "unique" && access?.can("NumberingRule.Manage") && (
        <section className="engine-rules-card" aria-labelledby="numbering-rules-title">
          <header className="engine-rules-card-header">
            <span className="engine-rules-card-icon is-numbering" aria-hidden="true">
              <Hash size={22} />
            </span>
            <div>
              <span className="engine-rules-eyebrow">شناسه‌گذاری رکورد</span>
              <h3 id="numbering-rules-title">ستون‌های شماره‌گذاری خودکار</h3>
              <p>قالب شماره، پیشوند و توالی رکوردهای جدید را تنظیم کنید.</p>
            </div>
            <span className="engine-rules-count">
              {(numbering.data?.results.length || 0).toLocaleString("fa-IR")} ستون
            </span>
          </header>
          {numbering.error && <p role="alert">{errorMessage(numbering.error, "دریافت شماره‌گذاری انجام نشد.")}</p>}
          <div className="engine-rules-card-body">
            <div className="engine-rules-existing">
              <h4>ستون‌های موجود</h4>
              {!numbering.data?.results.length && !numbering.isLoading && (
                <p className="engine-rules-empty">هنوز ستون شماره‌گذاری تعریف نشده است.</p>
              )}
              {numbering.data?.results.map((rule) => (
                <div className="engine-rules-rule" key={rule.id}>
                  <div className="engine-rules-rule-heading">
                    <strong>{rule.title}</strong>
                    <code dir="ltr">{rule.field}</code>
                  </div>
                  <p>
                    شماره بعدی: <bdi className="engine-rules-next">{rule.next}</bdi>
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
            </div>
            <div className="engine-rules-form">
              <div className="engine-rules-form-heading">
                <span className="engine-rules-form-icon" aria-hidden="true">
                  <Plus size={17} />
                </span>
                <div>
                  <h4>{editing ? "ویرایش شماره‌گذاری" : "ستون جدید"}</h4>
                  <p>پیش‌نمایش را پیش از اعمال روی رکوردهای قدیمی بررسی کنید.</p>
                </div>
              </div>
              <div className="engine-rules-fields">
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
                    <input
                      dir="ltr"
                      value={number.field}
                      onChange={(event) => updateNumber({ field: event.target.value })}
                    />
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
                    (entity) =>
                      entity.parent === catalog.data?.entities.find((candidate) => candidate.code === code)?.id
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
              </div>
              <div className="engine-rules-sample">
                <span>نمونه شماره</span>
                <bdi dir="ltr">
                  {number.prefix}
                  {String(number.start).padStart(number.padding, "0")}
                </bdi>
              </div>
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
                      .mutateAsync({
                        path: `entities/${code}/numbering-rules/`,
                        data: { ...number, action: "preview" },
                      })
                      .then((result) => setPreview(result as NonNullable<typeof preview>))
                      .catch(() => {})
                  }
                >
                  پیش‌نمایش شماره‌دهی
                </Button>
              )}
              {preview && (
                <div className="engine-rules-preview">
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
            </div>
          </div>
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
