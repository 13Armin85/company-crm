# تیکت ۴ از ۸ | موتور گردش‌کار — گزارش تحویل

> وضعیت: همهٔ بندهای تیکت پیاده و آزموده شده‌اند؛ هیچ commitی انجام نشده است. خود فرایند «درخواست مرخصی» (تبدیل درخواستِ تأییدشده به غیبت ثبت‌شده و قواعد خاص آن) کار تیکت بعدی است؛ موتور برای آن آماده است (بند ۷).

## ۱. جدول خلأ (پیش و پس از کار)

| بند تیکت | پیش از کار در کد | کمبود | تصمیم | پس از کار |
|---|---|---|---|---|
| وضعیت تیکت | lookup `task-status`؛ اعتبارسنجی در `entity_choices.py:49` و `entity_records.py` (`validate_reference`) | — | استفادهٔ مجدد | مرحله فقط به کد همین lookup اشاره می‌کند؛ تیکتِ داخل پروژه با گروه State پروژه نگاشت می‌شود (`STATE_GROUPS`) |
| وضعیت مرخصی | `UserAbsence.Status` = scheduled/cancelled/ended (`organization.py:290`) | «در انتظار تأیید» نبود | گسترش افزایشی | مقدار `pending` به choices افزوده شد (فقط state در migration؛ تغییری در جدول نیست). `availability`، `busy_blocks`، `delegation_context`، `TicketRoutingService` و کنترل هم‌پوشانی `clean()` فقط `scheduled` را می‌شمارند، پس `pending` «در دسترس نیست» حساب نمی‌شود |
| شناسهٔ رکورد | تیکت = ردیف native `Issue`؛ sidecar `EntityRecord` ممکن است وجود نداشته باشد | — | ساخت | instance به `(entity, record_id)` وصل است که همان شناسهٔ عمومی رکورد (`EntityEvent.record_id`) است؛ برای adapter و موجودیت سفارشی هر دو کار می‌کند |
| revision | فقط `save_record` و غیرفعال‌سازی در `delete_record` بالا می‌برند | — | گسترش | instance revision خودش را دارد (قفل خوش‌بینانهٔ انتقال‌ها). تغییر وضعیت در ورود به مرحله revision رکورد را هم بالا می‌برد (در صورت نبود sidecar، با `ensure_directory_record` ساخته می‌شود) تا فرم کهنه 409 بگیرد |
| ارجاع به گروه | `TicketRoleQueueEntry` به `TicketRoutingRule` (FK اجباری) و `Issue` وابسته است | برای گردش‌کار عمومی و مرخصی کافی نیست | ساخت سبک | مرحلهٔ «نقش» فهرست نامزدها (`candidate_ids`) را از `UserOrganizationRole` می‌سازد؛ هر عضو حاضرِ گروه می‌تواند اقدام کند. جدول صف موازی ساخته نشد |
| کانال تماس | lookup `ticket-source` فقط با قالب «پشتیبانی» (`entity_config.py:515`) ساخته می‌شود | ممکن است در workspace نباشد | استفادهٔ مجدد + پیش‌فرض | کانال‌ها از `ticket-source` خوانده می‌شوند؛ اگر نبود، فهرست ثابت تلفن/حضوری/ایمیل |
| celery beat و اعلان | `plane/celery.py` + `CELERY_IMPORTS` + `notify_members` | — | استفادهٔ مجدد | task جدید `workflow_reminders.send_workflow_reminders` هر ۵ دقیقه |
| شرط‌ها | `entity_rules.validate_condition/condition/condition_fields` و `ConditionEditor` | — | استفادهٔ مجدد | بدون زبان شرط جدید |
| مدیر مستقیم/بالادست | منطق درون `management_relation` | تابع اشتراکی نبود | استخراج | `access_control.manager_chains` (تنها پیاده‌سازی)؛ `management_relation` روی آن بازنویسی شد و رفتار `can_manage_absence` یکسان ماند (تست رگرسیون) |
| مهلت | `work_calendar.add_working_time/working_minutes_between` | — | استفادهٔ مجدد | هیچ محاسبهٔ زمانی کپی نشد |
| مجوزها | `permission_registry.py` + migration 0155 | مجوزهای گردش‌کار | ساخت | ۶ مجوز + migration 0157 |
| سابقه | `emit` و `emit_definition` | — | استفادهٔ مجدد | هر اقدام یک `WorkflowDecision` و یک `EntityEvent` روی رکورد دارد |

## ۲. فایل‌ها

**جدید (backend):**
- `apps/api/plane/db/models/workflow.py` — مدل‌ها
- `apps/api/plane/db/migrations/0156_workflow_engine.py`، `0157_workflow_permissions.py`
- `apps/api/plane/app/services/workflow_engine.py` — خواندن و محاسبه
- `apps/api/plane/app/services/workflow_actions.py` — نوشتن
- `apps/api/plane/app/views/workspace/workflow.py`، `apps/api/plane/app/urls/workflow.py`
- `apps/api/plane/bgtasks/workflow_reminders.py`
- `apps/api/plane/tests/contract/app/test_workflow_engine.py`، `apps/api/plane/tests/unit/bg_tasks/test_workflow_reminders_registration.py`

**تغییرِ افزایشی در فایل‌های موجود (backend):**
- `db/models/__init__.py` (export)، `db/models/organization.py` (مقدار `pending`)
- `app/services/access_control.py` (استخراج `manager_chains`)
- `app/services/entity_records.py` (تابع `apply_workflow_status`، قفل فیلد مرحله در `save_record`، شروع خودکار پس از ثبت، و دسترسی فقط‌خواندنی شرکت‌کنندگان گردش‌کار در `get_record`؛ بند ۶)
- `app/services/permission_registry.py`، `app/urls/__init__.py`، `celery.py`، `settings/common.py`

**جدید (frontend):** `apps/web/app/crm/api/workflow.ts`، `apps/web/app/crm/workflow/{model.ts,designer.tsx,panel.tsx,inbox-page.tsx,workflow.test.tsx}`، `apps/web/styles/workflow.css`، `apps/web/tests/browser/crm-workflow-acceptance.mjs`

**تغییرِ چندخطی در فایل‌های موجود (frontend):** `engine/record-form.tsx` (بارگذاری دوبارهٔ فرمِ دست‌نخورده پس از تغییر بیرونی؛ بند ۱۰)، `engine/design-workspace.tsx` (دکمه و تب «گردش‌کار»)، `engine/record-pages.tsx` و `engine/record-drawer.tsx` (پنل + عنوان رویدادها)، `routes.ts`، `layout.tsx` (منوی «منتظر اقدام من»)، `access/permission-map.ts`، `styles/index.css`. `packages/ui` تغییر نکرد.

## ۳. Migrationها و اثر بر دادهٔ موجود
- **0156_workflow_engine**: ۸ جدول جدید `crm_workflow_*` با constraintهای جزئی (یک نسخهٔ published و یک draft برای هر definition؛ یک definition از هر نوع برای هر entity و جدا برای هر subtype؛ یک instance فعال برای هر رکورد؛ یک مرحلهٔ جاری؛ یک توقف باز و یک درخواست تمدید باز برای هر اجرای مرحله) و `AlterField` روی `UserAbsence.status` (فقط choices؛ بدون SQL مؤثر).
- **0157_workflow_permissions**: RunPython مثل 0155؛ فقط `get_or_create`.
- روی dev اجرا شد. شمارش پیش و پس: `EntityRecord=113`، `UserAbsence=0`، `DashboardTeamSettings=1`، `WorkSchedule=1`، `TicketRoutingRule=3` — بدون تغییر.

## ۴. مجوزها
| کد | برچسب | نقش‌ها |
|---|---|---|
| `Workflow.View` | مشاهده گردش‌کار | admin، member |
| `Workflow.Design` | طراحی و ویرایش پیش‌نویس | admin |
| `Workflow.Publish` | انتشار نسخه | admin |
| `Workflow.Reassign` | ارجاع مدیریتی (در scope مدیریتی خود) | admin |
| `Workflow.Migrate` | انتقال فرایند فعال به نسخهٔ دیگر | admin |
| `Workflow.ViewAll` | دیدن همهٔ فرایندها | admin |

توقف/ازسرگیری، گزارش دیرکرد و درخواست تمدید مجوز جدا ندارند و فقط برای مسئولِ مرحله (یا جانشین فعال او) مجازند. تأیید تمدید فقط بر اساس scope (مدیر مستقیم) است.

## ۵. سرویس‌ها
**`workflow_engine` (فقط خواندن):** `validate_graph`، `simulate`، `resolve_assignee`، `managers_of`، `unit_delegate`، `acting_delegate`، `target_for`، `deadline_state`، `needs_reminder` (تابع خالص)، `due_reminder_runs`، `allowed_transitions`، `actor_role`، `can_reassign`، `extension_approver_ok`، `step_field_lock`، `migration_preview`، `instance_payload`، `inbox`، `status_options`، `definition_for`.
**`workflow_actions` (نوشتن، همه `transaction.atomic` + `select_for_update`):** `create_definition`، `update_definition`، `new_draft`، `save_draft`، `publish`، `auto_start`، `start`، `transition`، `reassign`، `pause`، `resume`، `delay_report`، `request_extension`، `decide_extension`، `contact_resolve`، `to_standard`، `migrate`، `send_due_reminders`.
`is_participant` (چه کسی به‌خاطر گردش‌کار اجازهٔ خواندن رکورد را دارد) هم در `workflow_engine` است. `instance_payload` حالا `migration_target` (آخرین نسخهٔ منتشرشده، فقط برای دارندهٔ `Workflow.Migrate`) را هم برمی‌گرداند.
**مصرف‌کننده‌ها:** viewهای `views/workspace/workflow.py`، `entity_records.save_record` (قفل فیلد و شروع خودکار)، task celery.
**work_calendar:** `add_working_time` برای `target_at` و ازسرگیری؛ `working_minutes_between` برای دقیقه‌های باقی‌مانده هنگام توقف و آستانهٔ یادآوری؛ `calendar_zone` برای سریال‌سازی همهٔ زمان‌ها.
**access_control:** `manager_chains` (مدیر مستقیم/بالادست)، `management_relation` (ارجاع مدیریتی، تمدید، دیدن)، `delegation_context` (جانشین مدیر غایب)، `has_permission`.

## ۶. تصمیم‌های طراحی
- **ذخیرهٔ گراف:** JSON اعتبارسنجی‌شده روی `WorkflowVersion.graph`. نسخهٔ منتشرشده یک snapshot تغییرناپذیر است؛ کپی نسخه برای draft جدید ساده است و instance همیشه نسخهٔ کامل خودش را دارد. اجراها (`WorkflowStepRun`، `WorkflowDecision`، …) ردیف نرمال‌اند.
- **تقویمِ مبنای مهلت:** تقویم مسئولِ مرحله (برنامه، استثنا، جمعه و استراحتِ همان فرد). مرحلهٔ گروهی بدون مسئول واحد و مهلت کل فرایند با تقویم شرکت.
- **تغییر مسئول:** `target_at` تغییر نمی‌کند (ارجاع مدیریتی و ارجاع معمولی)؛ فقط تمدید تأییدشده مهلت را جابه‌جا می‌کند. اگر مرحله در خطا بود و مهلتی نداشت، با تقویم مسئول جدید محاسبه می‌شود. آزمون: `test_reassign_requires_permission_scope_and_reason`.
- **جانشین در تأیید تمدید:** مجاز است، فقط برای جانشینِ فعالِ مدیر مستقیم در زمان غیبت او (همان `delegation_context`). مدیر بالادست و خود مسئول 403 می‌گیرند.
- **محل دادهٔ تماس:** در `WorkflowDecision.data["contact"]` و در `EntityEvent.metadata["data"]` همان رکورد (تاریخچهٔ تیکت). رکورد تماس جدا ساخته نشد.
- **نوشتن وضعیت:** `entity_records.apply_workflow_status` همان اعتبارسنجی وضعیت، `full_clean` مرخصی (هم‌پوشانی)، بالا بردن revision و رویداد `record.status_changed` را حفظ می‌کند. مجوزِ این نوشتن خودِ انتقال گردش‌کار است (مثلاً مدیری که مجوز `Absence.Edit` ندارد هم می‌تواند تأیید کند).
- **قفل فیلد:** تا گردش‌کار در جریان است، فیلد وضعیت فقط از مسیر انتقال تغییر می‌کند؛ اگر مرحله `lock_fields` داشته باشد فقط `editable_fields` قابل ویرایش‌اند (در `save_record` سرور).
- **انتقال خودکار:** سقف از `settings.WORKFLOW_MAX_AUTO_STEPS` (پیش‌فرض ۱۰). حلقهٔ `_enter` با همین سقف محدود است؛ در وب و celery یکسان.
- **دیدن رکورد توسط شرکت‌کنندگان گردش‌کار:** کسی که مرحله‌ای از گردش‌کار به او سپرده شده (مستقیم، عضو گروه یا جانشین فعال)، کسی که در آن تصمیمی ثبت کرده، و مدیری که باید درخواست تمدید باز را تأیید کند، رکورد را **فقط می‌خواند**. بدون این، مدیر تأییدکننده صفحهٔ تیکت را نمی‌توانست باز کند. این در `get_record` و فقط برای بارگذاری بدون قفل اعمال می‌شود؛ همهٔ مسیرهای نوشتن (`save_record`، `delete_record`) رکورد را با `lock=True` می‌خوانند و قاعدهٔ دید عادی رکورد را نگه می‌دارند. آزمون: `test_workflow_participants_can_read_but_not_edit_the_record`.
- **پاک‌کردن تنظیمات:** در `PATCH` تعریف، مقدار خالی (`null`، `""` یا `0`) برای `instance_target_minutes`، `status_field` و `subject_field` آن تنظیم را حذف می‌کند.
- **دیرکرد:** گزارش دیرکرد مهلتی را که توضیح می‌دهد ذخیره می‌کند (`target_at`)؛ پس از تمدید، دیرکردِ دوباره گزارش جدید لازم دارد.

## ۷. آمادگی مرخصی
**آماده:** وضعیت `pending`؛ شروع خودکار گردش‌کار هنگام ثبت مرخصی؛ مسیر «درخواست ← مدیر مستقیم ← (شرطی) مدیر بالادست ← تأیید/رد، با بازگشت برای اصلاح» در تست قراردادی؛ تأیید نهایی وضعیت را `scheduled` می‌کند و فقط از آن لحظه در `availability/busy_blocks` «در دسترس نیست» است؛ رد آن را `cancelled` می‌کند (ردیف حذف نمی‌شود).
**تیکت بعد لازم دارد:**
1. اجازهٔ ثبت درخواست برای خودِ کارمند: الان `save_native` مرخصی با `can_manage_absence` فقط مدیر یا `Absence.ManageAll` را می‌پذیرد؛ برای «درخواست» باید مسیر self-service (مثلاً وقتی گردش‌کار منتشرشده‌ای هست، وضعیت اولیه `pending` و ایجاد برای خود فرد) اضافه شود.
2. پیش‌فرض وضعیت در ایجاد: الان ردیف ابتدا `scheduled` ساخته می‌شود و در همان تراکنش با ورود به مرحلهٔ شروع `pending` می‌شود؛ بهتر است adapter در صورت وجود گردش‌کار مستقیم `pending` بسازد (کنترل هم‌پوشانی `clean()` روی `pending` اجرا نمی‌شود).
3. نمایش برچسب فارسی `pending` در فهرست عدم حضور و فیلتر جدول.
4. قواعد خاص مرخصی (مانده، هم‌پوشانی با درخواست‌های pending دیگر، لغو پس از تأیید).

## ۸. کارهایی که عمداً انجام نشد
- تأیید موازی (همه/یکی از چند نفر): طبق تیکت لازم نبود. گروه نقش فقط «هر عضو حاضر گروه می‌تواند اقدام کند» است.
- canvas کشیدنی: فهرست مرتب مرحله‌ها (کارت) و انتقال‌ها + نمای سادهٔ مسیر.
- ورودی رابط برای «فیلد وضعیت موجودیت سفارشی» (`settings.status_field`): از API پشتیبانی می‌شود؛ برای تیکت و مرخصی لازم نیست چون فیلد وضعیتشان ثابت است.

کارهایی که در نسخهٔ اول این گزارش «انجام نشده» بودند و حالا انجام شده‌اند:
- **رابط انتقال رکورد فعال به نسخهٔ دیگر:** دکمهٔ «انتقال به نسخهٔ N» در پنل رکورد (فقط با `Workflow.Migrate` و وقتی نسخهٔ منتشرشدهٔ جدیدتری هست)، پیش‌نمایش اثر (مرحله، مسئول، مهلت، هشدارها)، انتخاب مرحلهٔ مقصد وقتی مرحلهٔ فعلی در نسخهٔ جدید نیست، و دلیل الزامی.
- **ارجاع به گروه در رابط:** فرم ارجاع «یک فرد» یا «یک گروه (نقش)» دارد.
- **بخش «تنظیمات گردش‌کار» در طراح:** فعال/غیرفعال، مهلت کل کار (ساعت و دقیقهٔ کاری)، «فرد رکورد» (ثبت‌کننده یا یک فیلد کاربر)، و بستن با تأیید مدیر برای مسیر کوتاه.
- **دسترسی تأییدکننده به رکورد** (موضوع باز قبلی؛ بند ۶).

## ۹. نتیجهٔ تست‌ها
- **Backend جدید** (`test_workflow_engine.py`، ۳۱ تست + `test_workflow_reminders_registration.py`): همه سبز. در یک اجرای کامل فایل، ۳ تست با `OSError: Out of memory` سیستم‌عامل (حافظهٔ دستگاه، نه کد) و یک بار تست هم‌زمانی شکست خوردند؛ هر ۴ دوباره اجرا و سبز شدند. تست هم‌زمانی حالا هر خطای غیرمنتظرهٔ threadها را در پیام شکست نشان می‌دهد. ۴ تست تازه: انتخاب مرحلهٔ مقصد در انتقال نسخه و `migration_target`، ارجاع به گروه، تنظیم و پاک‌کردن تنظیمات تعریف، و خواندن (نه ویرایش) رکورد توسط شرکت‌کنندگان.
- **کل مجموعهٔ backend و مقایسه با HEAD:** اجرای کامل `plane/tests` روی working tree فعلی: **۱۰۷۷ سبز، ۳۶ قرمز** (۸۵ دقیقه). همین اجرا روی worktree تمیز از HEAD (`c8eeee0`): **۹۲۴ سبز، ۵۹ قرمز**. مقایسهٔ فهرست‌ها:
  - ۳۲ تست روی هر دو قرمزند (شکست‌های موجود، از جمله `test_password_is_separate_hashed_and_audited`).
  - ۲۷ تست روی HEAD قرمز و روی working tree سبزند؛ این‌ها با تغییرات commit‌نشدهٔ دیگرِ working tree درست شده‌اند، نه با این تیکت.
  - ۴ تست فقط در اجرای کامل فعلی قرمز بودند: `test_api_token::test_delete_service_api_token_forbidden`، `test_ticket_seven::test_team_presence_provider_can_be_replaced_without_card_changes` و دو حالت `test_ticket_six::test_uniqueness_normalizes_all_required_forms`. هر ۴ جداگانه اجرا شدند و **سبزند**؛ یعنی وابسته به ترتیب اجرا در مجموعهٔ طولانی‌اند، نه ناشی از کد گردش‌کار (هیچ‌کدام از مسیر گردش‌کار عبور نمی‌کنند).
  - نتیجه: هیچ شکست جدیدی از این تیکت ایجاد نشده است.
- **Frontend:** `check:types` بدون خطا؛ vitest کل web: ۵۶ فایل / ۴۳۰ تست سبز (۱۸ تست در `workflow/workflow.test.tsx`)؛ `check:lint` بدون خطا و زیر سقف هشدار. روی فایل‌های گردش‌کار: ۰ خطا؛ هشدارهای باقی‌مانده `no-await-in-loop` در اسکریپت E2E (گام‌ها عمداً پشت‌سرهم‌اند) و یک `exhaustive-deps` عمدی در طراح.
- **نکتهٔ محیط تست:** `requirements/base.txt` در working tree (تغییر دیگران) `python-docx` را اضافه کرده است. image تست آن را ندارد و دانلودش از pypi روی این شبکه یا timeout می‌شود یا hash مطابق ندارد؛ برای اجرای آخر، entrypoint تست بدون `pip install` اجرا شد (کد گردش‌کار به `docx` وابسته نیست).
- **ruff** روی فایل‌های Python گردش‌کار: بدون خطا.
- **E2E** (`apps/web/tests/browser/crm-workflow-acceptance.mjs`، اجرا از ریشهٔ repo): هر **۱۲ گام سبز**؛ اسکرین‌شات‌ها و `report.json` در `tmp/workflow-evidence/`:
  1–۳. مدیر در طراح **با کلیک** مرحلهٔ تأیید اضافه می‌کند، «بررسی مشکلات» خطای فارسی را کنار همان مرحله نشان می‌دهد، دکمه‌ها با فهرست‌های انتخابی وصل می‌شوند، «امتحان مسیر» و «انتشار برای همه» انجام و نسخه فقط‌خواندنی می‌شود (گراف منتشرشده هم با API بررسی می‌شود).
  4. توقف «در انتظار پاسخ مشتری» در سابقه.
  5. تمدید با تأیید مدیر مستقیم؛ مهلت قبلی در سابقه.
  6–۷. بازگشت با دلیل، ارسال دوباره و تأیید.
  8. رد با دلیل.
  9–۱۰. حل در تماس اول و انتقال به مسیر عادی.
  11. انتشار نسخهٔ جدید مسیر رکورد فعال را عوض نمی‌کند.
  12. انتقال همان رکورد به نسخهٔ جدید از پنل، پس از پیش‌نمایش و با دلیل.
- **محدودیت:** سرور live در زمان جابه‌جا نمی‌شود؛ دیرکرد و یادآوری با `now` کنترل‌شده در تست‌های سرویس پوشش داده شده‌اند. گام‌های ۱–۳ در رابط ساخته می‌شوند؛ گراف‌های غنی‌تر گام‌های بعد از طریق همان API صفحهٔ طراح آماده می‌شوند. اسکریپت تعریف‌ها را در پایان غیرفعال می‌کند؛ بعد از اجرای آن روی dev، گردش‌کار آموزشی دوباره منتشر و فعال شد.

## ۱۰. خطاهایی که در اجرای واقعی (مرورگر) پیدا و رفع شد
1. **همهٔ اقدام‌های گردش‌کار 401 می‌گرفتند و کاربر به صفحهٔ خانه برمی‌گشت.** `SessionMiddleware` پلین برای هر مسیری که کلمهٔ `instances` دارد کوکی session مدیر سامانه (god-mode) را می‌خواند. مسیرها از `/workflows/instances/...` به `/workflows/runs/...` تغییر کرد و تست `test_actions_work_with_a_real_session_cookie` با session واقعی (نه `force_authenticate`) اضافه شد. تست‌های قبلی این را نمی‌دیدند چون لایهٔ session را دور می‌زدند.
2. **صفحهٔ رکورد پس از اقدام گردش‌کار تازه نمی‌شد** (کلید React Query اشتباه: `engine` به‌جای `entity-engine`).
3. **فرم رکورد مقدار کهنه نگه می‌داشت و «ویرایش‌شده» به نظر می‌رسید.** فرم حالا با مقادیر لحظهٔ بارگذاری مقایسه می‌کند و اگر ویرایش ذخیره‌نشده نداشته باشد، پس از تغییر revision خودش را دوباره بارگذاری می‌کند.
4. **طراح به‌جای مسیر عادی، مسیر کوتاه را باز می‌کرد** (مرتب‌سازی عنوان فارسی). حالا تعریف‌های فعال و مسیر عادی اول می‌آیند.
5. **مدیر تأییدکننده صفحهٔ تیکت را نمی‌توانست باز کند** («این رکورد پیدا نشد یا اجازهٔ دیدن آن را ندارید»). حالا شرکت‌کنندگان گردش‌کار رکورد را فقط می‌خوانند (بند ۶). دسترسی بعد از تصمیم هم می‌ماند؛ در اجرای اول، مدیر پس از تأیید تمدید دسترسی‌اش را از دست می‌داد.
6. **اسکریپت E2E با نام دکمه‌های قدیمی طراح نوشته شده بود** و با طراح فعلی جور نبود؛ بازنویسی شد. ورود و باز کردن رکورد حالا در برابر reload اولیهٔ Vite دوباره تلاش می‌کنند.

## ۱۱. موضوع باز
موردی باقی نمانده است. دسترسی فقط‌خواندنی شرکت‌کنندگان (موضوع باز نسخهٔ قبلی) پیاده و آزموده شد؛ اگر سیاست دیگری می‌خواهید (مثلاً فقط مسئولِ مرحلهٔ جاری)، فقط `workflow_engine.is_participant` تغییر می‌کند.
