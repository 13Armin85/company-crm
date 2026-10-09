# لوگوی مشترک پروژه

لوگوی ارسالی کاربر، نشان آبی تحلیلگران آمارد، در صفحهٔ ورود و منوی CRM، پنل مدیریت، صفحات عمومی، نشان‌های بارگذاری، مؤلفه‌های قدیمی برند، آیکن مرورگر و نصب برنامه و قالب‌های ایمیل استفاده می‌شود.

## فایل‌های اصلی

- `assets/branding/amard-original.png`: کپی دست‌نخوردهٔ تصویر ارسالی.
- `assets/branding/amard-logo.png`: نسخهٔ شفاف لوگو همراه نوشته‌های زیر نشان.
- `assets/branding/amard-symbol.png`: نسخهٔ شفاف نشان برای اندازه‌های کوچک.
- `packages/ui/src/brand-logo.tsx`: مؤلفهٔ مشترک `BrandLogo` با حالت‌های `symbol` و `full` و پشتیبانی از تصاویر تزئینی.
- `packages/constants/src/branding.ts`: دادهٔ تولیدشدهٔ تصاویر کوچک برای مؤلفه‌ها؛ استفاده از آن به مسیر پایهٔ برنامه یا بارگذاری تصویر از سرویس بیرونی وابسته نیست.
- `assets/branding/prepare-branding.ps1`: اسکریپت تبدیل منابع به تصاویر رابط، favicon و آیکن‌های نصب.

تصاویر PNG در `public/branding` هر سه برنامه، favicon و آیکن‌های نصب از همین منابع تولید می‌شوند. تصویر ایمیل از `WEB_URL` همان محیط و مسیر `/branding/amard-logo.png` خوانده می‌شود. تولید URL با template tag انجام می‌شود و به وجود request هنگام اجرای Celery وابسته نیست.

پیوند manifest با نسخهٔ لوگو مشخص می‌شود تا مرورگر manifest جدید را دریافت کند؛ faviconهای واردشده در کد نیز URL تولیدشدهٔ Vite دارند. مسیر manifest پنل مدیریت و صفحات عمومی از `ADMIN_BASE_PATH` و `SPACE_BASE_PATH` گرفته می‌شود.

## آماده‌سازی مجدد

پس از تغییر فایل‌های اصلی، در Windows و ریشهٔ مخزن اجرا کنید:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File assets/branding/prepare-branding.ps1
```

این فرمان تبدیل فرمت و اندازهٔ تصاویر، favicon چنداندازه‌ای و دادهٔ مؤلفه‌ها را تولید می‌کند. همهٔ خروجی‌ها داخل مخزن هستند؛ اجرای Docker روی Linux به این اسکریپت یا تولید تصویر نیاز ندارد. پس از تغییر فایل‌های کد، بسته‌های مشترک ساخته و تصویر فرانت‌اند Docker بازسازی شود؛ [راهنمای Docker محلی](CRM-DOCKER-LOCAL.fa.md) فرمان‌های آن را توضیح می‌دهد.

## نتیجهٔ بررسی و اعمال

نسخهٔ لوگو `b54a107fe6e1` روی Docker محلی با پروژهٔ `company-crm-local` اعمال شد. تصویر فرانت‌اند بازسازی و کانتینر آن جایگزین شد؛ API و Workerها برای بارگذاری template tag جدید دوباره راه‌اندازی شدند. migrator دوباره اجرا نشد.

- بررسی‌های TypeScript و lint در ۲۲ وظیفهٔ مرتبط موفق بودند.
- ۳۹ تست وب، شامل دسترسی‌پذیری و حالت‌های لوگوی مشترک، و ۱۱ تست قالب ایمیل موفق بودند.
- بازتولید تصاویر با اسکریپت از مسیر ثبت‌شده، فایل‌های تصویری یکسان تولید کرد.
- `check` جنگو و رندر قالب ایمیل با لوگوی جدید در API فعال موفق بودند.
- API و فرانت‌اند سالم‌اند و هر چهار پورت وب پاسخ ۲۰۰ دادند.
- ۸ بررسی Chrome موفق بودند: تطبیق فایل لوگو، favicon و آیکن‌های نصب هر سه برنامه، نمایش لوگوی کامل در ورود و نشان در منو، نبود سرریز موبایل، ورود مدیر موجود و نمایش صفحهٔ نقش‌ها. خطای JavaScript ثبت نشد.

گزارش و تصاویر بررسی مرورگر در `tmp/crm-branding-browser` قرار دارند و وارد Git نمی‌شوند. تصویر اصلی ارسالی بدون تغییر نگه داشته شده است؛ نسخه‌های شفاف با ابزار تصویر آماده شده‌اند.

## آماده‌سازی تصویر با imagegen

دو نسخهٔ شفاف با ابزار داخلی `image_gen` و مقدار `transparent_background=true` آماده شدند. تصویر اصلی حفظ شده است. متن فرمان‌های ویرایش:

```text
Edit target: the attached existing company logo. Use-case: background-extraction. Prepare this exact existing blue Amard company logo as a clean transparent PNG for a business application. Remove only the grey photographic wall and large diffuse glow outside the design. Preserve the exact oval emblem shape, Persian letter geometry, electric cobalt blue colors, light blue metallic 3D bevels, perspective, and ALL existing Persian calligraphy and year below the oval exactly as they appear in the source. Do not redraw, reinterpret, translate, replace, or add any lettering. The oval and its interior light-blue plate remain opaque; only the exterior photographic background is transparent. Keep the original composition with the emblem above the existing calligraphy and date, centered, tightly framed with a small transparent margin on all four sides. Crisp contour suitable for light and dark UI. No new symbol, no new text, no backdrop, no checkerboard baked into pixels. This is faithful extraction of the provided logo, not logo design.

Use case background-extraction / app icon asset. Edit this existing transparent logo. Remove ONLY the Persian calligraphy and year BELOW the oval. Preserve the entire blue oval emblem above exactly: all Persian letter geometry inside the oval, the same perspective, metallic cobalt colors and highlights, the branch flourish protruding upper-right, and existing clean transparent alpha. Do not redesign the symbol or alter its letterforms. Tight crop to the surviving emblem with small equal transparent margins around it; emblem should occupy most of a landscape canvas. No letters or text below the oval; no new text; no shadows outside its subtle existing edge; no white, black, or grey background. Output an actual alpha transparent PNG for a small app icon.
```
