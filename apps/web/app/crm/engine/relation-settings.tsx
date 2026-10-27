import { useState } from "react";
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

const relationKinds = [
  { id: "one_to_one", title: "یک به یک" },
  { id: "one_to_many", title: "یک به چند" },
  { id: "many_to_one", title: "چند به یک" },
  { id: "many_to_many", title: "چند به چند" },
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
  return (
    <section className="engine-view-settings">
      <h3>فیلد خواندنی از ارتباط</h3>
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
          <p>
            مسیر فعلی: <bdi>{prefix || "همین موجودیت"}</bdi>
          </p>
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
                return null;
              } else setPath(value);
            }}
          />
          <label>
            عنوان فیلد
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} />
          </label>
          <SearchableSelect
            label="نوع تجمیع"
            value={aggregation}
            options={[
              { id: "single", title: "مقدار تکی" },
              { id: "count", title: "تعداد" },
              { id: "sum", title: "جمع" },
              { id: "avg", title: "میانگین" },
              { id: "min", title: "کمینه" },
              { id: "max", title: "بیشینه" },
              { id: "list", title: "فهرست مقادیر" },
            ]}
            onChange={setAggregation}
          />
          <Button
            disabled={!path || !title || mutation.isPending}
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
  const empty = {
    left_entity: entityCode || "",
    right_entity: "",
    left_title: "",
    right_title: "",
    kind: "one_to_many",
    left_required: false,
    right_required: false,
    on_delete: "block",
  };
  const [data, setData] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const choices = (catalog.data?.entities || [])
    .filter((entity) => !entity.parent)
    .map((entity) => ({ id: entity.code, title: entity.title }));
  if (!access?.can("Relation.View")) return null;
  return (
    <section className="engine-view-settings">
      <h2>ارتباط بین موجودیت‌ها</h2>
      {relations.data?.results
        .filter(
          (relation) => !entityCode || relation.left_entity === entityCode || relation.right_entity === entityCode
        )
        .map((relation) => (
          <div className="engine-view-rule" key={relation.id}>
            <strong>
              {relation.left_title} ↔ {relation.right_title}
            </strong>
            <p>
              {relationKinds.find((kind) => kind.id === relation.kind)?.title} ·{" "}
              {relation.link_count.toLocaleString("fa-IR")} پیوند
            </p>
            {access?.can("Relation.Edit") && (
              <Button
                variant="secondary"
                onClick={() => {
                  setData({ ...relation });
                  setEditing(relation.id);
                }}
              >
                ویرایش
              </Button>
            )}
            {access?.can("Relation.Delete") && (
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      `این ارتباط دارای ${relation.link_count.toLocaleString("fa-IR")} پیوند است. ارتباط حذف و پیوندها جدا شوند؟`
                    )
                  )
                    void mutation
                      .mutateAsync({ path: `relations/${relation.id}/?confirm=true`, method: "delete" })
                      .catch(() => {});
                }}
              >
                حذف ارتباط
              </Button>
            )}
          </div>
        ))}
      {(editing ? access?.can("Relation.Edit") : access?.can("Relation.Create")) && (
        <form
          className="engine-editor-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void mutation
              .mutateAsync({
                path: `relations/${editing ? editing + "/" : ""}`,
                method: editing ? "patch" : "post",
                data,
              })
              .then(() => {
                setData(empty);
                setEditing(null);
                return null;
              })
              .catch(() => {});
          }}
        >
          {!entityCode && (
            <SearchableSelect
              label="موجودیت سمت اول"
              disabled={Boolean(editing)}
              value={data.left_entity}
              options={choices}
              onChange={(value) => setData({ ...data, left_entity: value })}
            />
          )}
          <SearchableSelect
            label="موجودیت سمت دوم"
            disabled={Boolean(editing)}
            value={data.right_entity}
            options={choices}
            onChange={(value) => setData({ ...data, right_entity: value })}
          />
          <label>
            نام ارتباط در سمت اول
            <input
              required
              value={data.left_title}
              maxLength={255}
              onChange={(event) => setData({ ...data, left_title: event.target.value })}
            />
          </label>
          <label>
            نام ارتباط در سمت دوم
            <input
              required
              value={data.right_title}
              maxLength={255}
              onChange={(event) => setData({ ...data, right_title: event.target.value })}
            />
          </label>
          <SearchableSelect
            label="نوع ارتباط"
            value={data.kind}
            options={relationKinds}
            onChange={(value) => setData({ ...data, kind: value })}
          />
          <SearchableSelect
            label="هنگام حذف یا غیرفعال کردن رکورد"
            value={data.on_delete}
            options={[
              { id: "block", title: "مسدود کن" },
              { id: "detach", title: "فقط ارتباط را جدا کن" },
            ]}
            onChange={(value) => setData({ ...data, on_delete: value })}
          />
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
          <Button type="submit" disabled={mutation.isPending}>
            ذخیره ارتباط
          </Button>
          {editing && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setData(empty);
              }}
            >
              انصراف
            </Button>
          )}
        </form>
      )}
      {(relations.error || mutation.error) && (
        <p role="alert">{errorMessage(relations.error || mutation.error, "ذخیره ارتباط انجام نشد.")}</p>
      )}
      {access?.can("Relation.Edit") && <LookupEditor entityCode={entityCode} />}
    </section>
  );
}
