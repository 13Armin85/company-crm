# CRM Permission Catalog

Generated from the developer-owned registry. Technical codes are stable and workspace-scoped; administrator APIs only read this catalog.

| Code                               | Category         | Name                               | Description                                   | Delegatable |
| ---------------------------------- | ---------------- | ---------------------------------- | --------------------------------------------- | ----------- |
| `Absence.Create`                   | Absence          | عدم حضور: ایجاد                    | مجوز ایجاد در بخش عدم حضور                    | yes         |
| `Absence.Edit`                     | Absence          | عدم حضور: ویرایش                   | مجوز ویرایش در بخش عدم حضور                   | yes         |
| `Absence.End`                      | Absence          | عدم حضور: پایان                    | مجوز پایان در بخش عدم حضور                    | yes         |
| `Absence.ManageAll`                | Absence          | عدم حضور: مدیریت همه               | مجوز مدیریت همه در بخش عدم حضور               | no          |
| `Absence.View`                     | Absence          | عدم حضور: مشاهده                   | مجوز مشاهده در بخش عدم حضور                   | yes         |
| `Access.EffectivePermission.View`  | Access           | دسترسی کاربران: مشاهده دسترسی مؤثر | مجوز مشاهده دسترسی مؤثر در بخش دسترسی کاربران | no          |
| `Access.UserException.Manage`      | Access           | دسترسی کاربران: مدیریت استثناها    | مجوز مدیریت استثناها در بخش دسترسی کاربران    | no          |
| `Access.UserException.View`        | Access           | دسترسی کاربران: مشاهده استثناها    | مجوز مشاهده استثناها در بخش دسترسی کاربران    | no          |
| `Issue.Assign`                     | Issue            | کارها: انتقال                      | مجوز انتقال در بخش کارها                      | yes         |
| `Issue.Create`                     | Issue            | کارها: ایجاد                       | مجوز ایجاد در بخش کارها                       | yes         |
| `Issue.Delete`                     | Issue            | کارها: حذف                         | مجوز حذف در بخش کارها                         | no          |
| `Issue.Edit`                       | Issue            | کارها: ویرایش                      | مجوز ویرایش در بخش کارها                      | yes         |
| `Issue.Status.Edit`                | Issue            | کارها: تغییر وضعیت                 | مجوز تغییر وضعیت در بخش کارها                 | yes         |
| `Issue.View`                       | Issue            | کارها: مشاهده                      | مجوز مشاهده در بخش کارها                      | yes         |
| `Issue.ViewAll`                    | Issue            | کارها: مشاهده همه                  | مجوز مشاهده همه در بخش کارها                  | no          |
| `OrganizationUnit.Create`          | OrganizationUnit | ساختار سازمانی: ایجاد              | مجوز ایجاد در بخش ساختار سازمانی              | no          |
| `OrganizationUnit.Delegate.Manage` | OrganizationUnit | ساختار سازمانی: مدیریت جانشینان    | مجوز مدیریت جانشینان در بخش ساختار سازمانی    | no          |
| `OrganizationUnit.Disable`         | OrganizationUnit | ساختار سازمانی: غیرفعال کردن       | مجوز غیرفعال کردن در بخش ساختار سازمانی       | no          |
| `OrganizationUnit.Edit`            | OrganizationUnit | ساختار سازمانی: ویرایش             | مجوز ویرایش در بخش ساختار سازمانی             | no          |
| `OrganizationUnit.Manager.Assign`  | OrganizationUnit | ساختار سازمانی: تعیین مدیر         | مجوز تعیین مدیر در بخش ساختار سازمانی         | no          |
| `OrganizationUnit.Member.Manage`   | OrganizationUnit | ساختار سازمانی: مدیریت اعضا        | مجوز مدیریت اعضا در بخش ساختار سازمانی        | no          |
| `OrganizationUnit.View`            | OrganizationUnit | ساختار سازمانی: مشاهده             | مجوز مشاهده در بخش ساختار سازمانی             | yes         |
| `Permission.View`                  | Permission       | فهرست مجوزها: مشاهده               | مجوز مشاهده در بخش فهرست مجوزها               | no          |
| `Project.Create`                   | Project          | پروژه‌ها: ایجاد                    | مجوز ایجاد در بخش پروژه‌ها                    | no          |
| `Project.Delete`                   | Project          | پروژه‌ها: حذف                      | مجوز حذف در بخش پروژه‌ها                      | no          |
| `Project.Edit`                     | Project          | پروژه‌ها: ویرایش                   | مجوز ویرایش در بخش پروژه‌ها                   | no          |
| `Project.Member.Manage`            | Project          | پروژه‌ها: مدیریت اعضا              | مجوز مدیریت اعضا در بخش پروژه‌ها              | no          |
| `Project.View`                     | Project          | پروژه‌ها: مشاهده                   | مجوز مشاهده در بخش پروژه‌ها                   | yes         |
| `Project.ViewAll`                  | Project          | پروژه‌ها: مشاهده همه               | مجوز مشاهده همه در بخش پروژه‌ها               | no          |
| `Referral.Approve`                 | Referral         | ارجاع: تأیید                       | مجوز تأیید در بخش ارجاع                       | yes         |
| `Referral.Create`                  | Referral         | ارجاع: ایجاد                       | مجوز ایجاد در بخش ارجاع                       | yes         |
| `Referral.Delete`                  | Referral         | ارجاع: حذف                         | مجوز حذف در بخش ارجاع                         | yes         |
| `Referral.External.Send`           | Referral         | ارجاع: ارسال بیرونی                | مجوز ارسال بیرونی در بخش ارجاع                | yes         |
| `Referral.View`                    | Referral         | ارجاع: مشاهده                      | مجوز مشاهده در بخش ارجاع                      | yes         |
| `Role.Create`                      | Role             | نقش‌ها: ایجاد                      | مجوز ایجاد در بخش نقش‌ها                      | no          |
| `Role.Disable`                     | Role             | نقش‌ها: غیرفعال کردن               | مجوز غیرفعال کردن در بخش نقش‌ها               | no          |
| `Role.Edit`                        | Role             | نقش‌ها: ویرایش                     | مجوز ویرایش در بخش نقش‌ها                     | no          |
| `Role.Permission.Assign`           | Role             | نقش‌ها: تخصیص مجوز                 | مجوز تخصیص مجوز در بخش نقش‌ها                 | no          |
| `Role.View`                        | Role             | نقش‌ها: مشاهده                     | مجوز مشاهده در بخش نقش‌ها                     | no          |
| `Routing.Manage`                   | Routing          | مسیریابی: مدیریت                   | مجوز مدیریت در بخش مسیریابی                   | no          |
| `Routing.Queue.Claim`              | Routing          | مسیریابی: دریافت از صف             | مجوز دریافت از صف در بخش مسیریابی             | yes         |
| `Routing.Queue.View`               | Routing          | مسیریابی: مشاهده صف                | مجوز مشاهده صف در بخش مسیریابی                | yes         |
| `Routing.Queue.ViewAll`            | Routing          | مسیریابی: مشاهده همه صف‌ها         | مجوز مشاهده همه صف‌ها در بخش مسیریابی         | no          |
| `Routing.Route`                    | Routing          | مسیریابی: ارجاع                    | مجوز ارجاع در بخش مسیریابی                    | yes         |
| `Routing.View`                     | Routing          | مسیریابی: مشاهده                   | مجوز مشاهده در بخش مسیریابی                   | yes         |
| `User.ChangePassword`              | User             | کاربران: تغییر رمز عبور            | مجوز تغییر رمز عبور در بخش کاربران            | no          |
| `User.Create`                      | User             | کاربران: ایجاد                     | مجوز ایجاد در بخش کاربران                     | no          |
| `User.Delete`                      | User             | کاربران: حذف                       | مجوز حذف در بخش کاربران                       | no          |
| `User.Edit`                        | User             | کاربران: ویرایش                    | مجوز ویرایش در بخش کاربران                    | no          |
| `User.Role.Assign`                 | User             | کاربران: تخصیص نقش                 | مجوز تخصیص نقش در بخش کاربران                 | no          |
| `User.View`                        | User             | کاربران: مشاهده                    | مجوز مشاهده در بخش کاربران                    | yes         |
| `Workspace.Edit`                   | Workspace        | شرکت: ویرایش                       | مجوز ویرایش در بخش شرکت                       | no          |

Default member grants: `Issue.Assign`, `Issue.Status.Edit`, `Issue.View`, `Project.View`, `Referral.View`, `Routing.Queue.Claim`, `Routing.Queue.View`.

The system admin role is initialized with the catalog. Subsequent synchronization preserves intentional role grant changes. Unknown historical codes are retained as inactive records and grant no access.

Add technical codes in the registry, provide a migration for existing workspaces and update API checks/tests. Run `python manage.py sync_crm_permissions` using the normal deployment process.
