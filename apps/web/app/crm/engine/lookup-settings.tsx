import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { Button, Skeleton } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { ErrorNotice } from "../error-state";
import { useEngineDefinitions } from "./api";
import type { LookupDefinition, LookupOptionDefinition } from "./api";
import { DefinitionEditor } from "./definition-editor";

export function LookupSettings() {
  const { data: access } = useWorkspaceAccess();
  const lookups = useEngineDefinitions<LookupDefinition>("lookups", Boolean(access?.can("Lookup.View")));
  const values = useEngineDefinitions<LookupOptionDefinition>("values", Boolean(access?.can("Lookup.View")));
  const [selectedId, setSelectedId] = useState("");
  const [editingLookup, setEditingLookup] = useState<LookupDefinition | "new" | null>(null);
  const [editingValue, setEditingValue] = useState<LookupOptionDefinition | "new" | null>(null);
  if (!access?.can("Lookup.View"))
    return <p role="status">برای دیدن لیست‌های انتخابی، دسترسی مشاهدهٔ لیست پایه لازم است.</p>;
  if (lookups.isLoading || values.isLoading) return <Skeleton rows={4} />;
  const selected = lookups.data?.find((item) => item.id === selectedId) || lookups.data?.[0];
  const options = (values.data || [])
    .filter((item) => item.category === selected?.id)
    // eslint-disable-next-line unicorn/no-array-sort -- The filtered array is private and older browsers lack toSorted.
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "fa"));
  return (
    <section className="engine-view-settings" aria-label="مدیریت لیست‌های انتخابی">
      <h3>لیست‌ها و گزینه‌ها</h3>
      <p>
        برای ورودی «انتخاب تکی» یا «انتخاب چندتایی»، ابتدا یک لیست بسازید و گزینه‌هایش را اضافه کنید؛ سپس هنگام ساخت
        ورودی، همان لیست را در «منبع گزینه‌ها» انتخاب کنید. این لیست‌ها در کل فضای کاری مشترک‌اند.
      </p>
      <ErrorNotice message={lookups.error && errorMessage(lookups.error, "دریافت لیست‌ها انجام نشد.")} />
      <ErrorNotice message={values.error && errorMessage(values.error, "دریافت گزینه‌های لیست انجام نشد.")} />
      <div className="engine-rules-form">
        <SearchableSelect
          showLabel
          label="لیست موردنظر"
          value={selected?.id || ""}
          options={(lookups.data || []).map((item) => ({ id: item.id, title: item.title }))}
          onChange={(id) => {
            setSelectedId(id);
            setEditingValue(null);
          }}
        />
        {access.can("Lookup.Create") && (
          <Button variant="secondary" onClick={() => setEditingLookup("new")}>
            ساخت لیست جدید
          </Button>
        )}
        {selected && access.can("Lookup.Edit") && (
          <Button variant="ghost" onClick={() => setEditingLookup(selected)}>
            ویرایش نام لیست
          </Button>
        )}
      </div>
      {selected ? (
        <>
          <h4>گزینه‌های «{selected.title}»</h4>
          <p>
            برای لیست وابسته، گزینه‌های لیست والد را اول بسازید. سپس هنگام ساخت هر گزینهٔ این لیست، «مقدار والد» آن را
            انتخاب کنید؛ در فرم فقط گزینه‌های مربوط به مقدار انتخاب‌شده نمایش داده می‌شوند.
          </p>
          {!options.length && <p>این لیست هنوز گزینه‌ای ندارد.</p>}
          <div className="engine-rules-existing">
            {options.map((item) => (
              <div key={item.id} className="engine-rules-rule">
                <strong>{item.title}</strong>
                {!item.is_active && <small>غیرفعال</small>}
                {item.parent && (
                  <small>
                    والد: {values.data?.find((candidate) => candidate.id === item.parent)?.title || "نامشخص"}
                  </small>
                )}
                {access.can("Lookup.Edit") && (
                  <Button variant="secondary" onClick={() => setEditingValue(item)}>
                    ویرایش گزینه
                  </Button>
                )}
              </div>
            ))}
          </div>
          {access.can("Lookup.Create") && (
            <Button onClick={() => setEditingValue("new")}>افزودن گزینه به این لیست</Button>
          )}
        </>
      ) : (
        <p>برای شروع، یک لیست جدید بسازید.</p>
      )}
      {editingLookup && (
        <DefinitionEditor
          key={editingLookup === "new" ? "new-lookup" : editingLookup.id}
          kind="lookups"
          row={editingLookup === "new" ? undefined : editingLookup}
          onClose={() => setEditingLookup(null)}
          onSaved={(row) => {
            if (row?.id) setSelectedId(row.id);
          }}
        />
      )}
      {editingValue && selected && (
        <DefinitionEditor
          key={editingValue === "new" ? `new-value-${selected.id}` : editingValue.id}
          kind="values"
          row={editingValue === "new" ? { category: selected.id } : editingValue}
          onClose={() => setEditingValue(null)}
        />
      )}
    </section>
  );
}
