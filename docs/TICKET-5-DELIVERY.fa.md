# تیکت ۵ از ۸ | هستهٔ تیکت و ارجاع — گزارش تحویل

> وضعیت: **انجام‌شده.** Backend و Frontend پیاده شد، migration روی پایگاه محلی اعمال شد، همهٔ ۱۱ سناریوی پذیرش مرورگر (۱۷ بررسی) سبز است و هیچ تست رگرسیونی که روی HEAD سبز بوده قرمز نشده است (بند ۹). **هیچ commitی انجام نشده است.**
> تست‌های مشخصه‌نگار وضع پیش از کار: `apps/api/plane/tests/contract/app/test_ticket_five_baseline.py` (در فاز ۱: ۱۳ از ۱۳ سبز روی رفتار قبلی؛ سه تستی که «خلأ» را تثبیت می‌کردند پس از کار به آزمون «پس از کار» تبدیل شدند — بند ۱۰).

## ۱. جدول خلأ (پیش و پس از کار)

| بند تیکت | پیش از کار در کد (`file:line`) | تست وضع موجود | کمبود | تصمیم | دلیل نساختن مدل موازی | پس از کار |
|---|---|---|---|---|---|---|
| ن۱ فیلدهای اصلی | `db/models/issue.py:104` (`Issue`)، `:131` والد، `:148` تخمین، `:167` سررسید (`DateField`)، `:435` `IssueAssignee`؛ `created_by`؛ نوع: `entity_issue_types.py:16` | `test_issue_has_due_date_and_estimate_…` | فرم تیکت فقط ۷ فیلد داشت؛ والد/فرزند، ثبت‌کننده، نوع، برچسب و تخمین در صفحهٔ تیکت دیده نمی‌شد | استفادهٔ مجدد + نمایش | همه روی ستون‌های native `Issue` | کارت «مشخصات تیکت» (`ticket_core.details_payload`)؛ والد/فرزند با `POST tickets/<id>/parent/` روی `Issue.parent` (حلقه، خودِ تیکت و workspace دیگر مسدود؛ والدِ خارج از دسترسی فقط «خارج از دسترسی» نشان داده می‌شود)؛ مشتری از ارتباط موجود `customer↔ticket`؛ فیلدهای هسته همچنان در `MANDATORY_SOURCES`/`SOURCE_FIELDS` قفل‌اند |
| ن۲ مدت هدف | فقط `WorkflowStepRun.target_*` (`workflow.py:141`) و `WorkflowInstance.target_*` | همان | تیکت بدون گردش‌کار هدف نداشت؛ هدف نوع نبود | گسترش افزایشی (تصمیم ۱) | ستون روی همان `Issue` و `IssueType` | `Issue.target_minutes/target_started_at/target_anchor_at/target_anchor_minutes/target_at/target_calendar`؛ `IssueType.target_minutes`؛ شروع فقط در نخستین ورود به «در حال انجام» (`db/signals/ticket_lifecycle.py` → `ticket_core.on_saved`) |
| ن۲ محاسبهٔ زمان | `work_calendar.py:246,233,118` | `test_add_working_time_matches_reference_table` | — | استفادهٔ مجدد | — | همهٔ محاسبه‌ها فقط از `add_working_time`/`working_minutes_between`/`schedule_for`/`availability`؛ موعد و منبع تقویم ذخیره می‌شود |
| ن۳ نمایش | `workflow_engine.py:589` | — | فقط برای مرحله | ساخت سبک | — | `GET tickets/<id>/core/` + کارت «زمان هدف» با ۷ حالت بخش ۶.۲ |
| ن۴ تمدید | `workflow_actions.py:836,908`؛ `WorkflowExtension` | `test_workflow_engine.py` | وابسته به `step_run` | گسترش افزایشی | همان جدول `crm_workflow_extensions` (FK اختیاری `issue`، `scope=ticket`، `minutes`، `approver`) | پیش‌نمایش، درخواست، تصمیم؛ قید «یک درخواست باز» با `crm_ticket_one_open_extension` |
| ن۵ دیرکرد | `workflow_actions.py:798,1131`؛ beat | — | فیلتر و علامت روی تیکت نبود | گسترش افزایشی | همان `crm_workflow_delay_reports` (FK اختیاری `issue`) | `ticket_core.mark_overdue` + `bgtasks/ticket_overdue.py` (هر ۵ دقیقه)، بنر و گزارش append-only |
| ن۶ نگاشت وضعیت | `workflow_engine.py:70`، `issue-status.ts:17` | `test_task_status_group_mapping_…` | دو نگاشت، بدون سه‌دسته | ساخت سبک | — | تابع واحد `ticket_core.work_category`/`category_of`/`category_expression` (بند ۶)؛ همان در شروع هدف، دیرکرد، فیلتر «بسته‌شده»، حجم کار ارجاع، ویجت‌های داشبورد (`my-work`، `age`، نمودار «دستهٔ وضعیت») و دستهٔ هر ردیف «همه کارها/کارهای من». رابط فقط آینه است: ردیف‌ها `category` را از سرور می‌گیرند، کانبان زیر سه دسته گروه‌بندی می‌شود و جدول نگاشت رابط با تست به جدول سرور قفل است؛ «لغوشده» در رابط هم «انجام‌شده» است |
| ن۷ نماها | `entity_views.py` (query)، `view-page.tsx` | `test_direct_manager_…` | فیلتر آماده نبود | گسترش افزایشی | — | `preset` در `engine/entities/ticket/query/` + `preset_counts` + `ticket_deadlines`؛ نوار فیلتر و نشان موعد در جدول/فهرست/کارت/کانبان؛ همین در `tasks/table/` برای «همه کارها» و «کارهای من»؛ منوی ردیف «حل در تماس» و «ارجاع» (برای تیکت بدون مسئول هم) و نشان «بدون مسئول» |
| ن۸ قواعد ارجاع | `ticket_routing.py`؛ `organization.py:332,350,378` | سه تست مشخصه‌نگار | معیار، ترتیب، روش، نوبت، حجم کار، دلیل نبود | گسترش افزایشی | همان سه جدول | `position`، `conditions` (نوع/اولویت/مشتری/پروژه/واحد + شرط پیشرفته با `entity_rules.condition`)، `method`، `target_user`، `member_ids`، `cursor`؛ دلیل و جزئیات در `TicketRoutingDecision.reason/details` |
| ن۸ تیکت بی‌پروژه | `crm_notifications.py:111` | `test_routing_a_project_less_…` | **IntegrityError** | رفع | — | `subscribe_assignee` برای کار بی‌پروژه subscriber نمی‌سازد |
| ن۸ جانشین/غیبت | `access_control.py:48,255` | تست صف | `availability` لحاظ نمی‌شد | استفادهٔ مجدد | — | غیبت از `availability` (دلیل `absence`)، جانشین از `acting_delegate` |
| ن۸ صف بدون مسئول | `TicketRoleQueueEntry.rule` اجباری | همان | — | گسترش افزایشی | همان جدول (`rule`، `required_role` nullable + قید `ticket_queue_unique_open_unassigned`) | اعلان به مدیر واحد قاعده و دارندگان `Routing.Queue.ViewAll` |
| ن۹ ارجاع دستی | `task_policy.py:22` | `test_non_admin_…` | پذیرش/رد/ارجاع مجدد نبود | ساخت سبک | زنجیره در همان `TicketRoutingDecision` (`outcome=referred`، `previous`، `response…`) | `POST refer/`، `POST referral/respond/` |
| ن۱۰ ارتباط‌ها | `entity_relations.py` | — | — | استفادهٔ مجدد | — | بدون تغییر؛ معیار «مشتری» از `EntityRelationLink` خوانده می‌شود |
| ن۱۱ سابقه | `emit` / `EntityEvent` | — | بستن/بازگشایی، موعد و فیلدهای هسته رویداد جدا نداشتند | گسترش افزایشی | همان `crm_entity_events` | رویدادهای `ticket.*` (بند ۵)؛ خط زمانی با فیلتر نوع |
| ن۱۲ حل در تماس | `workflow_actions.py:984,1027` | `test_workflow_engine.py` | فقط برای گردش‌کار مسیر کوتاه | گسترش افزایشی | رکورد تماس ساخته نمی‌شود | `POST tickets/<id>/contact/`: اگر مسیر کوتاه فعال باشد همان `contact_resolve`/`to_standard`؛ وگرنه رویداد `ticket.contact` + بستن یا `route_auto` |
| شماره‌گذاری | `entity_numbering.py:38` | `test_crm_identifiers.py` | — | بدون تغییر | — | شماره‌ها ثابت (تست ۲ و اثرانگشت پایگاه محلی، بند ۳) |
| مجوزها | `permission_registry.py` | — | `Routing.*` موجود | فقط `Ticket.TargetSet` جدید | — | بند ۴ |

## ۲. فایل‌ها

**Backend — جدید:** `app/services/ticket_core.py`، `app/views/workspace/ticket.py`، `db/signals/ticket_lifecycle.py`، `bgtasks/ticket_overdue.py`، `db/migrations/0158_ticket_five_core.py`، `db/migrations/0159_ticket_five_permissions.py`، `tests/contract/app/test_ticket_five.py`، `tests/contract/app/test_ticket_five_baseline.py`.

**Backend — تغییریافته:** `app/views/workspace/task_table.py` (`preset`، `preset_counts` و موعد هر ردیف برای «همه کارها» و «کارهای من»)، `app/services/ticket_routing.py` (روش‌ها، انتخاب خودکار، پیش‌نمایش)، `app/services/task_visibility.py` (دید فقط‌خواندنی شرکت‌کنندگان)، `app/services/entity_records.py` (فقط‌خواندنی‌بودن شرکت‌کننده، `routing_rule_id="auto"`، ارجاع تیکت بی‌پروژه)، `app/services/crm_notifications.py`، `app/services/permission_registry.py`، `app/serializers/organization.py`، `app/views/workspace/organization.py`، `app/views/workspace/entity_views.py`، `app/views/issue/base.py` (`require_owner` در PATCH/DELETE)، `app/urls/workspace.py`، `db/models/issue.py`، `db/models/issue_type.py`، `db/models/organization.py`، `db/models/workflow.py`، `db/apps.py`، `celery.py`، `settings/common.py`.

**Frontend — جدید:** `app/crm/api/ticket.ts`، `app/crm/ticket/{model.ts,ticket-panel.tsx,ticket-header.tsx,row-dialogs.tsx,routing-rules.tsx,extension-inbox.tsx,preset-bar.tsx,deadline-badge.tsx,ticket-five.test.tsx}`، `styles/ticket.css`، `tests/browser/crm-ticket-five-acceptance.mjs`.

**Frontend — تغییریافته:** `pages/issues.tsx` و `pages/my-work.tsx` (نوار فیلتر آماده)، `engine/work-table.tsx` و `kanban.tsx` (نشان موعد)، `engine/native-form-page.tsx` (پنل تیکت در صفحهٔ باز شدن کار از «همه کارها»/«کارهای من»)، `table-hooks.ts`، `types.ts`، `engine/record-pages.tsx`، `engine/record-drawer.tsx`، `engine/view-page.tsx`، `engine/view-renderers.tsx`، `engine/view-types.ts`، `pages/routing.tsx`، `role-queue.tsx`، `role-queue-model.ts`، `workflow/inbox-page.tsx`، `access/permission-map.ts`، `styles/index.css`.

## ۳. Migrationها و اثر بر دادهٔ موجود

- `0158_ticket_five_core`: فقط `AddField`، `AlterField` (nullable کردن یا افزودن choice) و `AddConstraint`؛ هیچ `CreateModel`/`RemoveField`/`DeleteModel` (تست `test_migration_is_additive_and_creates_no_ticket_table`). ستون‌های جدید همه nullable یا با پیش‌فرض‌اند؛ قواعد موجود با `method="manager"` همان رفتار قبلی را دارند.
- `0159_ticket_five_permissions`: ثبت `Ticket.TargetSet` با `get_or_create` و اعطا به نقش سیستمی admin.
- **شمارش پایگاه محلی پیش و پس از migration** (`company-crm-local-plane-db-1`، ۱۴۰۵/۰۸/۲۰):

| جدول | پیش | پس |
|---|---|---|
| issues | ۳۸ | ۳۸ |
| states | ۱۸ | ۱۸ |
| issue_types | ۰ | ۰ |
| issue_assignees | ۴۴ | ۴۴ |
| issue_sequences | ۳۸ | ۳۸ |
| ticket_routing_rules / decisions / role_queue_entries | ۳ / ۳ / ۱ | ۳ / ۳ / ۱ |
| crm_workflow_extensions / delay_reports | ۵ / ۰ | ۵ / ۰ |
| crm_entity_records / crm_entity_events | ۱۷۴ / ۶۹۵ | ۱۷۴ / ۶۹۵ |
| organization_permissions | ۱۰۸ | ۱۰۹ (فقط `Ticket.TargetSet`) |

- اثرانگشت شماره‌ها پیش و پس یکسان: `md5(id:sequence_id:project_id)` روی `issues` = `36a220d9…`؛ `md5(id:number)` روی `crm_entity_records` = `464c8fe3…`.

## ۴. مجوزها و نقش‌ها

| کد | کاربرد | نقش پیش‌فرض |
|---|---|---|
| `Ticket.TargetSet` (**جدید**) | تعیین/تغییر مدت هدف تیکت و نوع | admin |
| `Routing.Manage` (موجود) | ساخت، ویرایش و ترتیب قواعد | admin |
| `Routing.View` (موجود) | دیدن قواعد و پنل آزمایش | admin، member |
| `Routing.Route` (موجود) | ارجاع مدیریتی / ارجاع خودکار دستی | admin، member |
| `Routing.Queue.ViewAll` (موجود) | دیدن صف بدون مسئول و ارجاع از آن؛ گیرندهٔ اعلان «بدون مسئول» | admin |

تأیید تمدید کد ندارد: فقط `approver` ذخیره‌شده، مدیر مستقیم مسئول اصلی یا جانشین فعال او. درخواست تمدید و گزارش تأخیر فقط مسئول اصلی یا جانشین فعالش. کدها در `web/app/crm/access/permission-map.ts` (`ticketActionPermissions`) هم ثبت شدند.

## ۵. سرویس‌ها و مصرف‌کننده‌ها

- **استفادهٔ مجدد:** `work_calendar` (همهٔ محاسبهٔ زمان)، `workflow_engine.managers_of/acting_delegate/unit_delegate/is_absent/company_calendar_user/contact_channels/fa_moment`، `workflow_actions.contact_resolve/to_standard` (برای تیکت دارای مسیر کوتاه)، `access_control.delegation_context/management_relation/has_permission`، `task_policy.validate_other_assignees`، `entity_rules.condition/validate_condition` و `ConditionEditor`، `entity_records.apply_workflow_status`، `crm_notifications.notify_members/notify_role_queue`، `TicketRoleQueueEntry`، `WorkflowExtension`، `WorkflowDelayReport`، `EntityEvent`.
- **رویدادهای سابقه:** `ticket.category_changed`، `ticket.closed`، `ticket.reopened`، `ticket.target_started/changed/restarted`، `ticket.overdue_flagged`، `ticket.extension_requested/approved/rejected`، `ticket.delay_reported`، `ticket.contact`، `ticket.referred/referral_accepted/referral_rejected`، `ticket.routed`، `ticket.queued`، `ticket.field_changed` (اولویت، سررسید، نوع، پروژه، والد). هر ردیف: عامل، زمان، قبلی، جدید، دلیل.
- **API:** `tickets/<id>/{core,target,parent,extension,extension/preview,delay-report,contact,refer,referral/respond,history,route}/`، `ticket-types/`، `ticket-types/<id>/target/`، `ticket-extensions/inbox/`، `ticket-extensions/<id>/decide/`، `organization/routing-rules/{order,preview}/`.

## ۶. جدول نگاشت‌ها

**فیلدها (ن۱):**

| فیلد | منبع |
|---|---|
| عنوان، شرح، اولویت، سررسید، پروژه، مسئولان | `Issue.name/description_html/priority/target_date/project/IssueAssignee` (bindingهای فرم: `title`، `rich_description`، `priority`، `due_date`، `project`، `ticket_assignees`) |
| وضعیت | `State` پروژه (تیکت پروژه) یا `Issue.status` از lookup `task-status` |
| نوع | زیرنوع موجودیت ↔ `IssueType` (`entity_issue_types`) |
| ثبت‌کننده | `Issue.created_by` — فقط‌خواندنی |
| مشتری | ارتباط موجود `customer ↔ ticket` (`EntityRelationLink`) |
| والد/فرزند | `Issue.parent` |
| تخمین، برچسب | `Issue.estimate_point`، `IssueLabel` (نمایش) |
| مدت هدف/موعد | `Issue.target_*` (جدید)، `IssueType.target_minutes` (جدید) |

**وضعیت (ن۶) — تابع واحد `ticket_core.work_category`:**

| مقدار | دسته |
|---|---|
| backlog، unstarted، triage؛ `todo` | انجام‌نشده |
| started؛ `in_progress`، `review`، `blocked` | در حال انجام |
| completed، **cancelled**؛ `done` | انجام‌شده (فیلتر «بسته‌شده» = این دسته) |
| کد ناشناختهٔ `task-status` | انجام‌نشده |

همین تابع در شروع هدف، دیرکرد، فیلتر «بسته‌شده»، حجم کار ارجاع و سابقه به کار رفته است.

## ۷. تصمیم‌ها (بخش ۹ تیکت)

> **هر ۹ پیشنهاد در ۱۴۰۵/۰۸/۲۰ توسط صاحب محصول تأیید شد** و همان‌ها پیاده شد.

1. **جای موعد:** روی خود `Issue` (تنها منبع موعد تیکت). مدت پیش‌فرض نوع روی `IssueType.target_minutes`. موعد مرحلهٔ گردش‌کار (`WorkflowStepRun.target_at`) موعد «مرحله» است و جدا می‌ماند.
2. **بازگشایی:** ادامهٔ زمان باقی‌مانده: هنگام بستن، دقیقهٔ کاری باقی‌مانده در `target_anchor_minutes` ذخیره و با شروع دوباره از همان لحظه روی تقویم ادامه می‌یابد (اگر پیش از بستن دیرکرده بود، موعد قبلی می‌ماند).
3. **تغییر مسئول:** موعد ثابت می‌ماند؛ تقویم مبنا همان `target_calendar.user_id` لحظهٔ شروع.
4. **بدون مدیر مستقیم:** جانشین واحد؛ مدیر غایب ← جانشین فعالش؛ در نبود هر دو، درخواست با پیام فارسی رد می‌شود (بدون بالا رفتن به مدیر بالادست).
5. **رد ارجاع:** به ارجاع‌دهنده برمی‌گردد.
6. **دید تأییدکننده:** فقط‌خواندنی برای تأییدکنندهٔ تمدید و شرکت‌کنندگان ارجاع؛ ویرایش در `record_edit_actions`، `save_record` و PATCH/DELETE پلین مسدود.
7. **چند مسئولی:** قدیمی‌ترین مسئول فعال، مسئول اصلی است.
8. **cancelled:** «انجام‌شده» و جزو «بسته‌شده».
9. **یادآوری:** علامت‌گذاری هر ۵ دقیقه، اعلان یک‌بار در لحظهٔ دیرکرد (مسئول + مدیر مستقیم) و سپس روزی یک‌بار به مسئول تا ثبت گزارش؛ نزدیک موعد = ۲۰٪ پایانی.

**تصمیم‌های طراحی دیگر:**
- معیار «واحد» در قاعده = واحد ثبت‌کنندهٔ تیکت (با زیرواحدها). فیلد `unit` قبلی همچنان «واحد شروع» روش «مدیر واحد» است.
- «در دسترس نبودن» در ارجاع = غیبت ثبت‌شده (`availability` با دلیل `absence`). بیرون از ساعت کاری یا در جلسه، فرد همچنان مقصد معتبر است و موعد فقط زمان کاری را می‌شمارد؛ در غیر این صورت هر تیکت شبانه به صف می‌رفت.
- جانشین فقط برای فردی که مدیر واحد است وجود دارد (`acting_delegate`)؛ عضو غایب در نوبت کنار گذاشته و در دلیل تصمیم ذکر می‌شود.
- «زمان پایان جدید» در گزارش تأخیر **برآورد مسئول است و موعد رسمی را بدون تمدید تأییدشده تغییر نمی‌دهد** (تست `test_overdue_flag_is_idempotent_…`).
- مدت هدف، تمدید و تأخیر هیچ اثری بر حضور، ورود/خروج، اضافه‌کاری یا حقوق ندارند و هیچ ردیف `PresenceDeclaration`/`ActivityConfirmation` نمی‌سازند (تست ۸).
- تغییر پیش‌فرض نوع فقط بر تیکت‌هایی اثر دارد که هنوز شروع نشده‌اند؛ موعد ذخیره‌شده بی‌سابقه جابه‌جا نمی‌شود.

## ۸. کارهایی که عمداً انجام نشد

- **رویداد کاری در محاسبهٔ موعد:** `add_working_time` رویداد کاری (`WorkEvent`) را کم نمی‌کند و طبق دستور تیکت («رفتار موجود را تغییر نده») تغییر داده نشد. جدول بخش ۵ ردیف ۱ تا ۴ دقیقاً منطبق است؛ ردیف ۵ تفاوت گزارش‌شده است.
- **تعطیلی رسمی شرکتی:** مدلی برای آن نیست؛ با `WorkScheduleException` هر فرد یا روز غیرکاری برنامهٔ هفتگی بیان می‌شود.
- **عملیات گروهی `QuerySet.update` روی وضعیت:** از signal عبور نمی‌کند (رفتار Django)؛ مسیرهای وضعیت این مخزن از `save()` می‌گذرند.
- **نشان «نزدیک موعد» در فهرست:** برای ردیف‌های صفحهٔ جاری محاسبه می‌شود (حداکثر اندازهٔ صفحه)؛ کارت تیکت دقیق است.
- **آستانهٔ قابل تنظیم «نزدیک موعد»:** ثابت ۲۰٪ (تصمیم ۹)؛ تنظیم جدا ساخته نشد.

**صفحهٔ تیکت طبق ۶.۲:** سربرگ «شماره · عنوان [وضعیت ▾] [ارجاع] [⋯]» و سطر «نوع · اولویت · مشتری · پروژه · ثبت‌کننده»؛ منوی وضعیت گزینه‌ها را از سرور با دستهٔ ن۶ (optgroup) می‌گیرد و تغییر از ذخیرهٔ عادی رکورد می‌گذرد (مجوز، قفل گردش‌کار و سابقه حفظ می‌شود)؛ تب‌های «سابقه | ارجاع‌ها | مرتبط‌ها | زیرتیکت‌ها»؛ «مسیر کوتاه: حل در تماس» بالای تب‌ها؛ کارت‌های «زمان هدف»، «ارجاع» و «مشخصات تیکت» در ستون کناری. همین پنل در صفحهٔ `/entities/ticket/<id>`، کشوی خلاصه و صفحهٔ بازشدن کار از «همه کارها»/«کارهای من» (`/edit/ticket|task/<id>`) است. در پنل «آزمایش قاعده» تیکت نمونه از فهرست انتخاب می‌شود.

## ۹. نتیجهٔ تست‌ها

| مجموعه | نتیجه |
|---|---|
| Backend تیکت ۵ (`test_ticket_five.py` + `test_ticket_five_baseline.py`، Docker) | **۵۶ سبز / ۰ قرمز** |
| رگرسیون (۱۵ فایل: `test_organization_routing`، `test_work_calendar`، `test_workflow_engine`، `test_crm_access_control`، `test_task_assignment_policy`، `test_entity_engine`، `test_crm_identifiers`، `test_workspace_tasks`، `test_crm_notification_events`، `test_crm_ticket_three`، `test_entity_views`، `test_relation_completion`، `test_sub_issue_cross_project_scope_app`، `test_ticket_six`، `test_ticket_seven`) | **۲۶۴ سبز / ۹ قرمز — هر ۹ روی HEAD هم قرمزند** |
| Frontend vitest (کل `app/crm`) | **۵۵ فایل / ۴۲۸ تست سبز** (۲۶ تست در `ticket/ticket-five.test.tsx` + گروه‌بندی کانبان در `kanban.test.ts`) |
| `tsc --noEmit` | بدون خطا در کد تیکت ۵؛ یک خطا در `workflow/workflow.test.tsx` از تغییر هم‌زمان جلسهٔ دیگر در `api/workflow.ts` (۱۴۰۵/۰۸/۲۱ ساعت ۱۲:۴۲) که به این تیکت مربوط نیست |
| oxlint روی فایل‌های جدید/تغییریافته | ۰ خطا؛ فقط هشدار `no-await-in-loop` در اسکریپت مرورگر (گام‌های عمداً ترتیبی، مثل اسکریپت تیکت ۴) |
| پذیرش مرورگر (`apps/web/tests/browser/crm-ticket-five-acceptance.mjs`) | **۱۱ سناریو / ۱۸ بررسی سبز** (سربرگ و تب‌های صفحهٔ تیکت، کانبان سه‌دسته‌ای «همه کارها»، «حل در تماس» از منوی ردیف، گزارش تأخیر با انتخاب‌گر تاریخ شمسی)؛ اسکرین‌شات‌ها و `report.json` در `docs/evidence/ticket-5/` |

**شکست‌های از قبل موجود** (روی worktree تمیز از HEAD `c8eeee0` هم قرمزند؛ هیچ‌کدام از کد تیکت ۵ عبور نمی‌کنند):
`test_password_is_separate_hashed_and_audited`، `test_native_ticket_task_leave_and_dynamic_business_choices` و `test_native_member_can_change_own_status_without_obtaining_general_edit_permission` (موجودیت `task` در این درخت وجود ندارد)، `test_issue_api_cannot_change_its_reference`، `test_normal_member_can_transfer_own_project_issue_to_any_team_member`، `test_role_queue_notifies_eligible_role_members_once`، `test_deleted_members_are_hidden_and_readd_cannot_restore_grants[membership|members]`، `test_unit_toggle_preserves_structure_and_members`.

**آمادگی دادهٔ آزمون مرورگر:** کاربران، نقش‌ها، واحد و استثنای «تمام روز کاری» برای مسئول از همان APIهای صفحه‌ها ساخته می‌شوند؛ غیبت، جانشین واحد و نوع تیکت از Django shell (API ندارند). در این workspace ارتباط پروژه↔مشتری از هر دو سو اجباری است و ساختن تازهٔ هیچ‌کدام ممکن نیست؛ اسکریپت یک مشتری و پروژهٔ موجود را به کار می‌برد. گردش‌کارهای فعال تیکت ۴ در طول اجرا خاموش و در پایان دوباره روشن می‌شوند؛ قواعد آزمون غیرفعال و ترتیب قبلی برمی‌گردد. در گام ۵ گزارش تأخیر کامل در خود پنجره و با انتخاب‌گر تاریخ شمسی ثبت می‌شود.

## ۱۰. خطاهایی که در اجرای واقعی پیدا و رفع شد

1. **ارجاع تیکت بی‌پروژه به فرد** با `IntegrityError` می‌شکست (`issue_subscribers.project_id` NOT NULL) — از تست مشخصه‌نگار فاز ۱؛ رفع در `crm_notifications.subscribe_assignee`.
2. **ساخت تیکت با `routing_rule_id="auto"`** در موتور موجودیت به `AttributeError` می‌رسید (`AUTO.id`) — رفع در `entity_records.save_native`.
3. **کانتینر frontend محلی متوقف نمی‌شد** (فرایند zombie در Docker)؛ با `docker rm -f` و بالا آوردن دوبارهٔ تصویر تازه حل شد. بالا آمدن اولیه به‌خاطر اجرای هم‌زمان مجموعهٔ تست بسیار کند بود (سامانه «بالا نمی‌آمد»)؛ با توقف تست‌ها بالا آمد.
4. **دریافت از صف نقش ۵۰۰ می‌داد:** nullable شدن `required_role` باعث outer join در `select_for_update` شد (`FOR UPDATE cannot be applied to the nullable side of an outer join`). قفل فقط روی ردیف صف (`of=("self",)`)؛ صف بدون مسئول قابل «دریافت» نیست و مدیر آن را ارجاع می‌دهد.
5. **چیدمان صفحهٔ تیکت در عرض کم به‌هم می‌ریخت** و رویدادهای عمومی رکورد در سابقه JSON خام نشان می‌دادند: شکست ستون‌ها بر اساس container query، شکستن متن بلند، و نمایش «N فیلد» به‌جای JSON.
6. **آدرس مستقیم تیکتِ غیرمجاز** سربرگ و فرم خالی نشان می‌داد؛ حالا صفحه فقط پیام «این رکورد پیدا نشد یا اجازهٔ دیدن آن را ندارید» با پیوند بازگشت دارد.
8. **امکانات تیکت در صفحه‌های اصلی کار دیده نمی‌شد:** نسخهٔ اول فقط جدول موتور داده (`/entities/ticket`) را پوشش می‌داد، در حالی که کاربران از «کارها ← همه کارها» (`/issues`) و «کارهای من» کار می‌کنند و کار را در `/edit/ticket|task/<id>` باز می‌کنند. فیلترهای آماده با شمارندهٔ سرور، نشان موعد در فهرست و کانبان و پنل کامل تیکت به همین صفحه‌ها اضافه شد (تست `test_all_work_table_has_presets_counts_and_deadlines`).
7. **دکمهٔ غیرفعال** نام دسترس‌پذیر را از `title` (دلیل) می‌گرفت؛ `title` حذف شد و دلیل با `aria-describedby` متصل است.

## ۱۱. موضوع‌های باز

- رویداد کاری در محاسبهٔ موعد (بند ۸) نیاز به تصمیم جدا دارد چون رفتار تیکت ۳ را تغییر می‌دهد.
- فرم پیش‌فرض تیکت در موتور موجودیت هنوز فقط ۷ فیلد native را binding دارد؛ والد، نوع، برچسب و تخمین در کارت «مشخصات تیکت» نمایش/مدیریت می‌شوند و افزودن آن‌ها به فرم‌ساز به گسترش `SOURCE_FIELDS` نیاز دارد.
