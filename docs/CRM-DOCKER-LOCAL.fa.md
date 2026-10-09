# اجرای آخرین تغییرات با Docker محلی

پروژهٔ Docker این دستگاه `company-crm-local` است. فایل `docker-compose-workstation.yml` نام پروژه و تصویرهای همین محیط را مشخص می‌کند. فایل `.env.dev` تنظیمات فعلی را نگه می‌دارد و نباید هنگام به‌روزرسانی دوباره تولید شود.

| سرویس         | نشانی                                |
| ------------- | ------------------------------------ |
| CRM           | http://localhost:3000                |
| مدیریت سامانه | http://localhost:3001/god-mode/      |
| API           | http://localhost:8000/api/instances/ |
| pgAdmin       | http://localhost:5050                |

## به‌روزرسانی بعدی

دستورات زیر را در PowerShell و ریشهٔ همین مخزن اجرا کنید. ابتدا نسخهٔ پشتیبان دیتابیس تهیه شود. اطلاعات ورود از `.env.dev` خوانده می‌شوند؛ حساب‌های موجود رمز فعلی خود را حفظ می‌کنند.

```powershell
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build api frontend
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml stop api worker beat-worker frontend
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-build --force-recreate migrator
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-build --wait --wait-timeout 900
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml ps -a
```

شروع API و Workerها به موفقیت migrator وابسته است. این سرویس migrationها، آماده‌سازی محیط توسعه، داده‌های نمونه، تنظیم instance و آماده‌سازی storage را اجرا می‌کند. Backend کد `apps/api` را از مخزن می‌خواند؛ کد فرانت‌اند داخل تصویر قرار دارد و به بازسازی نیاز دارد. نام پروژه باید ثابت بماند تا همان Volumeهای PostgreSQL و فایل‌ها استفاده شوند.

برای بررسی خطای راه‌اندازی:

```powershell
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml logs --tail 100 migrator api frontend
```

## به‌روزرسانی رابط

برای تغییر کد و ظاهر صفحات، فرانت‌اند را بازسازی و جایگزین کنید:

```powershell
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build frontend
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-deps --no-build --wait --wait-timeout 900 frontend
```

بازطراحی جانشینان و فهرست مجوزها در [راهنمای رابط دسترسی](CRM-ACCESS-UI.fa.md) توضیح داده شده است.

## به‌روزرسانی لوگو

برای تغییر لوگو و قالب‌های ایمیل که migration یا وابستگی جدید Backend ندارند، این فرمان‌ها کافی هستند:

```powershell
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build frontend
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml restart api worker beat-worker
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-deps --no-build --wait --wait-timeout 900 frontend
```

`--no-deps` باعث می‌شود migrator و آماده‌سازی داده‌های نمونه دوباره اجرا نشوند. فایل‌های اصلی و روند تولید آیکن‌ها در [راهنمای لوگو](CRM-BRANDING.fa.md) آمده‌اند.

## پشتیبان و بررسی انتقال فعلی

پیش از انتقال، PostgreSQL در قالب custom پشتیبان‌گیری شد:

`tmp/docker-backups/crm-before-access-20261009-035903.dump`

این پشتیبان روی دیتابیس آزمایشی جدا بازیابی شد و migrationهای 0129 و 0130 روی آن موفق بودند. شناسه‌های موجود در ۱۴ مدل، از جمله ۸ کاربر، ۱ شرکت، ۳ پروژه، ۱۶ تیکت، ۸ نقش قبلی و روابط سازمانی/ارجاع، حفظ شدند. رمزهای کاربران نیز تغییر نکردند.

همین بررسی پس از migration و آماده‌سازی محیط روی دیتابیس اصلی Docker محلی نیز موفق بود. تعداد کاربران، شرکت‌ها، پروژه‌ها و تیکت‌ها ثابت ماند؛ ۲ نقش سیستمی و روابط دسترسی جدید اضافه شدند. همگام‌سازی کاتالوگ، `check`، `migrate --check` و `makemigrations --check --dry-run` در API فعال موفق بودند. تست مستقل مهاجرت نیز با نتیجهٔ `1 passed` پایان یافت.

تصویر فرانت‌اند بازسازی و کانتینر آن با نسخهٔ جدید جایگزین شد. سلامت API و فرانت‌اند در Docker تأیید شد و هر چهار پورت وب پاسخ ۲۰۰ دادند. بررسی Chrome با ۴ سناریوی موفق و بدون خطای JavaScript، ورود مدیر موجود، نمایش نقش‌ها و کاتالوگ جدید، بارگذاری فونت فارسی محلی، بسته بودن صفحات خصوصی برای کاربر ناشناس و پاسخ `access/me/` با `no-store` را تأیید کرد. ثبت‌نام عمومی نیز غیرفعال است.

خطای اولیهٔ `cannot ALTER TABLE ... because it has pending trigger events` در migration 0129 با بررسی قیدهای معوق قبل از حذف ستون‌ها اصلاح شد. تست مهاجرت نیز اجرای نخست روی دادهٔ قدیمی را مستقیماً بررسی می‌کند. توضیح انتقال و بازگشت در [راهنمای migration](CRM-ACCESS-MIGRATION.fa.md) آمده است.

فایل پشتیبان و گزارش‌های بررسی داخل `tmp` هستند و وارد Git نمی‌شوند؛ پشتیبان شامل داده‌های خصوصی دیتابیس است.
