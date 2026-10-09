# گزارش بازطراحی دسترسی company-crm

این تغییر روی معماری موجود Plane/Django/React پیاده‌سازی شده است. نتیجهٔ بررسی‌ها در بخش M آمده است. اجرای مهاجرت و تست‌ها روی PostgreSQL مجزای Docker انجام شد؛ دیتابیس محیط عملیاتی تغییر نکرد.

[گزارش مأموریت کامل](CRM-ACCESS-IMPLEMENTATION.fa.md)، [قرارداد API](CRM-ACCESS-API.fa.md)، [کاتالوگ مجوزها](CRM-PERMISSION-CATALOG.md) و [راهنمای انتقال](CRM-ACCESS-MIGRATION.fa.md) جزئیات تکمیلی نسخهٔ فعلی را ارائه می‌کنند.

## A. معماری جدید پیاده‌سازی‌شده

مرجع مجوزهای فنی، رجیستری توسعه‌دهنده در `plane/app/services/permission_registry.py` است: ۵۲ کد پایدار در ۱۱ دسته. نقش‌های فعال، استثناهای مستقیم کاربر و جانشینی موقت در یک سرویس مرکزی به دسترسی مؤثر تبدیل می‌شوند.

`get_effective_permissions`، `has_permission` و `explain_permission` در `access_control.py` استفاده می‌شوند. Backend هم مجوز عملیات و هم محدودهٔ Workspace/Project را بررسی می‌کند. React فقط کدهای دسترسی مؤثرِ Backend را مصرف می‌کند؛ منطق نقش یا جانشینی را دوباره محاسبه نمی‌کند.

`WorkspaceScopePermission` و `ProjectScopePermission` محدودهٔ عضویت را از مجوز انجام عملیات جدا می‌کنند. نقش سفارشی دارای مجوز ایجاد/ویرایش پروژه یا مدیریت اعضای آن، برای انجام این عملیات به مقدار عددی مدیر Plane وابسته نیست.

## B. Database Changes

- حذف `OrganizationRole.level` و `required_level` از قوانین و صف مسیریابی.
- افزودن `description` و `system_key` به نقش؛ نگه‌داری تخصیص چند نقش فعال به یک کاربر.
- افزودن دسته و قابلیت انتقال در جانشینی به Permission؛ کدها حداکثر ۱۰۰ کاراکتر و شامل نقطه هستند.
- مدل `UserPermissionException`: کاربر، Workspace، مجوز، ALLOW/DENY، شروع/پایان اختیاری و وضعیت فعال.
- مدل `OrganizationUnitDelegate`: واحد، کاربر، اولویت مثبت و وضعیت فعال؛ محدودیت یکتایی جانشین و اولویت فعال در هر واحد.
- مدل `UserAbsence`: کاربر، Workspace، شروع، پایان، علت و وضعیت scheduled/cancelled/ended.
- اعتبارسنجی عضویت فعال، نقش/مجوز متعلق به همان Workspace، سلسله‌مراتب بدون چرخه، پایان بعد از شروع و عدم هم‌پوشانی غیبت‌های برنامه‌ریزی‌شده.
- ساختار درختی، مدیر و اعضای واحدهای قبلی حفظ شده‌اند.

## C. Migrations

`0128_crm_access_control` مدل‌ها، فیلدها، indexها و constraintهای جدید را اضافه می‌کند.

`0129_crm_access_data` ابتدا مقادیر قدیمی Level و آستانه‌های مسیریابی را در مدل موجود `APIActivityLog` با شناسهٔ `crm-migration:` آرشیو می‌کند، کاتالوگ را همگام می‌کند، نقش‌های پیش‌فرض و تخصیص کاربران موجود را می‌سازد و سپس فیلدهای قدیمی را حذف می‌کند. تعریف کاتالوگ در migration ثابت است و به کد runtime وابسته نیست.

برگشت از 0129 به 0128، مقادیر قدیمی را از آرشیو بازمی‌گرداند. پاک‌سازی دوره‌ای لاگ، این آرشیو مهاجرت را حذف نمی‌کند. تست مهاجرت از دیتابیس دارای داده، اجرای دوبارهٔ انتقال و rollback را پوشش می‌دهد.

مجوزهای فعال قدیمی تیکت به کدهای متناظر جدید منتقل می‌شوند و ارتباط‌های اصلی حفظ می‌شوند. وضعیت اولیهٔ مجوزها و شناسهٔ ارتباط‌های ساخته‌شده در انتقال نیز برای rollback آرشیو می‌شوند. `0130_crm_exception_constraints` اثر معتبر و تکرار دقیق استثنا را محدود می‌کند؛ رکوردهای دقیقاً تکراری با حفظ داده و آرشیو، غیرفعال می‌شوند. جزئیات نگاشت و بازگشت در راهنمای انتقال آمده‌اند.

برای اعمال روی محیط مقصد، با روال استقرار همان محیط اجرا شود:

```sh
python manage.py migrate
python manage.py sync_crm_permissions
```

`sync_crm_permissions --workspace <slug>` همگام‌سازی یک Workspace را انجام می‌دهد. اجرای مجدد، نقش و تخصیص تکراری ایجاد نمی‌کند و تغییرات عمدی نقش‌های موجود را بازنویسی نمی‌کند.

## D. Backend Files Changed

مسیرها در این بخش نسبت به `apps/api/plane/` هستند.

| بخش                  | فایل‌ها                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| مدل و راه‌اندازی     | `db/models/organization.py`، `db/models/__init__.py`، `db/apps.py`، `db/signals/crm_access.py`                                                                                        |
| کاتالوگ و موتور      | `app/services/permission_registry.py`، `app/services/access_control.py`، `app/services/access_mutations.py`، `app/permissions/crm.py`                                                 |
| فرمان‌ها             | `db/management/commands/sync_crm_permissions.py`، `db/management/commands/seed_enterprise_demo.py`                                                                                    |
| مهاجرت               | `db/migrations/0128_crm_access_control.py`، `db/migrations/0129_crm_access_data.py`                                                                                                   |
| API سازمان و کاربران | `app/serializers/organization.py`، `app/views/workspace/organization.py`، `app/views/workspace/access.py`، `app/views/workspace/member.py`، `app/urls/workspace.py`                   |
| عملیات موجود CRM     | `app/views/workspace/task.py`، `app/services/ticket_routing.py`، `app/views/project/base.py`، `app/views/project/member.py`، `app/views/issue/base.py`، `app/views/workspace/base.py` |
| API کلیدمحور         | `api/views/project.py`، `api/views/issue.py`، `api/views/member.py`، `api/serializers/member.py`                                                                                      |
| ورود و عضویت         | `authentication/views/app/email.py`، `authentication/utils/workspace_project_join.py`، `app/views/workspace/invite.py`، `app/views/user/base.py`                                      |
| Audit                | `middleware/logger.py`، `bgtasks/cleanup_task.py`                                                                                                                                     |

مسیرهای جدید، زیر `/api/workspaces/<slug>/`:

| مسیر                                                 | عملیات                                |
| ---------------------------------------------------- | ------------------------------------- |
| `access/me/`                                         | GET دسترسی مؤثر کاربر جاری            |
| `organization/users/<id>/effective-permissions/`     | GET دسترسی مؤثر و منبع هر مجوز        |
| `organization/users/<id>/exceptions/`                | GET/POST استثناهای مستقیم             |
| `organization/users/<id>/exceptions/<exception_id>/` | PATCH/DELETE استثنا                   |
| `organization/users/<id>/password/`                  | POST تغییر رمز با تأیید               |
| `organization/users/<id>/membership/`                | DELETE حذف از Workspace               |
| `organization/units/<id>/delegates/`                 | GET/PUT جانشینان مرتب                 |
| `organization/absences/`                             | GET/POST عدم حضور                     |
| `organization/absences/<id>/`                        | PATCH/DELETE ویرایش یا پایان عدم حضور |

API کاتالوگ فقط GET دارد؛ ساخت، تغییر یا حذف Permission فنی با پاسخ 405 رد می‌شود. در سایر APIها، فقدان مجوز عملیات پاسخ 403 می‌دهد. تغییر فیلدهای حساس مانند نقش، اعضای واحد، مدیر، وضعیت کار و مسئول کار، مجوز مستقل همان فیلد را می‌خواهد.

## E. Frontend Files Changed

- `apps/web/app/crm/access/`: API مشترک دسترسی، typeها، hookهای یک/چند مجوز، PermissionGate، نقشهٔ مجوز مسیرها، مدیریت استثنا و دسترسی مؤثر، مدیریت جانشین و اجزای فرم/Modal.
- `crm/api.ts`، `types.ts`، `store.ts`، `layout.tsx` و `apps/web/app/routes.ts`: API/types جدید، reset نشست، احراز هویت قبل از Shell و کنترل مسیر.
- `crm/pages/roles.tsx`: نقش بدون Level، فعال/غیرفعال‌سازی، تخصیص مجوز و کاتالوگ فقط خواندنی.
- `crm/pages/team.tsx` و `user-profile.tsx`: نقش‌های سفارشی، منوی عملیات، فرم هویت مستقل، تغییر رمز و حذف عضویت با تأیید.
- `crm/pages/organization.tsx` و `absences.tsx`: حفظ درخت و Drag & Drop، ترتیب جانشینان، عدم حضور و جانشینی فعال.
- `crm/pages/auth.tsx`: ورود ایمیل/نام کاربری بدون Signup.
- `components.tsx` و صفحات `home`، `my-work`، `calendar`، `issues`، `projects`، `project-detail`، `routing` و `settings`: کنترل عملیات بر اساس کد مجوز.
- `packages/ui/src/form-fields/compact-multi-selector.tsx` و Storybook آن، export در `packages/ui/src/index.ts`.
- `packages/tailwind-config/crm-theme.css`: اندازه و فاصلهٔ فرم‌ها، selector، focus، حالت غیرفعال و Modal پاسخ‌گو.

## F. Permission Priority Logic

ترتیب قطعی:

```text
User DENY > User ALLOW > Active Role Permissions > Active Delegation > No Access
```

Permission نقش‌های فعال به صورت union محاسبه می‌شود. استثنای آینده یا منقضی‌شده اثری ندارد. بازهٔ زمانی به صورت `starts_at <= now < ends_at` است. در صورت وجود چند استثنای هم‌زمان، DENY برنده است.

کد ناشناخته، نقش غیرفعال، تخصیص غیرفعال، کاربر غیرفعال یا عضویت غیرفعال هیچ دسترسی نمی‌دهد. cache فقط برای یک Request است؛ درخواست بعدی تغییر مجوز و پایان جانشینی را بلافاصله می‌بیند.

## G. Role/User Migration

- اعضای قبلی با نقش عددی 20، نقش سفارشی دارای `system_key="admin"` می‌گیرند؛ سایر اعضا نقش `member` می‌گیرند. وضعیت عضویت فعال/غیرفعال حفظ می‌شود.
- نام‌ها و تخصیص نقش‌های سفارشی قبلی حفظ می‌شوند. اگر نقش سفارشی از قبل نام «مدیر» داشته باشد، یک نقش پیش‌فرض مجزا ساخته می‌شود و مجوز مدیریتی به نقش سفارشی تزریق نمی‌شود.
- نقش مدیر در مهاجرت مجوزهای مدیریتی لازم را دارد؛ نقش عضو، مجوزهای پایهٔ مشاهده، تغییر وضعیت/انتقال کار خود و صف مجاز را دارد.
- مقدارهای عددی `WorkspaceMember.role` و `ProjectMember.role` برای سازگاری Plane باقی مانده‌اند. adapter پس از تغییر نقش‌های CRM آن‌ها را همگام می‌کند؛ UI نقش‌ها را از OrganizationRole دریافت می‌کند.
- عملیات تغییر دسترسی، Workspace را در transaction قفل می‌کند. آخرین مدیر دارای دسترسی مدیریتی قابل حذف، غیرفعال یا محروم کردن نیست؛ استثناهای زمان‌بندی‌شده و پایان ALLOW نیز بررسی می‌شوند.
- مسیر قدیمی غیرفعال‌سازی حساب Plane نیز همهٔ Workspaceهای کاربر را قفل و همین محافظ آخرین مدیر را بررسی می‌کند. غیرفعال‌سازی عضویت از پروفایل، عضویت پروژه‌های همان Workspace را نیز غیرفعال می‌کند.
- حذف کاربر، عضویت همان Workspace و تخصیص‌های سازمانی/جانشینی/استثنای او را غیرفعال می‌کند. هویت global، عضویت سایر Workspaceها و تاریخچه حفظ می‌شوند.
- راه‌اندازی Workspace جدید و عضویت‌هایی که با bulk_create ساخته می‌شوند نیز تخصیص اولیهٔ CRM دریافت می‌کنند.

## H. Delegation/Absence Logic

وقتی مدیر اصلی در غیبت فعال است، جانشینان به ترتیب اولویت بررسی می‌شوند. جانشین غیرفعال، فاقد عضویت فعال یا غایب رد می‌شود و اولین فرد معتبر انتخاب می‌شود.

فقط مجوزهای قابل انتقالِ نقش‌های فعال مدیر منتقل می‌شوند. استثنای مستقیم مدیر و جانشینی زنجیره‌ای منتقل نمی‌شود. نقش دائمی برای جانشین ساخته یا تخصیص داده نمی‌شود. DENY مستقیم خود جانشین بر هر مجوز موقت اولویت دارد.

ثبت/ویرایش/پایان عدم حضور علاوه بر مجوز عملیات، به مدیریت فرد توسط مدیر همان واحد/واحد بالادست یا `Absence.ManageAll` نیاز دارد. هم‌پوشانی غیبت‌های scheduled رد می‌شود. API، فهرست کاربران قابل مدیریت و امکان ویرایش/پایان هر ردیف را برای UI برمی‌گرداند.

مسیریابی، شرط Level ندارد و نقش مورد نیاز و جانشین فعال را بررسی می‌کند. مجوزهای Referral در رجیستری وجود دارند؛ Workflow جدید Referral در این تغییر ساخته نشده است.

## I. Authentication Fixes

- ورود از ایمیل یا نام کاربری پشتیبانی می‌کند. فرم اختصاصی CRM فقط Login دارد.
- ثبت‌نام عمومی در Backend رمز/Magic/OAuth نیز بسته است؛ دعوت معتبر و اثبات توکن/ایمیل لازم است. عضویت خودکار کاربر در نخستین شرکت حذف شده است.
- مسیر Login خارج از Protected Layout است. تا بررسی نشست تکمیل نشود، Shell، Sidebar و queryهای خصوصی mount نمی‌شوند؛ دادهٔ cache شدهٔ کاربر برای عبور از guard کافی نیست.
- Logout نشست سرور را خاتمه می‌دهد، درخواست‌ها و cacheهای React Query، CSRF ذخیره‌شده و state مرتبط با کاربر/Workspace را پاک می‌کند و با replace به Login می‌رود.
- هنگام بازگشت از bfcache و تغییر مسیر، نشست دوباره بررسی می‌شود. پاسخ 401 نیز state نشست را پاک می‌کند.
- خروج در تب‌های دیگر نیز منتشر می‌شود. Shell و portalهای خصوصی هنگام pagehide مخفی می‌شوند و فقط پس از تأیید دوبارهٔ نشست نمایش می‌یابند. پاسخ دیررس بررسی نشست نمی‌تواند وضعیت خروج را برگرداند.
- پاسخ `users/me` و دسترسی کاربر، cache مرورگر را غیرفعال می‌کند. CSRF و احراز هویت موجود حفظ شده‌اند.
- API مدیریت دارای `private, no-store` است. درخواست تغییردهنده با کوکی در مسیرهای متصل به موتور CRM، CSRF استاندارد Django را اجباری می‌کند؛ API کلیدمحور همچنان روش احراز هویت خودش را دارد.
- تغییر رمز فقط در API مستقل، با تأیید، سیاست Django و `set_password` انجام می‌شود. رمز در فرم هویت، URL، LocalStorage و Audit ذخیره نمی‌شود. logger بدنهٔ JSON و فرم را برای فیلدهای رمز، به صورت بازگشتی redact می‌کند.
- ذخیرهٔ هویت فقط فیلدهای هویتی ارسال‌شده را می‌نویسد و تغییر هم‌زمان رمز عبور را بازنویسی نمی‌کند. ویرایش صرفاً نقش نیز به اعتبارسنجی یا تغییر اطلاعات هویتی قدیمی وابسته نیست.

## J. UI/UX Fixes

فرم‌های دسترسی از Modal مشترک `@plane/ui` استفاده می‌کنند: focus، Escape و کلیک بیرون مدیریت می‌شود و هنگام submit بسته‌شدن تصادفی جلوگیری می‌شود. منوی سه‌نقطه از Headless UI و حرکت با صفحه‌کلید پشتیبانی می‌کند.

Selector نقش/عضو/مجوز، جستجو، دسته‌بندی، توضیح، شمارنده، انتخاب نتایج، پاک‌کردن و اسکرول محدود دارد. checkboxها ۱۸ پیکسل هستند. نقش کاربر غیرفعال با توضیح روشن قابل ویرایش نیست.

فونت محلی Vazirmatn موجود پروژه حفظ و در build استفاده شده است؛ CDN یا وابستگی جدید فونت اضافه نشده است. UI فارسی RTL، کد مجوز و مقادیر فنی LTR، تاریخ نمایشی فارسی و فرم/Modal پاسخ‌گو هستند.

## K. Tests Added

Backend:

- union نقش‌ها، نقش و عضویت غیرفعال، اولویت ALLOW/DENY، مرز زمان، استثنای آینده/منقضی و جداسازی Workspace.
- ترتیب جانشین، جانشین غایب/غیرفعال/فاقد عضویت، پایان غیبت، عدم انتقال مجوز حساس یا استثنای مدیر.
- cache در سطح Request و مشاهدهٔ محرومیت در درخواست بعدی.
- API بدون مجوز، کاتالوگ فقط خواندنی، ورودی UUID نامعتبر، ویرایش صرفاً نقش بدون تغییر هویت.
- رمز معتبر hash شده، تأیید ناهماهنگ/رمز ضعیف، Audit بدون رمز، حفظ هویت و Workspaceهای دیگر هنگام حذف.
- جلوگیری از حذف/غیرفعال‌سازی/محرومیت فعلی و آیندهٔ آخرین مدیر.
- جلوگیری از دورزدن محافظ آخرین مدیر با غیرفعال‌سازی حساب قدیمی Plane و حفظ رمز جدید در ذخیرهٔ هم‌زمان پروفایل.
- اختیار مدیر بالادست، رد هم‌پوشانی، محدودهٔ کاربران قابل مدیریت.
- اعمال DENY روی کلید API، مجوز مستقل وضعیت/مسئول، محدودهٔ کار خود و handler قدیمی upsert.
- مجوز نقش سفارشی برای عملیات پروژه بدون نقش عددی مدیر؛ جلوگیری از ارتقای عددیِ مستقل از adapter.
- فرمان demo بدون Level، استفاده از رجیستری و اجرای تکراری بدون دادهٔ تکراری.
- مهاجرت دیتابیس موجود، برخورد نام «مدیر»، اجرای idempotent و rollback.

Frontend:

- hookهای تک/چند مجوز، PermissionGate، محافظ مسیر و مخفی‌شدن عملیات فاقد مجوز.
- کاتالوگ فقط خواندنی، نقش بدون ورودی Level، چند chip نقش و وضعیت عضویت غیرفعال.
- منوی عملیات با مجوز مستقل هر اقدام، role selector غیرفعال و تأیید رمز ناهماهنگ.
- Login بدون Signup، انتظار CSRF، reset cache/state و عدم mount/query خصوصی پیش از بررسی نشست.

تست‌های قدیمی حذف نشده‌اند. انتظار حذف global user به حفظ هویت و حذف عضویت تغییر کرده است؛ تست API پروژه اکنون هر شش وضعیت موجود، شامل Review، را با نام بررسی می‌کند.

## L. Commands Executed

```sh
pnpm check:types
pnpm check:lint
pnpm --filter web test
pnpm build --concurrency=1
```

تست‌ها با `docker-compose-test.yml` اجرا شدند. در این میزبان Windows، یک override موقت در `tmp/compose-crm-tests.yml`، دادهٔ RabbitMQ را روی tmpfs با uid/gid 999 قرار داد تا سرویس تست سالم اجرا شود. این override مربوط به محیط تست است.

دستور گروه گسترده:

```sh
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint pytest api-tests plane/tests/contract/app/test_crm_access_control.py plane/tests/contract/app/test_organization_routing.py plane/tests/contract/app/test_workspace_tasks.py plane/tests/contract/app/test_workspace_user_creation.py plane/tests/contract/app/test_authentication.py plane/tests/unit/middleware/test_logger.py plane/tests/contract/api/test_projects.py plane/tests/contract/api/test_projects_lite.py plane/tests/contract/api/test_issues.py plane/tests/contract/api/test_project_members_roster_scope.py plane/tests/contract/api/test_issue_assignee_label_validation.py plane/tests/contract/app/test_project_app.py plane/tests/contract/app/test_project_member_is_active_authz.py --reuse-db -q
```

گروه نهایی مسیرهای تغییرکرده شامل `test_crm_access_control.py` و شش فایل API/محدودهٔ عضویت از گروه بالا دوباره اجرا شد. تست مهاجرت جداگانه با فعال‌بودن migrationهای واقعی اجرا شد:

```sh
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint pytest api-tests plane/tests/contract/app/test_crm_access_migration.py --migrations --reuse-db -q
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint python api-tests manage.py check
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint python api-tests manage.py makemigrations --check --dry-run
```

گروه احراز هویت و غیرفعال‌سازی حساب:

```sh
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint pytest api-tests plane/tests/contract/app/test_crm_access_control.py plane/tests/contract/app/test_authentication.py plane/tests/contract/api/test_authentication.py plane/tests/unit/middleware/test_api_authentication.py --reuse-db -q
```

رفتار نهایی ذخیرهٔ هویت/رمز، ویرایش صرفاً نقش و غیرفعال‌سازی عضویت پروژه نیز به صورت هدفمند بازاجرا شد:

```sh
docker compose -f docker-compose-test.yml -f tmp/compose-crm-tests.yml run --rm --no-deps --entrypoint pytest api-tests plane/tests/contract/app/test_crm_access_control.py -k 'password_is_separate or granular_role_permissions or inactive_user_role_assignment' --reuse-db -q
```

Ruff با `check --select F` روی فایل‌های Python تغییرکرده، oxfmt روی فایل‌های frontend تغییرکرده و `git diff --check` نیز اجرا شدند. جست‌وجوی سراسری Level/LevelId و فیلدهای قدیمی، پس از اصلاح فرمان demo، فقط migrationهای تاریخی/آرشیو و تست rollback را پیدا می‌کند؛ runtime CRM وابستگی ندارد.

## M. Test Results

| بررسی                                           | نتیجه                              |
| ----------------------------------------------- | ---------------------------------- |
| TypeScript کل Workspace                         | ۲۸ وظیفه موفق                      |
| lint کل Workspace                               | ۱۶ وظیفه موفق؛ صفر error           |
| تست‌های Frontend CRM                            | ۳۶ تست در ۶ فایل موفق              |
| build تمام packageها و appها                    | ۱۶ وظیفه موفق                      |
| گروه گسترده Backend                             | ۱۵۴ تست موفق                       |
| بازاجرای مسیرهای API، demo و نقش سفارشی         | ۵۳ تست موفق                        |
| بازاجرای دسترسی، احراز هویت و غیرفعال‌سازی حساب | ۶۵ تست موفق                        |
| بازاجرای ذخیرهٔ هم‌زمان رمز/هویت و عضویت        | ۳ تست موفق                         |
| تست انتقال و rollback با migration واقعی        | ۱ تست موفق                         |
| Django check                                    | بدون مشکل                          |
| تطابق مدل و migration                           | No changes detected                |
| Ruff و بررسی whitespace                         | موفق                               |
| `pnpm check`                                    | ناموفق؛ قالب‌بندی منابع دست‌نخورده |
| Chrome با Backend واقعی و دیتابیس تست           | ۱۳ بررسی موفق؛ بدون Runtime Error  |

گروه‌های Backend هم‌پوشانی دارند؛ شمار آن‌ها با یکدیگر جمع نمی‌شود. تست migration با migrationهای واقعی اجرا شده است و از تست‌های عادی مبتنی بر schema جداست.

## N. Remaining Limitations

- کل مجموعهٔ چندماژولی Backend اجرا نشده است؛ گروه‌های مرتبط با دسترسی، کاربران، احراز هویت، مسیریابی، پروژه و Issue اجرا شدند.
- مرورگر Chrome در عرض‌های ۳۹۰ و ۱۴۴۰ برای RTL/فونت/پوسته و عملیات مدیریت بررسی شد. خروج دو تب، Back، Refresh، URL خصوصی و API پس از خروج نیز موفق بودند. همهٔ مرورگرها/اندازه‌ها و استفادهٔ قطعی از bfcache پوشش داده نشده‌اند.
- UI دسترسی را هر ۳۰ ثانیه و هنگام focus تازه می‌کند؛ Backend پایان جانشینی یا استثنا را در هر درخواست بلافاصله اعمال می‌کند.
- هشدارهای lint و build موجود پروژه، شامل اندازهٔ chunk و تنظیمات ابزارها، باقی‌اند؛ فرمان‌ها بدون error گذشتند.
- استقرار روی سرور و migration دیتابیس عملیاتی انجام نشده است. بررسی انتقال فقط روی دیتابیس مجزای تست انجام شد.
- کدهای عددی و guardهای داخلی Plane در ماژول‌های خارج از بازطراحی CRM حفظ شده‌اند. تصمیم‌های عملیات CRM و APIهای تغییرکرده از موتور مجوز مشترک استفاده می‌کنند.
- تغییرات قبلی کاربر در فایل‌های storage و deployment حفظ شدند. هیچ commit یا وابستگی/lockfile جدیدی ایجاد نشده است؛ export فایل فونت موجود به بستهٔ مشترک اضافه شده است.

Level/LevelId دیگر به عنوان مکانیزم Authorization سیستم CRM استفاده نمی‌شود.

Admin عادی قادر به ساخت Permission فنی جدید نیست.

Backend Authorization مستقل از مخفی یا نمایش داده شدن UI در React اعمال می‌شود.
