import { ErrorNotice } from "../error-state";
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
    prefix: "",
    start: 1,
    padding: 4,
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
  const entity = catalog.data?.entities.find((candidate) => candidate.code === code);
  const subtypes = (catalog.data?.entities || []).filter((candidate) => candidate.parent === entity?.id);
  const numbered = new Set(numbering.data?.results.map((rule) => rule.field));
  // Only empty text columns of this form can carry automatic numbers.
  const numberableColumns = (schema.data?.fields || []).filter(
    (field) =>
      !field.code.includes(".") &&
      field.code !== entity?.title_field &&
      !numbered.has(field.code) &&
      fields.data?.find((definition) => definition.code === field.code)?.kind === "short_text"
  );
  const [newColumn, setNewColumn] = useState(false);
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
              <p>مثلاً اجازه ندهید دو مشتری با یک کد ملی ثبت شوند.</p>
            </div>
            <span className="engine-rules-count">
              {(unique.data?.results.length || 0).toLocaleString("fa-IR")} قاعده
            </span>
          </header>
          <ErrorNotice message={unique.error && errorMessage(unique.error, "دریافت قواعد یکتایی انجام نشد.")} />
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
                  <p>اگر چند ستون انتخاب کنید، ترکیب آن‌ها نباید تکراری باشد.</p>
                </div>
              </div>
              <label>
                نام قاعده
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={255}
                  placeholder="مثلاً کد ملی تکراری نباشد"
                />
              </label>
              <SearchableSelect
                showLabel
                label="کدام ستون نباید تکراری باشد؟"
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
                showLabel
                label="اگر رکورد تکراری ثبت شد"
                value={mode}
                options={[
                  { id: "block", title: "اجازه ثبت نده" },
                  { id: "warn", title: "هشدار بده ولی اجازه ثبت بده" },
                ]}
                onChange={setMode}
              />
              <Button
                disabled={!title.trim() || !selected.length || mutation.isPending}
                onClick={() => void saveUnique()}
              >
                ذخیره قاعده
              </Button>
              <ErrorNotice message={uniqueError} />
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
              <p>به هر رکورد جدید یک شماره ترتیبی مثل INV-0001 بدهید.</p>
            </div>
            <span className="engine-rules-count">
              {(numbering.data?.results.length || 0).toLocaleString("fa-IR")} ستون
            </span>
          </header>
          <ErrorNotice message={numbering.error && errorMessage(numbering.error, "دریافت شماره‌گذاری انجام نشد.")} />
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
                  <p>رکوردهای قبلی هم شماره می‌گیرند؛ قبل از تأیید، پیش‌نمایش را ببینید.</p>
                </div>
              </div>
              <div className="engine-rules-fields">
                {editing ? (
                  <div className="engine-rules-column-readonly">
                    <span>ستون</span>
                    <strong>{number.title}</strong>
                  </div>
                ) : (
                  <>
                    <SearchableSelect
                      showLabel
                      label="کدام ستون شماره خودکار بگیرد؟"
                      value={newColumn ? "__new__" : number.field}
                      options={[
                        ...numberableColumns.map((column) => ({ id: column.code, title: column.title })),
                        { id: "__new__", title: "+ ساخت ستون جدید" },
                      ]}
                      onChange={(value) => {
                        if (value === "__new__") {
                          setNewColumn(true);
                          updateNumber({ field: `auto_number_${crypto.randomUUID().slice(0, 6)}`, title: "" });
                        } else {
                          setNewColumn(false);
                          const column = numberableColumns.find((item) => item.code === value);
                          updateNumber({ field: value, title: column?.title || "" });
                        }
                      }}
                    />
                    {newColumn && (
                      <label>
                        نام ستون جدید
                        <input
                          value={number.title}
                          placeholder="مثلاً شماره قرارداد"
                          onChange={(event) => updateNumber({ title: event.target.value })}
                        />
                      </label>
                    )}
                  </>
                )}
                <label>
                  پیشوند (اختیاری)
                  <input
                    dir="ltr"
                    value={number.prefix}
                    placeholder="INV-"
                    onChange={(event) => updateNumber({ prefix: event.target.value })}
                    maxLength={60}
                  />
                </label>
                <label>
                  اولین شماره
                  <input
                    type="number"
                    min={1}
                    value={number.start}
                    onChange={(event) => updateNumber({ start: Number(event.target.value) })}
                  />
                </label>
                <label>
                  حداقل تعداد رقم (با صفر پر می‌شود)
                  <input
                    type="number"
                    min={0}
                    max={18}
                    value={number.padding}
                    onChange={(event) => updateNumber({ padding: Number(event.target.value) })}
                  />
                </label>
                {subtypes.map((subtype) => (
                  <label key={subtype.id}>
                    پیشوند {subtype.title}
                    <input
                      dir="ltr"
                      value={number.subtype_prefixes[subtype.code] ?? number.prefix}
                      onChange={(event) =>
                        updateNumber({
                          subtype_prefixes: { ...number.subtype_prefixes, [subtype.code]: event.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                {subtypes.length > 0 && (
                  <label className="engine-checkbox">
                    <input
                      type="checkbox"
                      checked={number.shared_sequence}
                      onChange={(event) => updateNumber({ shared_sequence: event.target.checked })}
                    />
                    همه نوع‌های فرعی از یک شمارنده مشترک استفاده کنند
                  </label>
                )}
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
                  disabled={!number.field || !number.title.trim() || mutation.isPending}
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
              <ErrorNotice message={mutation.error && errorMessage(mutation.error, "عملیات انجام نشد.")} />
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
            <ErrorNotice message={errorMessage(settings.error || mutation.error, "ذخیره تنظیمات انجام نشد.")} />
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
