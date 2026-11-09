import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { useWorkspaceAccess } from "../api";
import { Button } from "../components";
import { browserId } from "../browser-id";
import { useEngineMutation } from "./api";
import type { LookupDefinition, LookupOptionDefinition } from "./api";

const newCode = (prefix: string) => `${prefix}_${browserId().replaceAll("-", "").slice(0, 12)}`;

export function InlineLookupEditor({
  lookupId,
  onChange,
  lookups,
  values,
  disabled = false,
}: {
  lookupId?: string | null;
  onChange: (id: string | null) => void;
  lookups: LookupDefinition[];
  values: LookupOptionDefinition[];
  disabled?: boolean;
}) {
  const { data: access } = useWorkspaceAccess();
  const mutation = useEngineMutation();
  const [listTitle, setListTitle] = useState("");
  const [optionTitles, setOptionTitles] = useState("");
  const [parent, setParent] = useState("");
  const [editingOption, setEditingOption] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const selected = lookups.find((item) => item.id === lookupId);
  const options = values
    .filter((item) => item.category === lookupId)
    // eslint-disable-next-line unicorn/no-array-sort -- The filtered array is private and older browsers lack toSorted.
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "fa"));
  const canCreate = !disabled && access?.can("Lookup.Create");
  const canEdit = !disabled && access?.can("Lookup.Edit");

  const createList = async () => {
    const title = listTitle.trim();
    if (!title || !canCreate) return;
    try {
      const saved = (await mutation.mutateAsync({
        path: "definitions/lookups/",
        data: { code: newCode("list"), title, is_active: true },
      })) as LookupDefinition;
      onChange(saved.id);
      setListTitle("");
    } catch {
      // The mutation shows the server error and the entered name stays available.
    }
  };

  const createOptions = async () => {
    const titles = optionTitles
      .split(/[\n،,]+/)
      .map((title) => title.trim())
      .filter(Boolean);
    if (!lookupId || !titles.length || !canCreate) return;
    for (let index = 0; index < titles.length; index++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Preserve order and keep only unfinished titles if a request fails.
        await mutation.mutateAsync({
          path: "definitions/values/",
          data: {
            category: lookupId,
            code: newCode("option"),
            title: titles[index],
            position: options.length + index,
            is_active: true,
            ...(parent ? { parent } : {}),
          },
        });
      } catch {
        setOptionTitles(titles.slice(index).join("\n"));
        return;
      }
    }
    setOptionTitles("");
    setParent("");
  };

  const updateOption = async (item: LookupOptionDefinition, patch: Partial<LookupOptionDefinition>) => {
    if (!canEdit) return;
    try {
      await mutation.mutateAsync({ path: `definitions/values/${item.id}/`, method: "patch", data: patch });
      setEditingOption("");
    } catch {
      // Preserve the edit for correction.
    }
  };

  return (
    <div className="engine-inline-lookup" aria-label="گزینه‌های همین ورودی">
      <SearchableSelect
        label="منبع گزینه‌ها (لیست پایه)"
        showLabel
        disabled={disabled}
        value={lookupId || ""}
        options={lookups
          .filter((item) => item.is_active || item.id === lookupId)
          .map((item) => ({ id: item.id, title: item.is_active ? item.title : `${item.title} (غیرفعال)` }))}
        onChange={(id) => onChange(id || null)}
      />
      <small>
        لیست، گزینه‌های قابل انتخاب این ورودی را تعیین می‌کند. می‌توانید همین‌جا لیست تازه بسازید یا به لیست موجود گزینه
        اضافه کنید.
      </small>
      {canCreate && (
        <div className="engine-inline-lookup-create">
          <label>
            نام لیست جدید
            <input
              value={listTitle}
              onChange={(event) => setListTitle(event.target.value)}
              placeholder="مثلاً روش پرداخت"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!listTitle.trim() || mutation.isPending}
            onClick={() => void createList()}
          >
            ساخت لیست و انتخاب آن
          </Button>
        </div>
      )}
      {selected && (
        <div className="engine-inline-lookup-options">
          <strong>گزینه‌های «{selected.title}»</strong>
          {options.length ? (
            <ul>
              {options.map((item) => (
                <li key={item.id}>
                  {editingOption === item.id ? (
                    <>
                      <input
                        aria-label={`نام گزینهٔ ${item.title}`}
                        value={editedTitle}
                        onChange={(event) => setEditedTitle(event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!editedTitle.trim() || mutation.isPending}
                        onClick={() => void updateOption(item, { title: editedTitle.trim() })}
                      >
                        ذخیره
                      </Button>
                    </>
                  ) : (
                    <>
                      <span>
                        {item.title}
                        {item.is_default ? " · پیش‌فرض" : ""}
                        {!item.is_active ? " · غیرفعال" : ""}
                      </span>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingOption(item.id);
                              setEditedTitle(item.title);
                            }}
                            aria-label={`ویرایش گزینهٔ ${item.title}`}
                          >
                            ویرایش
                          </button>
                          <button
                            type="button"
                            disabled={mutation.isPending}
                            onClick={() => void updateOption(item, { is_active: !item.is_active })}
                            aria-label={`${item.is_active ? "غیرفعال کردن" : "فعال کردن"} گزینهٔ ${item.title}`}
                          >
                            {item.is_active ? "غیرفعال" : "فعال"}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <small>این لیست هنوز گزینه‌ای ندارد.</small>
          )}
          {canCreate && (
            <div className="engine-inline-lookup-create">
              <label>
                گزینه‌های جدید (هر گزینه در یک خط)
                <textarea
                  value={optionTitles}
                  onChange={(event) => setOptionTitles(event.target.value)}
                  placeholder={"نقدی\nاعتباری"}
                />
              </label>
              <SearchableSelect
                label="مقدار والد (اختیاری، برای گزینه‌های وابسته)"
                showLabel
                value={parent}
                options={[
                  { id: "", title: "بدون والد" },
                  ...values
                    .filter((item) => item.category !== lookupId && item.is_active)
                    .map((item) => ({
                      id: item.id,
                      title: `${lookups.find((list) => list.id === item.category)?.title || "لیست"} / ${item.title}`,
                    })),
                ]}
                onChange={setParent}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!optionTitles.trim() || mutation.isPending}
                onClick={() => void createOptions()}
              >
                افزودن گزینه‌ها به لیست
              </Button>
            </div>
          )}
        </div>
      )}
      {!canCreate && !disabled && <small>برای ساخت گزینهٔ جدید، مجوز «ایجاد لیست پایه» لازم است.</small>}
    </div>
  );
}
