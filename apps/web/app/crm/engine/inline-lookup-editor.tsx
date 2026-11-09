import { useState } from "react";
import { SearchableSelect, normalizePersianSearch } from "@plane/ui";
import { useWorkspaceAccess } from "../api";
import { Button } from "../components";
import { browserId } from "../browser-id";
import { useEngineMutation } from "./api";
import type { LookupDefinition, LookupOptionDefinition } from "./api";

const newCode = (prefix: string) => `${prefix}_${browserId().replaceAll("-", "").slice(0, 12)}`;
const validCode = (code: string) => !code || /^[a-z][a-z0-9_-]*$/.test(code);

type OptionDraft = Pick<LookupOptionDefinition, "title" | "color" | "icon" | "position" | "is_default" | "is_active">;
type NewOptionDraft = Omit<OptionDraft, "position"> & { code: string; position: number | null };
const emptyOption = (): NewOptionDraft => ({
  code: "",
  title: "",
  color: "#64748b",
  icon: "",
  position: null,
  is_default: false,
  is_active: true,
});

function ListSettings({
  list,
  pending,
  onSave,
}: {
  list: LookupDefinition;
  pending: boolean;
  onSave: (patch: Pick<LookupDefinition, "title" | "description" | "is_active">) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    title: list.title,
    description: list.description || "",
    is_active: list.is_active,
  });
  return (
    <details className="engine-inline-lookup-settings">
      <summary>تنظیمات لیست «{list.title}»</summary>
      <div className="engine-inline-lookup-settings-body">
        <label>
          نام لیست
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <label>
          توضیح لیست (اختیاری)
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="engine-checkbox">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
          />
          لیست فعال است
        </label>
        <small>این لیست ممکن است در ورودی‌های دیگر همین فضای کاری هم استفاده شود.</small>
        <Button
          type="button"
          variant="secondary"
          disabled={!draft.title.trim() || pending}
          onClick={() => void onSave({ ...draft, title: draft.title.trim() })}
        >
          ذخیره تنظیمات لیست
        </Button>
      </div>
    </details>
  );
}

function OptionSettings({
  option,
  pending,
  onSave,
}: {
  option: LookupOptionDefinition;
  pending: boolean;
  onSave: (option: LookupOptionDefinition, patch: OptionDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<OptionDraft>({
    title: option.title,
    color: option.color || "#64748b",
    icon: option.icon || "",
    position: option.position,
    is_default: option.is_default,
    is_active: option.is_active,
  });
  return (
    <li className={option.is_active ? "" : "is-inactive"}>
      <div className="engine-inline-option-main">
        <span
          className="engine-inline-option-color"
          style={{ backgroundColor: option.color || "#64748b" }}
          aria-hidden="true"
        />
        <strong>
          {option.icon ? `${option.icon} ` : ""}
          {option.title}
        </strong>
        {option.is_default && <small>پیش‌فرض</small>}
        {!option.is_active && <small>غیرفعال</small>}
      </div>
      <details className="engine-inline-lookup-settings">
        <summary>ویرایش گزینهٔ {option.title}</summary>
        <div className="engine-inline-lookup-settings-body">
          <label>
            متن گزینه
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <div className="engine-editor-grid">
            <label>
              رنگ
              <input
                type="color"
                value={draft.color}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </label>
            <label>
              آیکون (اختیاری)
              <input value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} />
            </label>
          </div>
          <label>
            جایگاه نمایش
            <input
              type="number"
              step={1}
              value={draft.position}
              onChange={(event) => setDraft({ ...draft, position: Number(event.target.value) })}
            />
          </label>
          <label className="engine-checkbox">
            <input
              type="checkbox"
              checked={draft.is_default}
              onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })}
            />
            مقدار پیش‌فرض
          </label>
          <label className="engine-checkbox">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
            />
            گزینه فعال است
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!draft.title.trim() || pending}
            onClick={() => void onSave(option, { ...draft, title: draft.title.trim(), icon: draft.icon.trim() })}
          >
            ذخیره گزینه
          </Button>
        </div>
      </details>
    </li>
  );
}

export function InlineLookupEditor({
  lookupId,
  onChange,
  lookups,
  values,
  selectionDisabled = false,
}: {
  lookupId?: string | null;
  onChange: (id: string | null) => void;
  lookups: LookupDefinition[];
  values: LookupOptionDefinition[];
  selectionDisabled?: boolean;
}) {
  const { data: access } = useWorkspaceAccess();
  const mutation = useEngineMutation();
  const [listTitle, setListTitle] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [listCode, setListCode] = useState("");
  const [optionTitles, setOptionTitles] = useState("");
  const [optionSearch, setOptionSearch] = useState("");
  const [newOption, setNewOption] = useState(emptyOption);
  const selected = lookups.find((item) => item.id === lookupId);
  const options = values
    .filter((item) => item.category === lookupId)
    // eslint-disable-next-line unicorn/no-array-sort -- The filtered array is private and older browsers lack toSorted.
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "fa"));
  const nextPosition = Math.max(-1, ...options.map((item) => item.position)) + 1;
  const visibleOptions = options.filter((item) =>
    normalizePersianSearch(item.title).includes(normalizePersianSearch(optionSearch))
  );
  const canCreate = Boolean(access?.can("Lookup.Create"));
  const canEdit = Boolean(access?.can("Lookup.Edit"));

  const createList = async () => {
    const title = listTitle.trim();
    if (!title || !canCreate || !validCode(listCode)) return;
    try {
      const saved = (await mutation.mutateAsync({
        path: "definitions/lookups/",
        data: { code: listCode || newCode("list"), title, description: listDescription.trim(), is_active: true },
      })) as LookupDefinition;
      onChange(saved.id);
      setListTitle("");
      setListDescription("");
      setListCode("");
    } catch {
      // The mutation shows the server error; keep the entered values for correction.
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
            position: nextPosition + index,
            is_active: true,
          },
        });
      } catch {
        setOptionTitles(titles.slice(index).join("\n"));
        return;
      }
    }
    setOptionTitles("");
  };

  const createDetailedOption = async () => {
    if (!lookupId || !newOption.title.trim() || !canCreate || !validCode(newOption.code)) return;
    try {
      await mutation.mutateAsync({
        path: "definitions/values/",
        data: {
          ...newOption,
          position: newOption.position ?? nextPosition,
          category: lookupId,
          code: newOption.code || newCode("option"),
          title: newOption.title.trim(),
          icon: newOption.icon.trim(),
        },
      });
      setNewOption(emptyOption());
    } catch {
      // Keep the draft for correction.
    }
  };

  const updateList = async (patch: Pick<LookupDefinition, "title" | "description" | "is_active">) => {
    if (!selected || !canEdit) return;
    try {
      await mutation.mutateAsync({ path: `definitions/lookups/${selected.id}/`, method: "patch", data: patch });
    } catch {
      // Keep the draft for correction.
    }
  };

  const updateOption = async (item: LookupOptionDefinition, patch: OptionDraft) => {
    if (!canEdit) return;
    try {
      await mutation.mutateAsync({ path: `definitions/values/${item.id}/`, method: "patch", data: patch });
    } catch {
      // Keep the draft for correction.
    }
  };

  return (
    <div className="engine-inline-lookup" aria-label="گزینه‌های همین ورودی">
      <SearchableSelect
        label="منبع گزینه‌ها (لیست پایه)"
        showLabel
        disabled={selectionDisabled}
        value={lookupId || ""}
        options={lookups
          .filter((item) => item.is_active || item.id === lookupId)
          .map((item) => ({ id: item.id, title: item.is_active ? item.title : `${item.title} (غیرفعال)` }))}
        onChange={(id) => {
          onChange(id || null);
          setOptionSearch("");
        }}
      />
      <small>
        لیست و گزینه‌های آن را همین‌جا تنظیم کنید. تغییر لیست مشترک روی ورودی‌های دیگری که از آن استفاده می‌کنند نیز اثر
        دارد.
      </small>
      {canCreate && !selectionDisabled && (
        <details className="engine-inline-lookup-settings">
          <summary>ساخت لیست جدید</summary>
          <div className="engine-inline-lookup-settings-body">
            <label>
              نام لیست جدید
              <input
                value={listTitle}
                onChange={(event) => setListTitle(event.target.value)}
                placeholder="مثلاً روش پرداخت"
              />
            </label>
            <label>
              توضیح لیست (اختیاری)
              <textarea value={listDescription} onChange={(event) => setListDescription(event.target.value)} />
            </label>
            <label>
              کد لیست (اختیاری)
              <input
                dir="ltr"
                value={listCode}
                onChange={(event) => setListCode(event.target.value.toLowerCase().trim())}
                placeholder="خودکار ساخته می‌شود"
                aria-invalid={!validCode(listCode)}
              />
              <small>با حرف انگلیسی شروع شود؛ فقط حرف، عدد، خط تیره و زیرخط.</small>
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={!listTitle.trim() || !validCode(listCode) || mutation.isPending}
              onClick={() => void createList()}
            >
              ساخت لیست و انتخاب آن
            </Button>
          </div>
        </details>
      )}
      {selected && (
        <div className="engine-inline-lookup-options">
          <strong>گزینه‌های «{selected.title}»</strong>
          {!selected.is_active && <small>این لیست غیرفعال است؛ برای استفادهٔ کاربران آن را فعال کنید.</small>}
          {canEdit && (
            <ListSettings key={selected.id} list={selected} pending={mutation.isPending} onSave={updateList} />
          )}
          {options.length > 0 && (
            <label>
              جست‌وجوی گزینه‌ها
              <input type="search" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} />
            </label>
          )}
          {visibleOptions.length ? (
            <ul>
              {visibleOptions.slice(0, 100).map((item) =>
                canEdit ? (
                  <OptionSettings key={item.id} option={item} pending={mutation.isPending} onSave={updateOption} />
                ) : (
                  <li key={item.id}>
                    {item.title}
                    {item.is_default ? " · پیش‌فرض" : ""}
                    {!item.is_active ? " · غیرفعال" : ""}
                  </li>
                )
              )}
            </ul>
          ) : (
            <small>{options.length ? "گزینه‌ای با این عبارت پیدا نشد." : "این لیست هنوز گزینه‌ای ندارد."}</small>
          )}
          {visibleOptions.length > 100 && <small>برای دیدن سایر گزینه‌ها، نامشان را جست‌وجو کنید.</small>}
          {canCreate && (
            <>
              <div className="engine-inline-lookup-create">
                <label>
                  افزودن سریع گزینه‌ها (هر گزینه در یک خط)
                  <textarea
                    value={optionTitles}
                    onChange={(event) => setOptionTitles(event.target.value)}
                    placeholder={"نقدی\nاعتباری"}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!optionTitles.trim() || mutation.isPending}
                  onClick={() => void createOptions()}
                >
                  افزودن گزینه‌ها به لیست
                </Button>
              </div>
              <details className="engine-inline-lookup-settings">
                <summary>ساخت گزینه با تنظیمات کامل</summary>
                <div className="engine-inline-lookup-settings-body">
                  <label>
                    متن گزینه
                    <input
                      value={newOption.title}
                      onChange={(event) => setNewOption({ ...newOption, title: event.target.value })}
                    />
                  </label>
                  <label>
                    کد گزینه (اختیاری)
                    <input
                      dir="ltr"
                      value={newOption.code}
                      onChange={(event) =>
                        setNewOption({ ...newOption, code: event.target.value.toLowerCase().trim() })
                      }
                      placeholder="خودکار ساخته می‌شود"
                      aria-invalid={!validCode(newOption.code)}
                    />
                  </label>
                  <div className="engine-editor-grid">
                    <label>
                      رنگ
                      <input
                        type="color"
                        value={newOption.color}
                        onChange={(event) => setNewOption({ ...newOption, color: event.target.value })}
                      />
                    </label>
                    <label>
                      آیکون (اختیاری)
                      <input
                        value={newOption.icon}
                        onChange={(event) => setNewOption({ ...newOption, icon: event.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    جایگاه نمایش
                    <input
                      type="number"
                      step={1}
                      value={newOption.position ?? nextPosition}
                      onChange={(event) => setNewOption({ ...newOption, position: Number(event.target.value) })}
                    />
                    <small>به‌طور پیش‌فرض، گزینه در انتهای لیست قرار می‌گیرد.</small>
                  </label>
                  <label className="engine-checkbox">
                    <input
                      type="checkbox"
                      checked={newOption.is_default}
                      onChange={(event) => setNewOption({ ...newOption, is_default: event.target.checked })}
                    />
                    مقدار پیش‌فرض
                  </label>
                  <label className="engine-checkbox">
                    <input
                      type="checkbox"
                      checked={newOption.is_active}
                      onChange={(event) => setNewOption({ ...newOption, is_active: event.target.checked })}
                    />
                    گزینه فعال است
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!newOption.title.trim() || !validCode(newOption.code) || mutation.isPending}
                    onClick={() => void createDetailedOption()}
                  >
                    افزودن گزینه
                  </Button>
                </div>
              </details>
            </>
          )}
        </div>
      )}
      {!canCreate && !selectionDisabled && <small>برای ساخت گزینهٔ جدید، مجوز «ایجاد لیست پایه» لازم است.</small>}
    </div>
  );
}
