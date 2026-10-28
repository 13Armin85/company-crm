import { useState } from "react";
import { ArrowLeftRight, GitBranch, Link2, Plus, ScanSearch } from "lucide-react";
import { SearchableSelect } from "@plane/ui";
import { Button } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useEngineCatalog, useEngineQuery, useEngineMutation } from "./api";
import type { ViewSchema } from "./view-types";

type Relation = {
  id: string;
  left_entity: string;
  right_entity: string;
  left_title: string;
  right_title: string;
  kind: string;
  left_required: boolean;
  right_required: boolean;
  on_delete: string;
  link_count: number;
};
type RelationDraft = Omit<Relation, "id" | "link_count">;

const relationKinds = [
  { id: "one_to_one", title: "یک به یک", description: "هر رکورد در هر سمت فقط به یک رکورد وصل می‌شود." },
  { id: "one_to_many", title: "یک به چند", description: "یک رکورد سمت اول می‌تواند چند رکورد سمت دوم داشته باشد." },
  { id: "many_to_one", title: "چند به یک", description: "چند رکورد سمت اول می‌توانند به یک رکورد سمت دوم وصل شوند." },
  { id: "many_to_many", title: "چند به چند", description: "رکوردهای هر دو سمت می‌توانند چند پیوند داشته باشند." },
];
const aggregationOptions = [
  { id: "single", title: "مقدار تکی" },
  { id: "count", title: "تعداد" },
  { id: "sum", title: "جمع" },
  { id: "avg", title: "میانگین" },
  { id: "min", title: "کمینه" },
  { id: "max", title: "بیشینه" },
  { id: "list", title: "فهرست مقادیر" },
];

function LookupEditor({ entityCode }: { entityCode?: string }) {
  const catalog = useEngineCatalog();
  const mutation = useEngineMutation();
  const [code, setCode] = useState(entityCode || "");
  const [prefix, setPrefix] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [aggregation, setAggregation] = useState("single");
  const fields = useEngineQuery<ViewSchema>(
    "lookup-path",
    `entities/${code}/view-schema/?${new URLSearchParams({ path: prefix })}`,
    Boolean(code)
  );
  const selectedField = fields.data?.fields.find((field) => field.code === path);

  return (
    <section className="engine-rules-card engine-relations-lookup" aria-labelledby="relation-lookup-title">
      <header className="engine-rules-card-header">
        <span className="engine-rules-card-icon is-relation-lookup" aria-hidden="true">
          <ScanSearch size={22} />
        </span>
        <div>
          <span className="engine-rules-eyebrow">نمایش داده‌های مرتبط</span>
          <h3 id="relation-lookup-title">فیلد خواندنی از ارتباط</h3>
          <p>مقدار یک فیلد مرتبط یا نتیجهٔ محاسبه روی چند رکورد را در این فرم نمایش دهید.</p>
        </div>
      </header>
      <div className="engine-relations-lookup-body">
        <div className="engine-relations-lookup-fields">
          {!entityCode && (
            <SearchableSelect
              label="فرم مقصد"
              value={code}
              options={(catalog.data?.entities || [])
                .filter((entity) => !entity.parent)
                .map((entity) => ({ id: entity.code, title: entity.title }))}
              onChange={(value) => {
                setCode(value);
                setPrefix("");
                setPath("");
              }}
            />
          )}
          {code && (
            <>
              <div className="engine-relations-path">
                <span>مسیر انتخاب‌شده</span>
                <bdi>{prefix || "همین موجودیت"}</bdi>
                {prefix && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPrefix(prefix.split(".").slice(0, -1).join("."));
                      setPath("");
                    }}
                  >
                    بازگشت یک سطح
                  </Button>
                )}
              </div>
              <SearchableSelect
                label={prefix ? "فیلد یا ادامه مسیر" : "ارتباط مبدأ"}
                value={path}
                options={(fields.data?.fields || [])
                  .filter((field) => prefix || field.kind === "relation")
                  .map((field) => ({ id: field.code, title: field.title + (field.kind === "relation" ? " ←" : "") }))}
                onChange={(value) => {
                  const field = fields.data?.fields.find((candidate) => candidate.code === value);
                  if (field?.kind === "relation" && value.split(".").length <= 3) {
                    setPrefix(value);
                    setPath("");
                    return;
                  }
                  setPath(value);
                }}
              />
              <div className="engine-relations-form-row">
                <label>
                  عنوان فیلد جدید
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={255}
                    placeholder="مثلاً تعداد قراردادها"
                  />
                </label>
                <SearchableSelect
                  label="نوع تجمیع"
                  value={aggregation}
                  options={aggregationOptions}
                  onChange={setAggregation}
                />
              </div>
              <Button
                disabled={!path || !title.trim() || mutation.isPending}
                onClick={() =>
                  void mutation
                    .mutateAsync({ path: `entities/${code}/lookup-columns/`, data: { path, title, aggregation } })
                    .then(() => {
                      setTitle("");
                      setPath("");
                      return null;
                    })
                    .catch(() => {})
                }
              >
                افزودن فیلد فقط‌خواندنی
              </Button>
            </>
          )}
          {(fields.error || mutation.error) && (
            <p role="alert">{errorMessage(fields.error || mutation.error, "افزودن فیلد خواندنی انجام نشد.")}</p>
          )}
        </div>
        <aside className="engine-relations-lookup-guide">
          <span className="engine-relations-guide-icon" aria-hidden="true">
            <Link2 size={21} />
          </span>
          <h4>از ارتباط تا ستون خواندنی</h4>
          <p>ابتدا ارتباط مبدأ را انتخاب کنید، سپس به فیلدی که می‌خواهید نمایش دهید برسید.</p>
          <div className="engine-relations-lookup-result">
            <span>پیش‌نمایش انتخاب</span>
            <strong>{title.trim() || "عنوان فیلد جدید"}</strong>
            <small>
              {selectedField?.title || "فیلد مبدأ"} ·{" "}
              {aggregationOptions.find((item) => item.id === aggregation)?.title}
            </small>
          </div>
          <p>این فیلد فقط خواندنی است و مقدار آن از رکوردهای مرتبط به دست می‌آید.</p>
        </aside>
      </div>
    </section>
  );
}

export function RelationSettings({ entityCode }: { entityCode?: string } = {}) {
  const { data: access } = useWorkspaceAccess();
  const catalog = useEngineCatalog();
  const relations = useEngineQuery<{ results: Relation[] }>(
    "relations",
    "relations/",
    Boolean(access?.can("Relation.View"))
  );
  const mutation = useEngineMutation();
  const empty = (): RelationDraft => ({
    left_entity: entityCode || "",
    right_entity: "",
    left_title: "",
    right_title: "",
    kind: "one_to_many",
    left_required: false,
    right_required: false,
    on_delete: "block",
  });
  const [data, setData] = useState<RelationDraft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const choices = (catalog.data?.entities || [])
    .filter((entity) => !entity.parent)
    .map((entity) => ({ id: entity.code, title: entity.title }));
  const entityTitle = (code: string) => choices.find((entity) => entity.id === code)?.title || code;
  const visibleRelations = (relations.data?.results || []).filter(
    (relation) => !entityCode || relation.left_entity === entityCode || relation.right_entity === entityCode
  );
  const canWrite = editing ? access?.can("Relation.Edit") : access?.can("Relation.Create");
  const currentKind = relationKinds.find((kind) => kind.id === data.kind);

  if (!access?.can("Relation.View")) return null;
  return (
    <div className="engine-relations-layout">
      <section className="engine-rules-card engine-relations-card" aria-labelledby="relations-title">
        <header className="engine-rules-card-header">
          <span className="engine-rules-card-icon is-relation" aria-hidden="true">
            <GitBranch size={22} />
          </span>
          <div>
            <span className="engine-rules-eyebrow">ساختار داده‌ها</span>
            <h3 id="relations-title">ارتباط بین موجودیت‌ها</h3>
            <p>دو فرم را به هم وصل کنید و تعداد پیوندها و رفتار حذف رکورد را تعیین کنید.</p>
          </div>
          <span className="engine-rules-count">{visibleRelations.length.toLocaleString("fa-IR")} ارتباط</span>
        </header>
        <div className={`engine-rules-card-body engine-relations-body${canWrite ? "" : " is-readonly"}`}>
          <div className="engine-rules-existing engine-relations-existing">
            <h4>ارتباط‌های موجود</h4>
            {relations.isLoading && <p className="engine-rules-empty">در حال دریافت ارتباط‌ها…</p>}
            {!visibleRelations.length && !relations.isLoading && (
              <p className="engine-rules-empty">هنوز ارتباطی برای این موجودیت تعریف نشده است.</p>
            )}
            {visibleRelations.map((relation) => (
              <article className="engine-relations-item" key={relation.id}>
                <div className="engine-relations-item-heading">
                  <span className="engine-relations-kind">
                    {relationKinds.find((kind) => kind.id === relation.kind)?.title}
                  </span>
                  <span className="engine-relations-link-count">
                    <Link2 size={14} aria-hidden="true" />
                    {relation.link_count.toLocaleString("fa-IR")} پیوند
                  </span>
                </div>
                <div className="engine-relations-item-sides">
                  <div>
                    <small>سمت اول</small>
                    <strong>{entityTitle(relation.left_entity)}</strong>
                    <span>{relation.left_title}</span>
                  </div>
                  <ArrowLeftRight size={17} aria-hidden="true" />
                  <div>
                    <small>سمت دوم</small>
                    <strong>{entityTitle(relation.right_entity)}</strong>
                    <span>{relation.right_title}</span>
                  </div>
                </div>
                <div className="engine-relations-item-footer">
                  <span>{relation.on_delete === "detach" ? "هنگام حذف: جدا کردن پیوند" : "هنگام حذف: مسدودسازی"}</span>
                  {(relation.left_required || relation.right_required) && <span>پیوند اجباری</span>}
                </div>
                {(access?.can("Relation.Edit") || access?.can("Relation.Delete")) && (
                  <div className="engine-rules-rule-actions">
                    {access?.can("Relation.Edit") && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setData({
                            left_entity: relation.left_entity,
                            right_entity: relation.right_entity,
                            left_title: relation.left_title,
                            right_title: relation.right_title,
                            kind: relation.kind,
                            left_required: relation.left_required,
                            right_required: relation.right_required,
                            on_delete: relation.on_delete,
                          });
                          setEditing(relation.id);
                        }}
                      >
                        ویرایش
                      </Button>
                    )}
                    {access?.can("Relation.Delete") && (
                      <Button
                        variant="danger"
                        disabled={mutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `این ارتباط دارای ${relation.link_count.toLocaleString("fa-IR")} پیوند است. ارتباط حذف و پیوندها جدا شوند؟`
                            )
                          )
                            void mutation
                              .mutateAsync({ path: `relations/${relation.id}/?confirm=true`, method: "delete" })
                              .then(() => {
                                if (editing === relation.id) {
                                  setData(empty());
                                  setEditing(null);
                                }
                                return null;
                              })
                              .catch(() => {});
                        }}
                      >
                        حذف ارتباط
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {canWrite && (
            <form
              className="engine-rules-form engine-relations-form"
              onSubmit={(event) => {
                event.preventDefault();
                void mutation
                  .mutateAsync({
                    path: `relations/${editing ? editing + "/" : ""}`,
                    method: editing ? "patch" : "post",
                    data,
                  })
                  .then(() => {
                    setData(empty());
                    setEditing(null);
                    return null;
                  })
                  .catch(() => {});
              }}
            >
              <div className="engine-rules-form-heading">
                <span className="engine-rules-form-icon" aria-hidden="true">
                  <Plus size={17} />
                </span>
                <div>
                  <h4>{editing ? "ویرایش ارتباط" : "ارتباط جدید"}</h4>
                  <p>موجودیت‌ها و نامی را که در هر فرم دیده می‌شود مشخص کنید.</p>
                </div>
              </div>
              <div className="engine-relations-form-section">
                <span className="engine-relations-section-title">۱. طرفین ارتباط</span>
                {!entityCode && (
                  <SearchableSelect
                    label="موجودیت سمت اول"
                    disabled={Boolean(editing)}
                    value={data.left_entity}
                    options={choices}
                    onChange={(value) => setData({ ...data, left_entity: value })}
                  />
                )}
                {entityCode && (
                  <div className="engine-relations-fixed-entity">
                    <span>موجودیت سمت اول</span>
                    <strong>{entityTitle(data.left_entity)}</strong>
                  </div>
                )}
                <SearchableSelect
                  label="موجودیت سمت دوم"
                  disabled={Boolean(editing)}
                  value={data.right_entity}
                  options={choices}
                  onChange={(value) => setData({ ...data, right_entity: value })}
                />
                <div className="engine-relations-form-row">
                  <label>
                    نام ارتباط در سمت اول
                    <input
                      required
                      value={data.left_title}
                      maxLength={255}
                      placeholder="مثلاً قراردادها"
                      onChange={(event) => setData({ ...data, left_title: event.target.value })}
                    />
                  </label>
                  <label>
                    نام ارتباط در سمت دوم
                    <input
                      required
                      value={data.right_title}
                      maxLength={255}
                      placeholder="مثلاً مشتری"
                      onChange={(event) => setData({ ...data, right_title: event.target.value })}
                    />
                  </label>
                </div>
              </div>
              <div className="engine-relations-form-section">
                <span className="engine-relations-section-title">۲. قوانین پیوند</span>
                <SearchableSelect
                  label="نوع ارتباط"
                  value={data.kind}
                  options={relationKinds}
                  onChange={(value) => setData({ ...data, kind: value })}
                />
                <p className="engine-relations-helper">{currentKind?.description}</p>
                <SearchableSelect
                  label="هنگام حذف یا غیرفعال کردن رکورد"
                  value={data.on_delete}
                  options={[
                    { id: "block", title: "مسدود کن" },
                    { id: "detach", title: "فقط ارتباط را جدا کن" },
                  ]}
                  onChange={(value) => setData({ ...data, on_delete: value })}
                />
                <div className="engine-relations-required-options">
                  <label className="engine-checkbox">
                    <input
                      type="checkbox"
                      checked={data.left_required}
                      onChange={(event) => setData({ ...data, left_required: event.target.checked })}
                    />
                    ارتباط در سمت اول اجباری است
                  </label>
                  <label className="engine-checkbox">
                    <input
                      type="checkbox"
                      checked={data.right_required}
                      onChange={(event) => setData({ ...data, right_required: event.target.checked })}
                    />
                    ارتباط در سمت دوم اجباری است
                  </label>
                </div>
              </div>
              <div className="engine-relations-preview" aria-live="polite">
                <span>نمای ارتباط در فرم‌ها</span>
                <div>
                  <strong>{data.left_title.trim() || "نام سمت اول"}</strong>
                  <ArrowLeftRight size={16} aria-hidden="true" />
                  <strong>{data.right_title.trim() || "نام سمت دوم"}</strong>
                </div>
                <small>{currentKind?.title}</small>
              </div>
              <div className="engine-relations-form-actions">
                <Button type="submit" disabled={mutation.isPending || !data.left_entity || !data.right_entity}>
                  {editing ? "ذخیره تغییرات" : "ذخیره ارتباط"}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(null);
                      setData(empty());
                    }}
                  >
                    انصراف
                  </Button>
                )}
              </div>
            </form>
          )}
        </div>
        {(relations.error || mutation.error) && (
          <p className="engine-relations-error" role="alert">
            {errorMessage(relations.error || mutation.error, "ذخیره ارتباط انجام نشد.")}
          </p>
        )}
      </section>
      {access?.can("Relation.Edit") && <LookupEditor entityCode={entityCode} />}
    </div>
  );
}
