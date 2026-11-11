# تیکت ۳ از ۸ | برنامهٔ کاری و دسترس‌پذیری فرد — گزارش تحویل

> وضعیت: پیاده‌سازی کامل است و تست‌های backend، frontend و E2E سبزند. هنوز هیچ commitی انجام نشده است.
> طبق تیکت، سامانهٔ ورود/خروج، حضور و غیاب، تشخیص خودکار غیبت و محاسبهٔ حقوق، تأخیر و اضافه‌کاری ساخته **نشد**.

## ۱. جدول خلأ (پیش و پس از کار)

| بند تیکت | پیش از کار | تصمیم | پس از کار |
|---|---|---|---|
| سرویس تقویم کاری | وجود نداشت. فقط `DashboardTeamSettings.workday_*` بود که تنظیم مدیر برای هشدار داشبورد تیم است | ساخت سرویس واحد | `app/services/work_calendar.py`، تنها مرجع برنامه، دسترس‌پذیری و حساب زمان کاری. فقط می‌خواند و هیچ غیبت، اعلان یا رکوردی نمی‌سازد |
| ترتیب اولویت | — | ساخت | استثنای تاریخ‌دار فرد > برنامهٔ هفتگی فرد > نزدیک‌ترین واحد و سپس واحدهای بالادست > برنامهٔ شرکت > پیش‌فرض داخلی (شنبه تا پنجشنبه ۸ تا ۱۶، جمعه تعطیل) |
| برنامهٔ هفتگی و تاریخچه | — | ساخت | نسخه‌های `WorkSchedule` با `effective_from` و `effective_to`. نسخهٔ قبلی فقط بسته می‌شود و حذف یا ویرایش نمی‌شود. تداخل نسخه‌ها رد می‌شود. تاریخ گذشته فقط با `WorkSchedule.EditPast` |
| استثنای تاریخ‌دار | — | ساخت | `WorkScheduleException` (تاریخ یا بازه، ساعت متفاوت یا غیرکاری، لغو با سابقه) |
| جلسه، مأموریت و رویداد | — | یک مدل با `kind` | `WorkEvent` و `WorkEventParticipant` با `private_note` جدا. تداخل و خارج از ساعت کاری فقط هشدار می‌دهند |
| حریم رویداد | — | فیلتر سمت سرور | `serialize_event` برای همکار غیرمجاز فقط بازه و «در دسترس نیست» برمی‌گرداند. عنوان، توضیح و یادداشت اصلاً در پاسخ API نیستند (با تست) |
| اعلام حضور موردی | — | ساخت | `PresenceDeclaration`: فقط در روز غیرکاری، حداکثر یکی در روز (constraint دیتابیس)، لغو با سابقه، برچسب «اعلام‌شده توسط خود فرد» |
| گزارش روزانه | ماژولی وجود نداشت | ساخته نشد (طبق تیکت) | فقط endpoint `pending/` و بخش «موارد منتظر تأیید شما». تأیید فقط توسط خود فرد ممکن است، حتی مدیر نمی‌تواند (`ActivityConfirmation`) |
| مدیر مستقیم و بالادست | منطق درون `can_manage_absence` | استخراج تابع مشترک | `access_control.management_relation` (و `manager_chains`) بین مرخصی و برنامهٔ کاری مشترک است. جانشین واحد جزو scope نیست، مثل مرخصی |
| داشبورد تیم | ساعت کاری از `DashboardTeamSettings` | جدا ماند | این تنظیم «پنجرهٔ هشدار مدیر» است، نه برنامهٔ افراد. فقط منطقهٔ زمانی از `calendar_zone` خوانده می‌شود. خروجی داشبورد تغییری نکرد (تست رگرسیون) |
| زمان هدف تیکت | فقط `target_date` روزانه | استفاده از سرویس | `ticket_core.py` (تیکت ۵) مهلت را با `add_working_time` و `working_minutes_between` حساب می‌کند. روز غیرکاری و استراحت شمرده نمی‌شوند |
| ارجاع هوشمند | فقط `UserAbsence` بررسی می‌شد | استفاده از سرویس | `ticket_routing.py` دسترس‌پذیری را از `availability` می‌خواند |
| تقویم | فقط موعد کارها | گسترش همان صفحه | `/calendar` لایه‌های قابل‌فیلتر دارد: موعد کارها، برنامهٔ هفتگی، استثنای تاریخ‌دار، روز غیرکاری، جلسه، مأموریت، رویداد کاری، اعلام حضور موردی، مرخصی و «در دسترس نیست». انتخابگر فرد فقط افراد مجاز را نشان می‌دهد. تاریخ‌ها شمسی‌اند |
| منطقهٔ زمانی | `time_zone` در workspace | استفادهٔ مجدد | `calendar_zone(workspace)` با پیش‌فرض `Asia/Tehran` |

## ۲. فایل‌ها

**Backend (جدید):**
- `apps/api/plane/db/models/work_calendar.py`
- `apps/api/plane/db/migrations/0154_work_calendar.py` و `0155_work_calendar_permissions.py`
- `apps/api/plane/app/services/work_calendar.py` (خواندن و حساب زمان) و `work_calendar_actions.py` (نوشتن، دسترسی و serialize)
- `apps/api/plane/app/views/workspace/work_calendar.py` و `apps/api/plane/app/urls/work_calendar.py`
- `apps/api/plane/tests/contract/app/test_work_calendar.py` (۲۱ تست)

**Backend (تغییر افزایشی):**
- `db/models/__init__.py`
- `app/services/access_control.py` (تابع مشترک `management_relation`)
- `app/services/permission_registry.py`
- `app/urls/__init__.py`
- `app/views/workspace/dashboard.py` (فقط `calendar_zone`)
- `app/services/ticket_routing.py` (`availability`)

**Frontend:**
- `apps/web/app/crm/api/work-calendar.ts`
- `apps/web/app/crm/work-calendar/{model.ts,components.tsx,work-calendar.test.tsx}`
- `apps/web/styles/work-calendar.css`
- `apps/web/app/crm/pages/calendar.tsx` و `apps/web/app/crm/issue-calendar.tsx` (لایه‌ها)
- `apps/web/tests/browser/crm-work-calendar-acceptance.mjs`

## ۳. Migrationها
- **0154_work_calendar**: هفت جدول جدید (`WorkSchedule`، `WorkScheduleDay`، `WorkScheduleException`، `WorkEvent`، `WorkEventParticipant`، `PresenceDeclaration` و `ActivityConfirmation`). Constraintها:
  - بازهٔ معتبر نسخه و رویداد
  - یک اعلام حضور فعال در روز
  - یک تأیید برای هر منبع
  - شرکت‌کنندهٔ یکتا
- **0155_work_calendar_permissions**: فقط با `get_or_create` مجوزها را به workspaceهای موجود اضافه می‌کند.
- هر دو فقط افزایشی‌اند و روی dev اجرا شده‌اند. `UserAbsence` و `DashboardTeamSettings` دست نخوردند.

## ۴. مجوزها

| کد | برچسب | نقش پیش‌فرض |
|---|---|---|
| `WorkSchedule.ViewOwn` | مشاهده برنامه کاری خود | admin، member |
| `WorkSchedule.EditOwn` | ویرایش برنامه کاری خود | admin |
| `WorkSchedule.ViewTeam` | مشاهده برنامه کاری زیرمجموعه مستقیم | admin |
| `WorkSchedule.EditTeam` | ویرایش برنامه کاری زیرمجموعه مستقیم | admin |
| `WorkSchedule.ViewHierarchy` | مشاهده برنامه کاری زیرمجموعه‌های غیرمستقیم | admin |
| `WorkSchedule.EditPast` | ثبت تغییر برنامه کاری با تاریخ گذشته | admin |
| `WorkSchedule.ManageDefaults` | مدیریت برنامه کاری پیش‌فرض شرکت و واحدها | admin |
| `WorkEvent.Create` | ایجاد جلسه، مأموریت و رویداد کاری | admin، member |
| `WorkEvent.Manage` | مدیریت رویدادهای کاری زیرمجموعه | admin |

همهٔ نوشتن‌ها داخل `transaction.atomic` و با قفل `select_for_update` روی مالک برنامه انجام می‌شوند. هر ساخت، بستن، لغو و تأیید یک `EntityEvent` با actor، before، after و reason ثبت می‌کند.

## ۵. سرویس `work_calendar` و مصرف‌کننده‌ها
- **توابع:** `schedule_for`، `schedule_range`، `availability`، `busy_blocks`، `working_minutes_between`، `add_working_time`، `is_outside_working_hours`، `calendar_zone` و `local_today`
- **مصرف‌کننده‌ها:**
  - endpointهای تقویم کاری
  - `ticket_core.py` (مهلت و SLA تیکت)
  - `ticket_routing.py` (دسترس‌پذیری در ارجاع)
  - `workflow_engine.py` و `workflow_actions.py` (مهلت مراحل)
  - `dashboard.py` (منطقهٔ زمانی)

## ۶. تست‌ها

| نوع | نتیجه |
|---|---|
| pytest در Docker: `test_work_calendar.py` | ۲۱ از ۲۱ سبز |
| vitest: `work-calendar.test.tsx` | ۹ از ۹ سبز |
| E2E: `crm-work-calendar-acceptance.mjs` روی Docker dev | ۸ از ۸ مرحله سبز |
| oxlint روی فایل‌های تقویم | ۰ خطا، ۳ هشدار سبک |
| tsc برای `apps/web` | بدون خطا در فایل‌های این تیکت. خطاهای موجود فقط در `workflow/designer.tsx` (`toSorted`، تیکت ۴) هستند |

تست‌های منفی صریح:
- نبودِ اعلام حضور هیچ `UserAbsence`، `Notification` یا رکوردی نمی‌سازد.
- تغییر برنامه تعداد مرخصی‌ها را عوض نمی‌کند.
- رویداد گذشته بدون تأیید خود فرد «انجام‌شده» نیست.
- مدیر نمی‌تواند به‌جای فرد تأیید کند.

**نکتهٔ محیط تست:**
- کانتینر `test-mq` (RabbitMQ) روی این دستگاه به‌خاطر دسترسی tmpfs به `.erlang.cookie` بالا نمی‌آید. برای این تست‌ها لازم نیست؛ با `--no-deps` بعد از `up -d test-db test-redis test-minio` اجرا شدند.
- اجرای هم‌زمان دو کانتینر `api-tests` روی `test_plane` باعث خطای setup «database is being accessed by other users» می‌شود. این خطا ربطی به کد ندارد.

## ۷. کارهایی که عمداً انجام نشد
- **ماژول کامل گزارش روزانه:** وجود نداشت و طبق تیکت ساخته نشد. فقط «موارد منتظر تأیید شما» برای اتصال بعدی آماده است.
- **ماژول کامل تعطیلات رسمی:** فقط برنامهٔ پیش‌فرض شرکت و واحد هست (`defaults/`). روز تعطیل خاص با استثنای تاریخ‌دار ثبت می‌شود.
- **ساعت `DashboardTeamSettings`:** به برنامهٔ افراد منتقل نشد، چون معنای آن «پنجرهٔ هشدار مدیر» است و انتقالش رفتار داشبورد را تغییر می‌داد.
