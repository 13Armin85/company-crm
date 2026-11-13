# تیکت ۷ از ۸ | درگاه مشتری و مکاتبات — گزارش تحویل

> وضعیت: **@@STATUS@@** **هیچ commitی انجام نشده است؛ هیچ push و هیچ ارسال واقعی ایمیل/پیامکی انجام نشده است.**
> تست‌های مشخصه‌نگار وضع پیش از کار: `apps/api/plane/tests/contract/app/test_ticket_seven_baseline.py` (در فاز ۱: **۱۴ از ۱۴ سبز** روی درخت فعلی پیش از هر تغییر؛ چهار تستی که «خلأ» را تثبیت می‌کردند پس از کار به آزمون «پس از کار» تبدیل شدند و مقدار HEAD در کامنت همان سطر آمده است — بند ۷).
> نام فایل‌ها: `test_ticket_seven.py` و `crm-ticket-seven-acceptance.mjs` از قبل به مجموعهٔ داشبورد (شماره‌گذاری قدیمی «تیکت ۷») تعلق دارند؛ برای بازنویسی‌نکردن آن‌ها، آزمون این تیکت `test_ticket_seven_portal.py` و اسکریپت مرورگر `crm-ticket-seven-portal-acceptance.mjs` است.

## ۱. جدول خلأ (پیش و پس از کار)

| بند تیکت | پیش از کار در کد (`file:line` روی HEAD `f507171`) | تست وضع موجود | کمبود | تصمیم | دلیل نساختن مدل موازی | پس از کار |
|---|---|---|---|---|---|---|
| تیکت = `Issue` + سه‌دسته | `services/ticket_core.py:70` (`work_category`)، `:84` (`category_expression`)، `:42` (`GROUP_CATEGORY`) | `test_ticket_status_category_mapping_is_the_single_source` | — | استفادهٔ مجدد | درخواست مشتری همان ردیف `Issue` است | «پایان‌یافته» برای بازخورد و وضعیت مشتری فقط از `category_of` |
| تیکت ↔ مشتری | `ticket_core.py:1466` (`customers_of` روی `EntityRelationLink`، `EntityType.code="customer"`) | `test_customers_of_reads_the_existing_relation` | ثبت از بیرون پیوند نمی‌ساخت | استفادهٔ مجدد | همان رابطهٔ `customer↔ticket` | `portal_requests._link_customer` همان `EntityRelationLink` + `sync_projection` |
| منبع «پورتال» | `services/entity_config.py:528` (فقط در قالب «پشتیبانی»، seed نمی‌شود) | `test_portal_ticket_source_exists_only_in_the_support_template` | در پایگاه محلی lookup `ticket-source` وجود ندارد | استفادهٔ شرطی | — | اگر شرکت فیلدی با lookup `ticket-source` و مقدار `portal` دارد، مقدار آن روی رکورد تیکت `portal` می‌شود (تست ۳)؛ در غیر این صورت منبع در رویداد `portal.request_submitted` و ستون `Issue.portal_account` ثبت است |
| مبلغ پیشنهادی | `entity_config.py:537` (`sales_amount`، `money`، فقط در قالب) | همان | فیلد تکی؛ نسخه/وضعیت/اعتبار نداشت | پیکربندی موجودیت (تصمیم ۷.۷) | برآورد = رکورد موتور موجودیت `quote` با فیلدهای `money/long_text/date/integer/select` | `services/quotes.py` |
| ارجاع و صف بدون مسئول | `ticket_routing.py:437` (`route_auto`)، `:323` (`_queue`)؛ `db/models/organization.py:336,380,428` | تست‌های تیکت ۵ | — | استفادهٔ مجدد | — | ثبت درخواست → `route_auto` (قاعده یا صف بدون مسئول)؛ فیلتر آماده `portal` روی همان فهرست «همه کارها» |
| حل در تماس | `ticket_core.py:1150`؛ `urls/workspace.py:154` | `test_contact_resolution_never_writes_a_comment` | اطلاع به مشتری نبود | گسترش افزایشی (۷.۱۰) | رکورد تماس جدا ساخته نشد | `notify_customer` → پیام `EXTERNAL` از نوع `contact`؛ زمان/کانال/خلاصه/نتیجه از قبل وجود داشت |
| توقف «انتظار مشتری» | `db/models/workflow.py:186` (`WorkflowPause.Kind.CUSTOMER`) — `step_run` اجباری | `test_customer_wait_pause_belongs_to_a_workflow_step` | فقط برای مرحلهٔ گردش‌کار | استفادهٔ مجدد + مرحلهٔ تریاژ | — | «درخواست تکمیل» اگر مرحلهٔ جاری اجازه دهد `workflow_actions.pause(kind=customer)`؛ همیشه `Issue.portal_stage="awaiting_customer"` |
| سابقه | `ticket_core.py:192` (`record`)، `entity_records.py:400` (`emit`)، `crm_entity_events` | — | — | استفادهٔ مجدد | — | رویدادهای `portal.*` و `quote.*` (بند ۵) + فیلتر «درگاه و برآورد» در سابقه |
| اعتبارسنجی فایل | `entity_files.py:14` (فقط حجم و پسوند) | `test_validate_file_checks_size_and_extension_only` | محتوای واقعی بررسی نمی‌شد | لایهٔ افزوده (قرارداد helper تغییر نکرد) | همان `FileAsset` با `entity_type=CRM_PORTAL_ATTACHMENT` و FK `comment` | `portal_files.sniff/safe_name/validate_upload`؛ نوع خصوصی در `PRIVATE_CRM_ASSET_TYPES` (`asset.py:20`) |
| اعلان داخلی | `crm_notifications.py:8` (`notify_members`) | — | — | استفادهٔ مجدد | موتور اعلان جدا ساخته نشد | `portal_notify.notify_team` (پیام/تصمیم برآورد/بازخورد) |
| مجوزها | `permission_registry.py`، `permission-map.ts` | `test_portal_permission_codes_are_registered` (HEAD: نبود) | `Portal.*`/`Quote.Manage` نبود | ۶ کد جدید | — | بند ۴ |
| throttle پیش‌فرض | `settings/common.py:140` (`AnonRateThrottle` فقط) | — | scope درگاه نبود | throttle اختصاصی | — | ۷ scope (بند ۶) |
| کامنت native | `db/models/issue.py:582`، `:603` (`access` با پیش‌فرض `INTERNAL` **وجود داشت**)؛ `project` اجباری (`project.py:203`) | `test_comment_has_internal_external_access_defaulting_to_internal`، `test_comment_project_is_nullable_for_project_less_tickets` (HEAD: NOT NULL) | تیکت بی‌پروژه هیچ کامنتی نمی‌توانست داشته باشد؛ رابط CRM هیچ کامپوزر کامنتی نداشت | `AlterField` → nullable؛ `AddField portal_account` | همان `issue_comments` | تب «مکاتبات» |
| Intake/Triage | `db/models/intake.py:12,50` (`ProjectBaseModel`، پروژه اجباری) | `test_intake_is_project_bound` | تیکت‌های CRM معمولاً بی‌پروژه‌اند | **استفاده نشد** | صف سوم نساختیم: تریاژ = ستون `portal_stage` روی همان تیکت + صف موجود تیکت ۵ | فیلتر آمادهٔ «درگاه: منتظر تریاژ» |
| اپ `apps/space` | بُردهای عمومی Plane (فقط‌خواندنی، بدون هویت) | — | هویت و دسترسی سطر به سطر ندارد | استفاده نشد | — | route tree جدا در `apps/web` (تصمیم ۷.۳) |
| موجودیت مخاطب | در پیکربندی پیش‌فرض نیست؛ در پایگاه محلی `contact` و رابطهٔ `customer↔contact` (one_to_many) توسط شرکت ساخته شده | — | — | اختیاری | — | `PortalAccount.contact_record` فقط اگر به همان مشتری وصل باشد (`test_contact_must_belong_to_the_customer`) |
| هویت مشتری | وجود ندارد: هر `User` عضو بالقوهٔ workspace است و همهٔ endpointهای داخلی نشست Django را می‌پذیرند | `test_workspace_member_is_the_only_internal_identity` | — | `CreateModel` (۷.۱) | Plane هویت بیرونی ندارد؛ استفاده از `User` یعنی ورود به `/api/users/me/` و … | `PortalAccount`، `PortalSession`، `PortalAuditLog` |
| API درگاه | `/api/portal/v1/` → ۴۰۴ | `test_portal_api_prefix_is_served` (HEAD: 404) | — | API جدا (۷.۲) | — | بند ۶ |
| یکتایی تصمیم/بازخورد | `crm_entity_events` بدون قید | `test_entity_events_are_plain_append_rows` (HEAD: بدون قید) | — | `AddConstraint` | — | `crm_quote_one_decision`، `crm_portal_one_feedback` |

## ۲. فایل‌ها

**Backend — جدید:** `db/models/portal.py`، `db/migrations/0162_customer_portal.py`، `db/migrations/0163_customer_portal_permissions.py`، `app/services/{portal_access,portal_settings,portal_requests,portal_messages,portal_files,portal_notify,quotes}.py`، `app/views/portal/{__init__,base,customer}.py`، `app/views/workspace/portal.py`، `app/urls/portal.py`، `tests/contract/app/test_ticket_seven_portal.py`، `tests/contract/app/test_ticket_seven_baseline.py`.

**Backend — تغییریافته (فقط افزایشی):** `db/models/issue.py` (`Issue.portal_account/portal_stage`، `IssueComment.project` nullable، `IssueComment.portal_account`)، `db/models/entity.py` (دو قید جزئی)، `db/models/asset.py` (نوع خصوصی)، `db/models/__init__.py`، `app/services/ticket_core.py` (`notify_customer` در حل در تماس، فیلتر `portal`، نوع سابقهٔ `portal`)، `app/services/entity_records.py` (رد نوشتن مستقیم موتور روی `quote`)، `app/services/entity_config.py` (حذف `customer-portal` از خروجی پیکربندی)، `app/services/permission_registry.py`، `app/views/workspace/ticket.py` (پرچم `portal` در کارت)، `app/urls/__init__.py`، `settings/common.py`.

**Frontend — جدید:** `app/portal/{layout,public-layout,components}.tsx`، `app/portal/{model,api/client,api/portal}.ts`، `app/portal/pages/{login,setup,requests,new-request,request,settings}.tsx`، `app/portal/portal.test.tsx`، `app/crm/api/portal.ts`، `app/crm/ticket/portal-tab.tsx`، `app/crm/pages/portal-settings.tsx`، `styles/portal.css`، `tests/browser/crm-ticket-seven-portal-acceptance.mjs`.

**Frontend — تغییریافته:** `app/routes.ts`، `app/crm/ticket/{ticket-panel,ticket-header,model}.ts(x)`، `app/crm/api/ticket.ts`، `app/crm/access/permission-map.ts`، `app/crm/shell-nav.ts`، `styles/index.css`، `tsconfig.json` (شمول `app/portal`)، `package.json` (`test`: `app/crm app/portal`).

**اسناد:** `docs/CRM-PERMISSION-CATALOG.md`، این گزارش، `docs/evidence/ticket-7/`.

تغییرهای commitنشدهٔ قبلی (مرخصی، `0160`/`0161`) دست نخورد؛ `0162` به `0161` وابسته است.

## ۳. Migrationها و اثر بر دادهٔ موجود

- `0162_customer_portal`: `CreateModel` فقط برای `PortalAccount`، `PortalSession`، `PortalAuditLog` (معادل ندارند — بند ۱)؛ بقیه `AddField` (همه nullable یا با پیش‌فرض)، یک `AlterField` که فقط NOT NULL را برمی‌دارد (`issue_comments.project_id`) و دو `AddConstraint` جزئی. هیچ `RemoveField`/`DeleteModel`/`RenameField` (تست `test_migration_is_additive_and_creates_no_parallel_tables`؛ همان تست نشان می‌دهد هیچ جدولی با نام quote/invoice/payment/feedback/message ساخته نشده).
- `0163_customer_portal_permissions`: ثبت ۶ کد با `get_or_create` و اعطا فقط به نقش سیستمی admin.
- **شمارش پایگاه محلی پیش و پس از migration** (`company-crm-local-plane-db-1`، ۱۴۰۵/۰۸/۲۲ ساعت ۱۹:۴۳ پیش از اعمال؛ پس از اعمال بلافاصله):

| جدول | پیش | پس |
|---|---|---|
| issues | ۱۲۴ | ۱۲۴ |
| issue_comments (EXTERNAL) | ۰ (۰) | ۰ (۰) |
| file_assets | ۸ | ۸ |
| crm_entity_records / crm_entity_events | ۴۲۸ / ۲۵۹۹ | ۴۲۸ / ۲۵۹۹ |
| crm_entity_relation_links | ۴۴ | ۴۴ |
| notifications | ۵۳۰ | ۵۳۰ |
| ticket_routing_decisions / ticket_role_queue_entries | ۶۶ / ۸ | ۶۶ / ۸ |
| crm_lookup_values / crm_field_definitions | ۱۶ / ۴۱ | ۱۶ / ۴۱ |
| users / workspace_members | ۲۷۶ / ۲۴۵ | ۲۷۶ / ۲۴۵ |
| organization_permissions | ۱۱۳ | ۱۱۹ (فقط ۶ کد درگاه) |
| organization_role_permissions | ۹۵۵ | ۹۶۱ (۶ اعطا به admin) |

- اثرانگشت شماره‌ها پیش و پس یکسان: `md5(id:sequence_id:project_id)` روی `issues` = `aef48e08…`؛ `md5(id:number)` روی `crm_entity_records` = `e0f26f72…`.
- دادهٔ آزمون مرورگر پس از این شمارش ساخته شد (بند ۸).

## ۴. مجوزها و نقش‌ها

| کد | کاربرد | نقش پیش‌فرض |
|---|---|---|
| `Portal.Account.Manage` | ساخت حساب، فعال/غیرفعال، صدور پیوند یک‌بارمصرف تعیین/بازنشانی گذرواژه | admin |
| `Portal.Settings.Manage` | فهرست مجاز برچسب‌ها، نگاشت وضعیت، نام پاسخ‌دهنده، مهلت بازخورد، نشست، فایل، کانال‌ها | admin |
| `Portal.Request.Triage` | تأیید/رد/درخواست تکمیل؛ گیرندهٔ اعلان وقتی تیکت مسئول ندارد | admin |
| `Portal.Reply` | پیام `EXTERNAL` و «اطلاع به مشتری» در حل در تماس | admin |
| `Quote.Manage` | ساخت/ویرایش پیش‌نویس/ارسال/نسخهٔ جدید برآورد؛ تنها مجوز `record_permissions` موجودیت `quote` | admin |
| `Portal.Feedback.View` | دیدن امتیاز و نظر در تب «مکاتبات» | admin |

یادداشت داخلی کد جدید ندارد: همان رابطهٔ «مالک» تیکت ۵ (`is_owner`). کاربر درگاه هیچ کد و هیچ نقشی ندارد. ارجاع همان `refer/` تیکت ۵ است. آینهٔ رابط: `portalPermissions` در `permission-map.ts`؛ صفحهٔ `/portal-settings` با هر یک از دو کد مدیریت باز می‌شود.

## ۵. رویدادهای سابقه (append-only روی `crm_entity_events`)

- روی **تیکت**: `portal.request_submitted`، `portal.customer_message`، `portal.reply`، `portal.internal_note`، `portal.request_approved`، `portal.request_rejected` (دلیل)، `portal.info_requested` (مرحلهٔ قبلی، توقف گردش‌کار)، `portal.info_provided`، `portal.feedback` (یکتا)، `portal.feedback_edited`، `quote.created`، `quote.sent`، `quote.approved|rejected|revision_requested` (حساب، توضیح)، و `ticket.contact` با `notified_customer`. همه در فیلتر «درگاه و برآورد» سابقهٔ تیکت.
- روی **رکورد برآورد**: `quote.created`، `quote.draft_updated` (قبل/بعد)، `quote.sent`، `quote.decided` (یکتا؛ تصمیم، تاریخ، `account_id`، توضیح، نسخه).
- روی **رکورد مشتری**: `portal.account_created`، `portal.account_updated`، `portal.account_activated|deactivated`، `portal.account_link_issued` (بدون توکن)، `portal.password_set`، `portal.account_locked`.
- روی **تعریف**: `portal.settings_changed` (قبل/بعد کامل).
- **لاگ ممیزی درگاه** (`crm_portal_audit_logs`، append-only در مدل): حساب، نام کاربری (برای ورود ناموفق)، endpoint، متد، شناسهٔ شیء، کد پاسخ، نتیجه، IP، عامل کاربر، زمان — بدون بدنه، گذرواژه یا محتوای فایل.

## ۶. Endpointها

**درگاه (`/api/portal/v1/`، فقط کوکی `portal-session` + سرآیند `X-Portal-CSRF` برای متدهای ناامن):**

| مسیر | متد | throttle | پاسخ (فهرست سفید) |
|---|---|---|---|
| `auth/login/` | POST | `portal_login_ip` ۲۰/دقیقه + `portal_login_user` ۱۰/دقیقه | `{account: profile, csrf_token}` + کوکی `HttpOnly; SameSite=Strict; Path=/api/portal/; Secure` (طبق `SESSION_COOKIE_SECURE`) |
| `auth/logout/` | POST | read | ۲۰۴، نشست در سرور باطل |
| `auth/setup/` | POST | login_ip | `{username}` |
| `session/` | GET | read | `{account, csrf_token}` (توکن CSRF مشتق از نشست، یکسان در همهٔ تب‌ها) |
| `settings/` | GET/PATCH | read | `profile = {display_name, username, customer, notify{portal,email,sms}, channels_available, idle_minutes}` |
| `requests/` | GET | read | `{results:[{id, number, subject, status{code,title}, created_at, updated_at, unread}], count, page, pages, statuses, unread}` — فیلتر `status`، جست‌وجوی `q`، صفحهٔ ۲۰تایی |
| `requests/` | POST (multipart) | `portal_request` ۲۰/ساعت + `portal_upload` ۶۰/ساعت | جزئیات (پایین) |
| `requests/<uuid>/` | GET | read | `summary + {messages:[{id, author{kind,name}, kind, text, created_at, created_text, files:[{id,name,size,content_type,url}]}], quotes:[…], feedback, can_feedback, can_message, files{max_count,max_size,extensions}}` |
| `requests/by-number/<number>/` | GET | read | همان؛ فقط در محدودهٔ مشتری جاری |
| `requests/<uuid>/messages/` | POST | `portal_message` ۳۰/دقیقه + upload | یک پیام |
| `requests/<uuid>/feedback/` | POST/PATCH | `portal_decision` ۲۰/ساعت | `{rating, comment, submitted_at, edited, editable_until, can_edit}` |
| `quotes/<uuid>/decision/` | POST | decision | `{id, number, version, amount, items, valid_until, status{code,title}, decided_at, decision_comment, can_decide}` |
| `files/<uuid>/` | GET | read | stream با `Content-Disposition: attachment`، `nosniff`، `no-store` |

هر متد پشتیبانی‌نشده و هر شیء مشتری دیگر → **۴۰۴** با بدنهٔ یکسان. خطاها همیشه `{error, code?}` فارسی؛ ۴۲۹ با `code: "throttled"`، نشست پایان‌یافته ۴۰۱ با `code: "session_expired"`، CSRF ۴۰۳ با `code: "csrf_failed"`.

**داخلی (`/api/workspaces/<slug>/…`، نشست Django + CSRF Django):**

| مسیر | متد | مجوز |
|---|---|---|
| `portal/settings/` | GET / PUT | `Portal.Settings.Manage` یا `Portal.Account.Manage` / `Portal.Settings.Manage` |
| `portal/accounts/` | GET / POST | `Portal.Account.Manage` (پاسخ POST شامل `setup.path` یک‌بارمصرف ۷۲ ساعته) |
| `portal/accounts/options/` | GET | `Portal.Account.Manage` (+ `record_permissions` موتور روی مشتری/مخاطب) |
| `portal/accounts/<id>/` | PATCH | `Portal.Account.Manage` |
| `portal/accounts/<id>/link/` | POST | `Portal.Account.Manage` |
| `tickets/<id>/portal/` | GET | دید تیکت (`visible_ticket`)؛ بازخورد فقط با `Portal.Feedback.View` |
| `tickets/<id>/portal/messages/` | POST (multipart، `access` پیش‌فرض `INTERNAL`) | مالک تیکت؛ `EXTERNAL` + `Portal.Reply` و فقط تیکت درگاه |
| `tickets/<id>/portal/triage/` | POST `{action: approve|reject|need_info, message}` | `Portal.Request.Triage` |
| `tickets/<id>/portal/files/<id>/` | GET | دید تیکت |
| `tickets/<id>/quotes/` | POST | `Quote.Manage` |
| `quotes/<id>/` | PATCH (فقط پیش‌نویس) | `Quote.Manage` |
| `quotes/<id>/send/` | POST | `Quote.Manage` |
| `tickets/<id>/contact/` (موجود) | POST `+ notify_customer` | مالک؛ با اطلاع به مشتری `Portal.Reply` |

## ۷. نتایج آزمون

@@RESULTS@@

**تبدیل تست‌های «خلأ» مشخصه‌نگار (روی HEAD سبز بودند، پس از کار وارونه شدند):** `IssueComment.project.null` (HEAD: `False` → `True`)، `GET /api/portal/v1/session/` (HEAD: ۴۰۴ → ۴۰۱)، کدهای `Portal.*` در رجیستری (HEAD: نبود → هست)، قیدهای `crm_entity_events` (HEAD: هیچ → دو قید جزئی).

## ۸. سناریوهای مرورگر و شواهد

اسکریپت: `node apps/web/tests/browser/crm-ticket-seven-portal-acceptance.mjs` (از ریشهٔ مخزن، روی استقرار محلی Docker). نتیجه: **۱۲ سناریو / ۲۲ بررسی سبز، صفر خطای صفحه**؛ اسکرین‌شات‌ها و `report.json` در `docs/evidence/ticket-7/`.

| گام | سناریو | شاهد |
|---|---|---|
| ۰ | صفحهٔ «درگاه مشتری» (حساب‌ها، نگاشت وضعیت، کانال ایمیل/پیامک با برچسب «غیرفعال تا تنظیم سرویس») | `step-00.png` |
| ۱ | پیوند یک‌بارمصرف → تعیین گذرواژه → ورود مشتری الف | `step-01.png`، `step-01b.png` |
| ۲ | ثبت درخواست با فایل؛ وضعیت «ثبت‌شده» | `step-02.png` |
| ۳ | تب «مکاتبات» تیکت داخلی، نوار تریاژ، تأیید | `step-03.png`، `step-03b.png` |
| ۴ | یادداشت داخلی (پیش‌فرض کامپوزر) + پاسخ به مشتری با نشان متمایز | `step-04.png` |
| ۵ | مشتری فقط پاسخ را می‌بیند؛ متن یادداشت داخلی نه در صفحه و نه در JSON خام API | `step-05.png` |
| ۶ | برآورد نسخهٔ ۱ → درخواست اصلاح → نسخهٔ ۲ (پیش‌پر از نسخهٔ قبل) → تأیید دومرحله‌ای → تأییدشده (فرم تصمیم بسته می‌شود) | `step-06.png` … `step-06e.png` |
| ۷ | پایان کار → بازخورد ۵ از ۵؛ نمایش در تیکت داخلی | `step-07.png`، `step-07b.png` |
| ۸ | مشتری ب با URL درخواست/فایل مشتری الف → «پیدا نشد» و ۴۰۴ | `step-08.png` |
| ۹ | کوکی درگاه روی API داخلی رد می‌شود؛ نشست داخلی روی API درگاه ۴۰۱؛ اپ داخلی به `/login` هدایت می‌کند | `step-09.png` |
| ۱۰ | موبایل ۳۷۵px: فهرست و صفحهٔ درخواست بدون اسکرول افقی | `step-10.png`، `step-10b.png` |
| ۱۱ | خروج صریح (نشست در سرور باطل) و انقضای بی‌کاری با پیام | `step-11.png`، `step-11b.png` |
| ۱۲ | ردیف‌های لاگ ممیزی برای حساب مشتری الف (۳۲ ردیف) | `report.json` |

**آمادگی داده:** حساب‌ها از API همان صفحهٔ تنظیمات ساخته می‌شوند (دو رکورد مشتری موجود)؛ گردش‌کارهای فعال تیکت در طول اجرا خاموش و در پایان روشن می‌شوند؛ حساب‌های آزمون در پایان غیرفعال می‌شوند. تیکت‌های ساخته‌شده (برای سابقه) باقی می‌مانند.

**خطاهایی که در اجرای واقعی پیدا و رفع شد:** (۱) دکمهٔ «نسخهٔ جدید» برآورد فرم خالی باز می‌کرد و سرور به‌درستی ۴۰۰ می‌داد → نسخهٔ جدید از مبلغ و شرح نسخهٔ قبل پیش‌پر می‌شود؛ (۲) پس از ثبت تصمیم، فرم تأیید روی کارت باز می‌ماند → فقط تا وقتی نسخه قابل تصمیم است نمایش داده می‌شود؛ (۳) چرخش توکن CSRF در هر بارگذاری تب‌های دیگر را از کار می‌انداخت → توکن مشتق از نشست (بند ۱۰، تصمیم ۷.۱۲)؛ (۴) رکورد موتور تیکت را سیگنال موجود `ensure_work_record` می‌سازد → استفادهٔ مجدد به‌جای ساخت دوباره؛ (۵) `X-Portal-CSRF` به `CORS_ALLOW_HEADERS` افزوده شد تا استقرار با مبدأ جدا هم کار کند.

**رخداد محیط محلی (رفع‌شده):** اجرای هم‌زمان مجموعهٔ تست با ۴ worker و ساخت تصویر frontend حافظهٔ VM داکر (۷٫۷ گیگابایت) را تمام کرد و کانتینر `api` با `OSError: Out of memory` در حلقهٔ راه‌اندازی مجدد افتاد؛ Vite هم در حالت pre-bundle کهنه ماند. با حذف کانتینر تست باقی‌مانده، راه‌اندازی مجدد `api`/`worker`/`beat-worker` و `frontend` همه چیز سالم شد (`/login`، `/issues`، `/portal`، `/portal-settings` → ۲۰۰). ساخت دوبارهٔ تصویر frontend به‌دلیل دسترس‌ناپذیری رجیستری npm (`EAI_AGAIN`) ممکن نشد و لازم هم نبود: کانتینر dev فایل‌های منبع را همگام می‌کند.

## ۹. خارج از محدوده و پیش‌نیازهای فعال‌سازی

- **ایمیل/پیامک:** فقط لایهٔ adapter (`portal_notify.ADAPTERS` با `DisabledAdapter` که هیچ فراخوانی شبکه‌ای ندارد) و قالب‌های متنی `TEMPLATES` (پاسخ، تغییر وضعیت، برآورد). ارسال فقط وقتی ممکن است که هر سه شرط برقرار باشد: `PORTAL_NOTIFY_CHANNELS` سرور (پیش‌فرض خالی)، کانال در تنظیمات شرکت، و انتخاب خود مشتری — و حتی آن‌گاه adapter غیرفعال است (تست ۱۲). پیش‌نیاز فعال‌سازی: انتخاب سرویس‌دهنده، بازبینی و تأیید متن‌ها، مجوز ارسال، کلیدها در محیط امن، پیاده‌سازی adapter واقعی و تست آن.
- **مالی:** هیچ فاکتور، سند، پرداخت، حقوق یا اتصال مالی ساخته نشد. نقطهٔ توسعهٔ غیرفعال: سیگنال `quotes.quote_approved` (بدون هیچ گیرنده؛ تست `quote_approved.receivers == []`). پیش‌نیاز: تعیین سامانهٔ مالی، نگاشت اقلام، مجوز جدا و تأیید کسب‌وکار.
- چت زنده، SSO/ورود اجتماعی، اپ موبایل: انجام نشد.
- **نمایش تیکت داخلی به مشتری:** فقط تیکت‌های ثبت‌شده از درگاه در درگاه دیده می‌شوند؛ «انتشار» تیکتی که داخلی ساخته شده برای مشتری ساخته نشد.
- **ادامهٔ خودکار گردش‌کار پس از پاسخ مشتری:** `workflow_actions.resume` بازیگر داخلی می‌خواهد؛ پاسخ مشتری مرحلهٔ تریاژ را برمی‌گرداند و به تیم اعلان می‌دهد، ولی برداشتن توقف مرحله با کارشناس است.

## ۱۰. تصمیم‌ها

| شماره | تصمیم | دلیل/تغییر نسبت به پیش‌فرض |
|---|---|---|
| ۷.۱ | مدل جدا `PortalAccount` (نه `User`) | هر `User` در Plane به `/api/users/me/`، `/api/workspaces/…` و بسیاری endpoint دیگر با `IsAuthenticated` دسترسی بالقوه دارد؛ مدل جدا یعنی همهٔ endpointهای داخلی به‌طور طبیعی او را ناشناس می‌بینند (تست ۲). |
| ۷.۲ | `/api/portal/v1/` با `PortalAuthentication` و `IsPortalAccount`؛ `customer` فقط از نشست | پارامترهای `customer_id`/`customer_record_id`/`portal_account` تزریق‌شده نادیده گرفته می‌شوند (تست ۱). |
| ۷.۳ | route tree جدا در `apps/web` (`/portal/*`) با دو layout مستقل و QueryClient مستقل؛ کد API جدا در `app/portal/api/*` | نیاز به اپ جدید و build جدا نبود؛ هیچ import از `app-shell`/`shell-nav`/کلاینت داخلی ندارد. |
| ۷.۴ | تیکت native + `route_auto`؛ تریاژ با `Issue.portal_stage` | Intake پروژه‌محور است (بند ۱). |
| ۷.۵ | `IssueComment.access`؛ سریالایزر فهرست سفید؛ فیلتر در queryset | فیلد از قبل بود؛ فقط `project` nullable و `portal_account` افزوده شد. متن به‌صورت متن ساده ذخیره و نمایش داده می‌شود. |
| ۷.۶ | فهرست مجاز + نگاشت `category:`/`state:`/`status:` + برچسب مرحلهٔ تریاژ + پیش‌فرض | «آخرین برچسب مجاز قبلی» پیاده نشد؛ برچسب پیش‌فرض نمایش داده می‌شود (نیاز به ذخیرهٔ وضعیت نداشت). |
| ۷.۷ | برآورد روی موتور موجودیت `quote`؛ قفل نسخه؛ قید یکتای تصمیم | — |
| ۷.۸ | بازخورد در `EntityEvent` + بازتاب در `EntityRecord.data.portal_rating` (فیلد کتابخانهٔ `rating`) | درخواست «ردشده» بازخورد نمی‌گیرد (پایان کار نیست). |
| ۷.۹ | `FileAsset` + `sniff` محتوا + نام امن؛ دانلود stream | مسیرهای `../` را خود parser چندبخشی Django به نام پایه کاهش می‌دهد؛ `safe_name` هر نامی را که هنوز مسیر دارد رد می‌کند (دفاع لایه‌ای؛ تست `test_path_names_never_survive`). |
| ۷.۱۰ | `notify_customer` روی همان `contact/` | — |
| ۷.۱۱ | فقط اعلان درون‌درگاهی؛ adapter خاموش | — |
| ۷.۱۲ | ممیزی، throttle، نشست، CSRF، قفل | **CSRF:** به‌جای چرخش توکن در هر بارگذاری (که تب دوم را می‌شکست)، توکن با HMAC کلید سرور از هش نشست مشتق می‌شود. |

**تصمیم‌های نیازمند تأیید کسب‌وکار** (مقدار پیش‌فرض گذاشته شد و قابل تنظیم است): متن شش برچسب پیش‌فرض وضعیت مشتری؛ مهلت ویرایش بازخورد (۷۲ ساعت)؛ نام پاسخ‌دهنده («تیم پشتیبانی» در برابر نام کارمند)؛ بی‌کاری ۳۰ دقیقه و عمر مطلق ۱۲ ساعت نشست؛ قفل پس از ۵ تلاش برای ۱۵ دقیقه؛ ۵ فایل ۵ مگابایتی با پسوندهای `pdf, png, jpg, jpeg, gif, webp, txt, docx, xlsx`؛ اعتبار پیوند تعیین گذرواژه ۷۲ ساعت؛ دیدن درخواست‌های یکدیگر توسط چند حساب یک مشتری (پیش‌فرض: بله — محدودهٔ داده «مشتری» است).

## ۱۱. ریسک‌های باقی‌مانده

- **IP پشت پراکسی:** `get_client_ip` موجود به `X-Forwarded-For` اعتماد می‌کند؛ اگر پراکسی معتبر آن را بازنویسی نکند، throttle بر اساس IP دورزدنی است (throttle نام کاربری و قفل حساب مستقل از IP است).
- **شمارش قفل حساب** برای نام کاربری موجود رخ می‌دهد؛ پیام «قفل است» وجود حساب را آشکار می‌کند (پیام ورود ناموفق یکسان است).
- **فهرست درخواست‌ها** وضعیت مشتری را در Python محاسبه می‌کند (تا ۱۰۰۰ درخواست اخیر هر مشتری)؛ برای مشتری با حجم بسیار بالا نیاز به فیلد محاسبه‌شده است.
- **عنوان تیکت** (`Issue.name`) در درگاه نمایش داده می‌شود؛ اگر کارمند آن را به متن داخلی تغییر دهد، مشتری می‌بیند (شرح داخلی نمایش داده نمی‌شود؛ متن اولیه از پیام آغازین است).
- **حذف/ویرایش پیام‌ها** در رابط پیاده نشد؛ کامنت‌ها از مسیرهای Plane قابل حذف نرم‌اند (تیکت‌های بی‌پروژه در رابط Plane دیده نمی‌شوند).
- **ویجت داشبورد:** امتیاز در `portal_rating` ذخیره می‌شود؛ برای میانگین در ویجت شمارنده، فیلد `portal_rating` باید در فرم تیکت قرار گیرد (تغییر فرم تیکت داخلی عمداً انجام نشد).
@@RISKS@@
