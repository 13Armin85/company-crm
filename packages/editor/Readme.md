# `@plane/editor`

## معرفی

بستهٔ `@plane/editor` زیرساخت سامانهٔ ویرایشگر پلین است. این بسته قابلیت‌های پایه را در اختیار سایر بسته‌های ویرایشگر می‌گذارد و معمولاً مستقیماً در برنامه‌ها استفاده نمی‌شود؛ کاربرد اصلی آن توسعه و گسترش ویرایشگرهای دیگر است.

## ابزارها

این بسته ابزارهای زیر را برای توسعهٔ هسته فراهم می‌کند:

1. ادغام کلاس‌ها و استایل‌های سفارشی
2. افزودن extensionهای جدید
3. افزودن props سفارشی
4. آیتم‌های پایهٔ منو و فرمان‌های آن‌ها

این امکانات، سفارشی‌سازی ویرایشگرهای ساخته‌شده با بستهٔ `editor-core` را ساده می‌کنند.

### خروجی‌های اصلی بسته

1. `useEditor`: hook توسعهٔ ویرایشگر پلین

   | ویژگی | نوع | توضیح |
   | --- | --- | --- |
   | `extensions` | `Extension[]` | extensionهای سفارشی برای گسترش قابلیت‌های هسته |
   | `editorProps` | `EditorProps` | props سفارشی ویرایشگر |
   | `uploadFile` | `(file: File) => Promise<string>` | تابع بارگذاری فایل |
   | `deleteFile` | `(assetUrlWithWorkspaceId: string) => Promise<any>` | تابع حذف تصویر با استفاده از URL آن در bucket |
   | `value` | `html string` | محتوای اولیهٔ ویرایشگر |
   | `debouncedUpdatesEnabled` | `boolean` | در صورت فعال‌بودن، اجرای `onChange` تا پایان تأخیر پیش‌فرض ۱۵۰۰ میلی‌ثانیه عقب می‌افتد |
   | `onChange` | `(json: any, html: string) => void` | هنگام تغییر محتوا با خروجی JSON و HTML فراخوانی می‌شود |
   | `setIsSubmitting` | `(isSubmitting: "submitting" \| "submitted" \| "saved") => void` | وضعیت ثبت محتوا را به‌روزرسانی می‌کند |
   | `setShouldShowAlert` | `(showAlert: boolean) => void` | هشدار ذخیره‌نشدن محتوا را نمایش می‌دهد یا پنهان می‌کند |
   | `forwardedRef` | `any` | امکان کنترل وضعیت ویرایشگر از یک مؤلفهٔ بیرونی |

2. `useReadOnlyEditor`: hook توسعهٔ نمونهٔ فقط‌خواندنی ویرایشگر

   | ویژگی | نوع | توضیح |
   | --- | --- | --- |
   | `value` | `string` | محتوای اولیهٔ ویرایشگر |
   | `forwardedRef` | `any` | امکان کنترل وضعیت از مؤلفهٔ بیرونی |
   | `extensions` | `Extension[]` | extensionهای سفارشی |
   | `editorProps` | `EditorProps` | props سفارشی ویرایشگر |

3. آیتم‌ها و فرمان‌ها: متدهای H1، H2، H3، فهرست وظایف، نقل‌قول، بلوک کد و موارد مشابه

4. پوشش‌های رابط کاربری:

   - `EditorContainer`: اعمال کلاس‌ها و استایل‌های پایه به container ویرایشگر
   - `EditorContentWrapper`: دسترسی به محتوای ویرایشگر و منوهای پایه

5. گسترش با استایل سفارشی:

```ts
const customEditorClassNames = getEditorClassNames({
  noBorder,
  borderOnFocus,
  customClassName,
});
```

## قابلیت‌های هسته

- **حذف فاصله‌های خالی:** خط‌های خالی ابتدا و انتهای محتوا پیش از ارسال به backend حذف می‌شوند.
- **پاک‌سازی مقدار:** مقدار در سطح هسته پاک‌سازی می‌شود و به اعتبارسنجی تکراری در برنامه نیازی نیست.
- **خط لولهٔ Turbo:** وظایف توسعه و build پروژه‌های وابسته به این بسته در Turbo تعریف شده‌اند.

## extensionهای پایه

- BulletList
- OrderedList
- Blockquote
- Code
- Gapcursor
- Link
- Image
- Basic Marks
  - Underline
  - TextStyle
  - Color
- TaskList
- Markdown
- Table
