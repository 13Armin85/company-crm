# ویژگی‌های مؤلفهٔ Dropdown

فهرست ویژگی‌های قابل استفاده در Dropdown در ادامه آمده است.

### ویژگی‌های Root

- `value: string | string[]`: مقدار انتخاب‌شدهٔ فعلی
- `onChange: (value: string | string[]) => void`: تابع فراخوانی‌شونده هنگام تغییر مقدار
- `options: TDropdownOption[] | undefined`: آرایهٔ گزینه‌ها
- `onOpen?: () => void`: تابع فراخوانی‌شونده هنگام بازشدن منو
- `onClose?: () => void`: تابع فراخوانی‌شونده هنگام بسته‌شدن منو
- `containerClassName?: (isOpen: boolean) => string`: تولید نام کلاس container براساس وضعیت بازبودن
- `tabIndex?: number`: مقدار tab index منو
- `placement?: Placement`: محل نمایش، مانند بالا، پایین، چپ یا راست
- `disabled?: boolean`: غیرفعال‌کردن منو

### ویژگی‌های Button

- `buttonContent?: (isOpen: boolean) => React.ReactNode`: تولید محتوای دکمه براساس وضعیت بازبودن
- `buttonContainerClassName?: string`: نام کلاس container دکمه
- `buttonClassName?: string`: نام کلاس خود دکمه

### ویژگی‌های Input

- `disableSearch?: boolean`: غیرفعال‌کردن ورودی جست‌وجو
- `inputPlaceholder?: string`: متن راهنمای ورودی جست‌وجو
- `inputClassName?: string`: نام کلاس ورودی جست‌وجو
- `inputIcon?: React.ReactNode`: آیکون ورودی جست‌وجو
- `inputContainerClassName?: string`: نام کلاس container ورودی جست‌وجو

### ویژگی‌های Options

- `keyExtractor: (option: TDropdownOption) => string`: استخراج کلید هر گزینه
- `optionsContainerClassName?: string`: نام کلاس container گزینه‌ها
- `queryArray: string[]`: رشته‌های مورد استفاده برای جست‌وجوی گزینه‌ها
- `sortByKey: string`: کلید مرتب‌سازی گزینه‌ها
- `firstItem?: (optionValue: string) => boolean`: تعیین اینکه یک گزینه باید نخستین مورد باشد یا نه
- `renderItem?: ({ value, selected }: { value: string; selected: boolean }) => React.ReactNode`: رندر هر گزینه
- `loader?: React.ReactNode`: عنصر نمایشی هنگام بارگذاری گزینه‌ها
- `disableSorting?: boolean`: غیرفعال‌کردن مرتب‌سازی

این ویژگی‌ها کنترل کاملی بر رفتار و ظاهر Dropdown فراهم می‌کنند و استفاده از آن را در سناریوهای مختلف ممکن می‌سازند.
