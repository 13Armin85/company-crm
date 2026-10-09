import { useState } from "react";
import { Combobox, ComboboxButton, ComboboxInput, Label, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { Check, ChevronDown, Search, UserRound } from "lucide-react";

export type MemberSelectOption = {
  id: string;
  title: string;
  initials?: string;
  avatarUrl?: string;
};

const normalize = (text: string) => text.replace(/ي/g, "ی").replace(/ك/g, "ک").trim().toLowerCase();

export function MemberSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: MemberSelectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) => normalize(option.title).includes(normalize(query)));
  return (
    <Combobox
      as="div"
      className="crm-member-select"
      value={value || null}
      onChange={(id: string | null) => onChange(id ?? "")}
      onClose={() => setQuery("")}
      disabled={disabled}
      immediate
    >
      <Label className="crm-member-select-label">{label}</Label>
      <div className="crm-member-select-control">
        <Search size={17} aria-hidden="true" />
        <ComboboxInput
          placeholder="جستجو و انتخاب کاربر…"
          displayValue={(id: string | null) => options.find((option) => option.id === id)?.title ?? ""}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        <ComboboxButton aria-label="نمایش کاربران">
          <ChevronDown size={17} aria-hidden="true" />
        </ComboboxButton>
      </div>
      <ComboboxOptions
        anchor={{ to: "bottom start", gap: 6, padding: 16 }}
        className="crm-member-select-options"
        dir="rtl"
      >
        <div className="crm-member-select-hint">{filtered.length.toLocaleString("fa-IR")} کاربر قابل انتخاب</div>
        {filtered.length === 0 && (
          <p role="status">{options.length ? "کاربری با این نام پیدا نشد." : "کاربری برای افزودن باقی نمانده است."}</p>
        )}
        {filtered.map((option) => (
          <ComboboxOption key={option.id} value={option.id} className="crm-member-select-option">
            {({ selected }) => (
              <>
                <span className="crm-member-select-avatar" aria-hidden="true">
                  {option.avatarUrl ? (
                    <img src={option.avatarUrl} alt="" />
                  ) : (
                    option.initials || <UserRound size={18} />
                  )}
                </span>
                <span className="crm-member-select-name">{option.title}</span>
                {selected && <Check size={17} aria-hidden="true" />}
              </>
            )}
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </Combobox>
  );
}
