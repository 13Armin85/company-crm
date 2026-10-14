# اجرای آخرین تغییرات با Docker محلی

پروژهٔ Docker این دستگاه `company-crm-local` است. فایل `docker-compose-workstation.yml` نام پروژه و تصویرهای همین محیط را مشخص می‌کند. فایل `.env.dev` تنظیمات فعلی را نگه می‌دارد و نباید هنگام به‌روزرسانی دوباره تولید شود.

## راه‌اندازی با یک فرمان

از PowerShell در ریشهٔ مخزن اجرا کنید:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

این فرمان در صورت نیاز Docker Desktop را روشن می‌کند، هر دو فایل Compose را اعمال می‌کند، ایمیج‌ها را می‌سازد و تا آماده‌شدن همهٔ سرویس‌ها منتظر می‌ماند. نصب Docker Desktop در پوشهٔ کاربر نیز شناسایی می‌شود. برای اجرای ایمیج‌های فعلی بدون بازسازی از `.\start.ps1 -NoBuild` استفاده کنید. روی لینوکس و macOS فرمان معادل `bash start.sh` است.

اسکریپت‌های قدیمی نام `plane-dev` را تحمیل می‌کردند؛ اکنون نام از فایل‌های Compose خوانده می‌شود تا همان `company-crm-local` و Volumeهای موجود انتخاب شوند. برای دستورات مستقیم نیز هر دو فایل زیر را به Compose بدهید.

در PowerShell، بررسی موتور خاموش نیز اصلاح شده است: خطای stderr فرمان `docker info` دیگر اسکریپت را پیش از روشن‌کردن Docker Desktop متوقف نمی‌کند.

| سرویس         | نشانی                                |
| ------------- | ------------------------------------ |
| CRM           | http://localhost:3000                |
| مدیریت سامانه | http://localhost:3001/god-mode/      |
| API           | http://localhost:8000/api/instances/ |
| pgAdmin       | http://localhost:5050                |

## بررسی اجرای اصلاح‌شده

ایمیج‌های API و فرانت‌اند از کد فعلی ساخته شدند و فرمان `start.ps1 -NoBuild` با پیام `Ready` پایان یافت. هر ۹ سرویس دائمی فعال‌اند؛ سرویس یک‌بارهٔ migrator با کد صفر پایان یافته است. بررسی Django و نبود migration معوق موفق بود و Worker پاسخ `pong` داد.

۲۲ تست راه‌اندازی موفق بودند و یک تست مخصوص قفل لینوکس روی ویندوز اجرا نشد. قالب‌بندی و lint تست‌ها نیز موفق بود. بررسی Chrome شامل ۱۸ مورد موفق بود: پاسخ ۲۰۰ هر هشت پورت، تنظیم instance، proxy مرورگر، ورود مدیر موجود، API دسترسی‌ها و صفحات پروژه‌ها، صندوق ورودی، تقویم، نقش‌ها، سازمان و تیم. هیچ خطای JavaScript یا پاسخ ۵۰۰ در این بررسی ثبت نشد. گزارش در `tmp/docker-runtime-smoke/results.json` ذخیره شده است.

پیش از راه‌اندازی، از دیتابیس فعلی در `tmp/docker-backups/` پشتیبان گرفته شد؛ همان Volumeها و حساب‌های موجود استفاده شدند.

## رفع خطای تأیید نشست در آدرس 127.0.0.1

بازکردن `http://127.0.0.1:3000` با API تنظیم‌شده روی `http://localhost:3000` باعث مسدودشدن درخواست نشست در مرورگر می‌شد. سرور توسعه اکنون پیش از بارگذاری رابط، آدرس‌های loopback هم‌پورت را به `VITE_WEB_BASE_URL` هدایت می‌کند؛ مسیر و query حفظ می‌شوند و کوکی ورود، API و هدایت‌های Backend روی یک میزبان باقی می‌مانند. این هدایت فقط در سرور توسعه اعمال می‌شود.

ترکیب signalهای لغو درخواست نیز برای مرورگر فاقد `AbortSignal.any` پشتیبانی جایگزین دارد؛ پایان نشست همچنان درخواست‌ها را لغو می‌کند و listenerها پس از تکمیل یا خطا پاک می‌شوند. تست‌های مرتبط در `apps/web/app/crm/access/request-signals.test.ts`، `session.test.tsx` و `local-origin.test.ts` قرار دارند. تست مرورگر `apps/web/tests/browser/crm-session.mjs` ورود از `127.0.0.1`، حفظ نشست پس از reload، خطای موقت شبکه و تلاش دوباره، بازگشت صفحه و نشست پایان‌یافته را با حساب توسعه بررسی می‌کند. گزارش در `tmp/crm-session-browser/report.json` ذخیره می‌شود.

ایمیج اصلاح‌شده جایگزین شد و فرانت‌اند در وضعیت healthy قرار گرفت. ۱۹ تست نشست و آدرس محلی، ۸ تست تقویم و بررسی TypeScript موفق بودند. تست مرورگر روی کانتینر نهایی نیز هر ۱۱ بررسی را بدون خطای JavaScript یا پاسخ ۵۰۰ گذراند.

## نمایش فارسی صندوق ورودی

صندوق ورودی و پنل اعلان‌ها توضیح رویداد را به فارسی نمایش می‌دهند: انجام‌دهنده، نام کار، نام پروژه و تغییرهای وضعیت، اولویت، موعد یا مسئول کار. مقادیر سیستمی مثل `high` و `In Progress` به برچسب‌های فارسی تبدیل می‌شوند و حساب پیش‌فرض `admin` با عنوان «مدیر سامانه» نمایش داده می‌شود. پیش‌نمایش فهرست کوتاه است؛ پنجرهٔ جزئیات، متن کامل نظرها و مقادیر قبلی و جدید را نشان می‌دهد.

نام پروژه و عنوان کار برای اعلان‌های قدیمی نیز از همان پروژه و شرکت دریافت می‌شوند؛ نیازی به بازنویسی اعلان‌ها یا migration نیست. اطلاعات ذخیره‌شده و وضعیت خوانده‌شدن اعلان‌ها حفظ می‌شوند. ۱۸ تست نمایش اعلان و ۷ تست API موفق بودند. تست مرورگر `apps/web/tests/browser/crm-inbox.mjs` نیز ۲۴ سناریو، شامل ترجمه و جزئیات رویداد در موبایل، دسکتاپ و هر دو پوسته را گذراند. گزارش در `.cache/browser/docker-inbox/report.json` قرار دارد.

## اعلان‌های هدر و رویدادهای مهم

هدر، تعداد اعلان‌های خوانده‌نشده را با رقم فارسی نشان می‌دهد. در صفحهٔ فعال، اعلان‌ها هر ۱۵ ثانیه تازه می‌شوند و هنگام بازکردن پنل، بازگشت به مرورگر یا وصل‌شدن دوبارهٔ شبکه نیز دریافت می‌شوند. پنل گزینه‌های «همه» و «خوانده‌نشده» دارد؛ خطای دریافت، اطلاعات قبلی را پاک نمی‌کند و دکمهٔ تلاش دوباره نمایش داده می‌شود. خواندن یک اعلان یا همهٔ اعلان‌ها، هدر و صندوق ورودی را هم‌زمان به‌روز می‌کند.

رویدادهای جدید شامل واگذاری و انتقال کارهای خارج از پروژه، تغییر وضعیت، اولویت یا موعد آن‌ها، ارجاع خودکار، ورود کار به صف نقش، پذیرش آن از صف و ورود موفق به حساب CRM است. اعلان ورود فقط برای همان حساب و فضای کاری فعال آن ثبت می‌شود و بررسی دوبارهٔ نشست یا تازه‌کردن صفحه، اعلان ورود دیگری نمی‌سازد. اعلان واگذاری برای گیرندهٔ کار است؛ تغییرهای مهم برای مسئول یا ایجادکنندهٔ مرتبط ثبت می‌شوند و اعلان عملیات خود شخص دوباره به او ارسال نمی‌شود. کاربران غیرفعال و اشخاص خارج از فضای کاری گیرنده نیستند.

نظرها، اشاره‌ها و تغییرهای کار پروژه از مسیر فعالیت‌های فعلی دریافت می‌شوند. مسئولی که از طریق ارجاع سازمانی انتخاب شده نیز به‌روزرسانی‌های بعدی کار را دریافت می‌کند. پنجرهٔ جزئیات برای اعلان ورود، صف و کار خارج از پروژه، پیوند مناسب حساب کاربری، صف کارها یا کارهای من دارد.

تست‌های مرتبط در `apps/api/plane/tests/contract/app/test_crm_notification_events.py`، `apps/web/app/crm/inbox.test.ts` و `apps/web/tests/browser/crm-header-notifications.mjs` هستند. ۴۸ سناریوی مرورگر مربوط به اعلان‌ها موفق بودند. برای اعمال تغییرها، تصویر نهایی رابط را بازسازی و Worker را راه‌اندازی مجدد کنید تا تغییر گیرنده‌های اعلان بارگذاری شود.

## تغییر وضعیت از نمای لیست

در ردیف کارها، وضعیت یک انتخابگر مستقیم است و گزینه‌های «برای انجام»، «در حال انجام»، «بازبینی»، «انجام‌شده» و «مسدود» را نمایش می‌دهد. این کنترل در لیست همهٔ کارها، کارهای من، لیست پروژه و فهرست‌های داشبورد مشترک است. فقط کاربر مجاز و مسئول کار یا ویرایشگر می‌تواند وضعیت را تغییر دهد؛ هنگام ذخیره کنترل موقتاً غیرفعال می‌شود و شکست درخواست، وضعیت قبلی را بازمی‌گرداند.

migration شمارهٔ `0132_crm_review_state` وضعیت بازبینی را برای پروژه‌های قدیمی فاقد آن اضافه می‌کند؛ وضعیت فعلی کارها و وضعیت‌های سفارشی تغییر نمی‌کنند. آماده‌سازی دادهٔ توسعه نیز بازبینی را برای پروژه‌های نمونه ایجاد می‌کند و گروه کارهای در حال انجام را حفظ می‌کند. تست‌های کنترل لیست، migration و رفتار مرورگر به‌ترتیب در `issue-row.test.tsx`، `test_crm_review_state.py` و `crm-list-status.mjs` قرار دارند. بررسی TypeScript، ۳۶ تست API، ۱۵۴ تست رابط و ۵۸ سناریوی مرورگر، شامل ۱۰ سناریوی تغییر وضعیت از لیست، موفق بودند.

برای اعمال این تغییرها به Docker موجود، پس از تهیهٔ پشتیبان دیتابیس اجرا کنید:

```powershell
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml exec -T api python manage.py migrate --noinput
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build api frontend
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-deps --no-build --wait --wait-timeout 900 api worker beat-worker frontend
```

## فیلتر دقیق پروژه‌ها و کارها

دکمهٔ «فیلتر» در پروژه‌ها و همهٔ کارها، پنجرهٔ انتخاب معیارها را باز می‌کند. کارها با وضعیت، اولویت، پروژه یا خارج از پروژه، مسئول یا بدون مسئول و موعد فیلتر می‌شوند. پروژه‌ها با اعضا، مدیر، بازهٔ درصد پیشرفت و موعد فیلتر می‌شوند. در هر بخش می‌توان چند گزینه انتخاب کرد؛ نتیجه باید با دست‌کم یکی از آن‌ها و با شرط‌های بخش‌های دیگر مطابقت داشته باشد.

موعدها با بازهٔ تاریخ شمسی و گزینه‌های امروز، آینده، گذشته و انجام‌نشده، دارای موعد یا بدون موعد قابل انتخاب‌اند. شمارش نتیجه پیش از «اعمال فیلتر» نمایش داده می‌شود. انصراف و کلید Escape تغییرهای اعمال‌نشده را کنار می‌گذارند. «بازنشانی انتخاب‌ها» داخل پنجره، فقط معیارهای فیلتر را پاک می‌کند؛ تب فعلی و متن جستجوی صفحه حفظ می‌شوند. فیلتر اعمال‌شده بین نماهای کارت، لیست و برد همان صفحه باقی می‌ماند.

قواعد فیلتر در `apps/web/app/crm/filter-rules.test.ts` و رفتار مرورگر در `apps/web/tests/browser/crm-filters.mjs` بررسی می‌شوند. آزمون مرورگر از داده‌های ساختگی استفاده می‌کند و گزارش و تصویرهای موبایل و دسکتاپ را در `.cache/browser/docker-filters/` ذخیره می‌کند. پنجرهٔ مشترک در `@plane/ui` همراه با نمونهٔ Storybook قرار دارد. برای اعمال تغییر به محیط محلی، تصویر `frontend` را طبق بخش «به‌روزرسانی رابط» بازسازی کنید.

تشخیص وضعیت نیز اصلاح شده است: گروه `unstarted` دیگر به‌علت داشتن زیررشتهٔ `started` به «در حال انجام» تبدیل نمی‌شود. وضعیت گروه‌های معتبر پیش از بررسی نام سفارشی مشخص می‌شود و بازبینی در گروه کارهای در حال انجام پشتیبانی می‌شود. تست‌های این مورد در `apps/web/app/crm/issue-status.test.ts` هستند. ۱۴۳ تست رابط، ۲۴ سناریوی مرورگر و بررسی TypeScript برنامه و بستهٔ رابط موفق بودند.

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

## اعمال تیکت ۳ و تقویم‌های شمسی در محیط موجود

برای این به‌روزرسانی، migration جدید را روی API موجود اجرا کنید، Backend را راه‌اندازی مجدد کنید و تصویر رابط را جایگزین کنید. این فرمان‌ها migrator آماده‌سازی اولیه و ساخت دادهٔ نمونه را اجرا نمی‌کنند و از Volumeهای فعلی استفاده می‌کنند:

```powershell
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml exec -T api python manage.py migrate --noinput
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml restart api worker beat-worker
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build --build-arg NPM_REGISTRY=https://registry.npmjs.org/ frontend
docker compose --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-deps --no-build --wait --wait-timeout 900 frontend
```

نشانی CRM همان `http://localhost:3000` است. تقویم اصلی و تب تقویم هر پروژه، ماه و سال شمسی قابل انتخاب دارند. انتخابگرهای موعد کار/پروژه، شروع و پایان چرخه، عدم حضور و بازهٔ استثنای قدیمی نیز از تقویم شمسی مشترک استفاده می‌کنند. جزئیات بررسی در [گزارش تیکت ۳](TICKET-3-IMPLEMENTATION.fa.md) آمده است.

## به‌روزرسانی رابط

برای تغییر کد و ظاهر صفحات، فرانت‌اند را بازسازی و جایگزین کنید:

```powershell
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml build frontend
docker compose --project-name company-crm-local --env-file .env.dev -f docker-compose-dev.yml -f docker-compose-workstation.yml up -d --no-deps --no-build --wait --wait-timeout 900 frontend
```

بازطراحی جانشینان و فهرست مجوزها در [راهنمای رابط دسترسی](CRM-ACCESS-UI.fa.md) توضیح داده شده است.

کنترل روز، ماه و سال بالای تقویم اصلی و تقویم هر پروژه از `PersianCalendarNavigation` مشترک استفاده می‌کند. ماه جاری و تعداد موعدها، انتخاب ماه/سال با جست‌وجوی فارسی، رفتن مستقیم به یک روز مشخص و بازگشت به امروز در این نوار قرار دارند. روز انتخاب‌شده در شبکهٔ تقویم برجسته می‌شود. جابه‌جایی بین ماه‌ها یا سال‌ها، روز را در صورت معتبر بودن حفظ می‌کند و برای پایان ماه یا اسفند غیرکبیسه به آخرین روز معتبر می‌برد؛ این کنترل موعد کارها را تغییر نمی‌دهد.

تست رفتار تاریخ در `apps/web/app/crm/calendar.test.tsx` است. برای بررسی مرورگر این بخش، متغیر `CRM_BROWSER_SCOPE=navigation` را تنظیم و `node apps/web/tests/browser/crm-calendars.mjs` را اجرا کنید. نمونه‌های مستقل دسکتاپ، موبایل، تم تیره و اسفند کبیسه در Storybook بخش `Forms/PersianCalendarNavigation` هستند.

صف کارهای نقش‌ها در `/routing` پیش از قانون‌های ارجاع نمایش داده می‌شود. کارت‌های فارسی، نقش مورد نیاز، پروژه، مسیر ارجاع، تاریخ شمسی ورود و زمان انتظار را نشان می‌دهند. جست‌وجوی فارسی، فیلتر هم‌زمان نقش و پروژه و مرتب‌سازی قدیمی‌ترین/جدیدترین در دسترس است. صف هر ۳۰ ثانیه تازه می‌شود؛ پس از پذیرش موفق، کارت از صف خارج می‌شود. کاربران بدون مجوز دریافت، دکمهٔ پذیرش نمی‌بینند. خطای اتصال با امکان تلاش دوباره نمایش داده می‌شود و اطلاعات قبلی حفظ می‌شوند.

تست اختصاصی صف: `pnpm --filter web exec vitest run app/crm/role-queue.test.tsx`. بررسی مرورگر روی Docker: `node apps/web/tests/browser/crm-role-queue.mjs`؛ داده‌های این بررسی ساختگی‌اند و صف واقعی را تغییر نمی‌دهند. تصاویر تم روشن/تیره و موبایل/دسکتاپ و گزارش تست در `.cache/browser/docker-role-queue` ذخیره می‌شوند.

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
