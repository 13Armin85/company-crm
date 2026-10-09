# قرارداد API مدیریت دسترسی CRM

این قرارداد مکمل [معماری دسترسی](CRM-ACCESS-REDESIGN.fa.md) و [کاتالوگ مجوزها](CRM-PERMISSION-CATALOG.md) است. همهٔ شناسه‌ها UUID هستند و تمام روابط باید به همان Workspace تعلق داشته باشند.

## احراز هویت، CSRF و خطاها

در CRM از نشست Django استفاده می‌شود. برای عملیات تغییردهنده، ابتدا `GET /auth/get-csrf-token/` فراخوانی شود و مقدار `csrf_token` در هدر `X-CSRFTOKEN` ارسال شود. کوکی نشست نیز باید همراه درخواست باشد. API کلیدمحور موجود Plane احراز هویت مستقل دارد و به CSRF نشست وابسته نیست؛ مجوزها و محدودهٔ Workspace همچنان بررسی می‌شوند.

پاسخ‌های مدیریتی دارای `Cache-Control: private, no-store` هستند. وضعیت‌های متداول:

| وضعیت | معنی                                                                   |
| ----- | ---------------------------------------------------------------------- |
| 200   | مشاهده یا تغییر موفق                                                   |
| 201   | ایجاد موفق                                                             |
| 204   | حذف عضویت، پایان یا غیرفعال‌سازی موفق، مطابق endpoint                  |
| 400   | ورودی نامعتبر، رابطهٔ ناسازگار، بازهٔ اشتباه، تکرار یا حذف آخرین مدیر  |
| 401   | نبود نشست معتبر                                                        |
| 403   | نبود مجوز، نبود عضویت فعال یا CSRF نامعتبر                             |
| 404   | شناسه در محدودهٔ Workspace پیدا نشد                                    |
| 405   | عملیات پشتیبانی نمی‌شود؛ ساخت یا تغییر Permission فنی از پنل ممنوع است |

خطای اعتبارسنجی معمولاً شامل نام فیلد و فهرست پیام‌هاست؛ خطای دسترسی شامل `detail` است. پاسخ‌های native ورود Plane ممکن است به صفحهٔ ورود با `error_message` هدایت شوند.

ثبت‌نام عمومی در مسیرهای رمز، Magic و OAuth بسته است، حتی اگر تنظیم قدیمی `ENABLE_SIGNUP=1` باشد. ایجاد حساب از دعوت معتبر سازمانی مجاز است؛ درخواست ثبت‌نام با رمز علاوه بر ایمیل و رمز باید `invitation_token` همان دعوت را داشته باشد. مسیرهای Magic/OAuth مالکیت ایمیل را با روش موجود اعتبارسنجی می‌کنند. دعوت ردشده، حذف‌شده یا متعلق به شرکت حذف‌شده مجوز ایجاد حساب نیست. ورود کاربر موجود به این محدودیت وابسته نیست. پس از ایجاد حساب، تنها دعوت‌های پذیرفته‌شدهٔ همان ایمیل به عضویت تبدیل می‌شوند؛ عضویت خودکار در نخستین شرکت وجود ندارد.

## کاربران

پیشوند مسیرهای زیر `/api/workspaces/<slug>/` است.

| مسیر                                       | روش    | مجوز                                                                      |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| `members/`                                 | GET    | `User.View`؛ دایرکتوری محدود تخصیص با `Issue.Assign` نیز قابل استفاده است |
| `members/`                                 | POST   | `User.Create`؛ تخصیص نقش صریح همچنین `User.Role.Assign`                   |
| `organization/users/<user_id>/`            | GET    | مجوز مشاهدهٔ کاربران                                                      |
| `organization/users/<user_id>/`            | PATCH  | مجوز مستقل برای هر فیلد هویت، نقش یا واحد                                 |
| `organization/users/<user_id>/password/`   | POST   | `User.ChangePassword`                                                     |
| `organization/users/<user_id>/membership/` | DELETE | `User.Delete`                                                             |

نمونهٔ ایجاد کاربر:

```json
{
  "email": "member@example.com",
  "username": "member.username",
  "display_name": "کاربر جدید",
  "password": "<رمز مطابق سیاست Django>",
  "role_ids": ["<شناسه نقش>"]
}
```

ویرایش هویت از نام‌های `first_name`، `last_name`، `display_name`، `email` و `username` استفاده می‌کند و نیازمند `User.Edit` است. `role_ids` به `User.Role.Assign` و `unit_ids` به `OrganizationUnit.Member.Manage` نیاز دارند. تغییر وضعیت عضویت `is_active` نیز مجوز مدیریتی کاربر می‌خواهد. فقط فیلدهای تغییرکرده ارسال شوند؛ رمز در این درخواست پذیرفته نمی‌شود.

```json
{
  "new_password": "<رمز جدید>",
  "confirm_password": "<تکرار رمز جدید>"
}
```

تغییر رمز با `set_password` انجام می‌شود. هش جدید، نشست‌های مرورگر همان حساب را در درخواست بعدی نامعتبر می‌کند، شامل نشست جاری اگر مدیر رمز خودش را تغییر دهد. کلیدهای API موجود چرخهٔ اعتبار و لغو مستقل Plane را دارند. رمز در پاسخ و Audit ثبت نمی‌شود.

حذف کاربر در این قرارداد، حذف دسترسی و عضویت همان شرکت است؛ حساب سراسری، عضویت شرکت‌های دیگر و انتساب‌های تاریخی پروژه و کار حذف نمی‌شوند.

## نقش‌ها و کاتالوگ

| مسیر                                        | روش    | مجوز                                                                                   |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `organization/roles/`                       | GET    | `Role.View` یا مصرف‌کنندهٔ مجاز تخصیص نقش/مسیریابی                                     |
| `organization/roles/`                       | POST   | `Role.Create`؛ مجوزهای همراه نیازمند `Role.Permission.Assign`                          |
| `organization/roles/<role_id>/`             | PATCH  | `Role.Edit` برای هویت؛ `Role.Disable` برای وضعیت؛ `Role.Permission.Assign` برای مجوزها |
| `organization/roles/<role_id>/`             | DELETE | `Role.Disable`؛ نقش غیرفعال می‌شود                                                     |
| `organization/permissions/`                 | GET    | `Permission.View`                                                                      |
| `organization/permissions/<permission_id>/` | GET    | `Permission.View`                                                                      |

نقش شامل `id`، `name`، `description`، `system_key`، `is_active`، `permission_ids`، `user_count`، `created_at` و `updated_at` است. `system_key` خواندنی است و نقش‌های پایه را مشخص می‌کند. `user_count` تعداد تخصیص‌های فعال و یکتای کاربر به نقش در همان Workspace است. فهرست Permission فنی قابل ساخت، تغییر Code یا حذف توسط ادمین نیست.

## استثناها و دسترسی مؤثر

| مسیر                                                  | روش          | مجوز                              |
| ----------------------------------------------------- | ------------ | --------------------------------- |
| `access/me/`                                          | GET          | حساب و عضویت فعال                 |
| `organization/users/<user_id>/effective-permissions/` | GET          | `Access.EffectivePermission.View` |
| `organization/users/<user_id>/exceptions/`            | GET          | `Access.UserException.View`       |
| `organization/users/<user_id>/exceptions/`            | POST         | `Access.UserException.Manage`     |
| `organization/users/<user_id>/exceptions/<id>/`       | PATCH/DELETE | `Access.UserException.Manage`     |

```json
{
  "permission": "<شناسه مجوز همان شرکت>",
  "effect": "DENY",
  "starts_at": "2026-10-10T08:00:00Z",
  "ends_at": "2026-10-10T12:00:00Z",
  "is_active": true
}
```

تاریخ‌های استثنا اختیاری هستند؛ `null` یعنی بدون مرز. بازه به صورت `[شروع، پایان)` است. استثناهای هم‌اثر و هم‌پوشان از API پذیرفته نمی‌شوند و تکرار دقیق فعال در دیتابیس محدودیت یکتایی دارد. وجود Allow و Deny در یک بازه نتیجهٔ قطعی دارد: Deny اولویت دارد و `has_conflict` برای نمایش تعارض گزارش می‌شود. رکوردهای زمان‌دارِ هم‌اثر با بازه‌های جدا مجازند.

پاسخ دسترسی مؤثر:

```json
{
  "permissions": ["Issue.View"],
  "explanations": [
    {
      "code": "Referral.Delete",
      "granted": false,
      "source": "user_deny",
      "exception_effects": ["ALLOW", "DENY"],
      "has_conflict": true
    }
  ]
}
```

منبع یکی از `user_deny`، `user_allow`، `role`، `delegation` یا `no_access` است. اطلاعات نقش یا مدیر، واحد، دلیل و پایان جانشینی نیز در موارد مربوط ارائه می‌شود. Cache موتور فقط درون یک درخواست است؛ تغییر داده روی درخواست بعدی مؤثر می‌شود. UI پس از تغییر داده cacheهای مرتبط را نامعتبر می‌کند و دسترسی را هر ۳۰ ثانیه و هنگام focus تازه می‌کند.

## واحد، جانشینی و عدم حضور

| مسیر                                 | روش          | مجوز                                                         |
| ------------------------------------ | ------------ | ------------------------------------------------------------ |
| `organization/units/`                | GET/POST     | `OrganizationUnit.View` / `OrganizationUnit.Create`          |
| `organization/units/<id>/`           | PATCH/DELETE | مجوز فیلدهای واحد / `OrganizationUnit.Disable`               |
| `organization/units/<id>/delegates/` | GET/PUT      | `OrganizationUnit.View` / `OrganizationUnit.Delegate.Manage` |
| `organization/absences/`             | GET/POST     | `Absence.View` / `Absence.Create` همراه محدودهٔ مدیریتی      |
| `organization/absences/<id>/`        | PATCH/DELETE | `Absence.Edit` / `Absence.End` همراه محدودهٔ مدیریتی         |

ورودی PUT جانشینان `{"user_ids": ["<جانشین اول>", "<جانشین دوم>"]}` است. جایگاه در آرایه اولویت را تعیین می‌کند. لیست خالی جانشینان فعال را کنار می‌گذارد. انتخاب تکراری، مدیر اصلی به عنوان جانشین، کاربر شرکت دیگر یا عضویت غیرفعال رد می‌شود. پاسخ شامل `delegates` و `active_delegation` است.

ورودی غیبت شامل `user`، `starts_at`، `ends_at` و `reason` است. تاریخ‌ها باید UTC/ISO8601 باشند. Backend هم‌پوشانی و رابطهٔ مدیریتی واقعی را بررسی می‌کند. `Absence.ManageAll` محدودهٔ مدیریتی را به کل شرکت گسترش می‌دهد و جای مجوز عملیات را نمی‌گیرد.

پاسخ فهرست غیبت شامل `absences`، `manageable_user_ids` و `delegations` است. `current_status` از ساعت سرور محاسبه می‌شود: `upcoming`، `active`، `ended` یا `cancelled`. پرچم‌های `can_edit` و `can_end` امکان واقعی عمل روی هر ردیف را مشخص می‌کنند.

مدیر حاضر هیچ جانشینی فعال ندارد. هنگام غیبت، نخستین جانشین فعال، حاضر و عضو همان شرکت انتخاب می‌شود. فقط مجوزهای نقش مدیر که در کاتالوگ قابل انتقال‌اند منتقل می‌شوند؛ استثناهای مدیر یا دسترسیِ به‌ارث‌رسیده از جانشینی دیگری منتقل نمی‌شوند. پایان غیبت یا بازگشت مدیر در هر درخواست بررسی می‌شود و به اجرای Celery وابسته نیست.
