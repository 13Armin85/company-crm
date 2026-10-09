import type { OrganizationPermission } from "../types";

const categories: Record<string, string> = {
  User: "کاربران",
  Role: "نقش‌ها",
  Permission: "فهرست مجوزها",
  OrganizationUnit: "ساختار سازمانی",
  Access: "دسترسی کاربران",
  Absence: "عدم حضور",
  Referral: "ارجاع",
  Project: "پروژه‌ها",
  Issue: "کارها",
  Routing: "مسیریابی",
  Workspace: "شرکت",
};
const actions: Record<string, string> = {
  View: "مشاهده",
  ViewAll: "مشاهده همه",
  Create: "ایجاد",
  Edit: "ویرایش",
  Delete: "حذف",
  Disable: "غیرفعال کردن",
  ChangePassword: "تغییر رمز عبور",
  "Role.Assign": "تخصیص نقش",
  "Permission.Assign": "تخصیص مجوز",
  "Member.Manage": "مدیریت اعضا",
  "Manager.Assign": "تعیین مدیر",
  "Delegate.Manage": "مدیریت جانشینان",
  "UserException.View": "مشاهده استثناها",
  "UserException.Manage": "مدیریت استثناها",
  "EffectivePermission.View": "مشاهده دسترسی مؤثر",
  End: "پایان",
  ManageAll: "مدیریت همه",
  Approve: "تأیید",
  "External.Send": "ارسال بیرونی",
  "Status.Edit": "تغییر وضعیت",
  Assign: "انتقال",
  Manage: "مدیریت",
  Route: "ارجاع",
  "Queue.View": "مشاهده صف",
  "Queue.ViewAll": "مشاهده همه صف‌ها",
  "Queue.Claim": "دریافت از صف",
};
const persianText = (value: string) => value.trim().length > 0 && !/[a-z]/i.test(value);

export function permissionPresentation(permission: OrganizationPermission) {
  const category =
    categories[permission.category] ?? (persianText(permission.category) ? permission.category : "سایر مجوزها");
  const action = actions[permission.code.split(".").slice(1).join(".")];
  return {
    ...permission,
    category,
    name: persianText(permission.name) ? permission.name : action ? action + " " + category : "مجوز اختصاصی",
    description: persianText(permission.description)
      ? permission.description
      : action
        ? "امکان " + action + " در بخش " + category
        : "دسترسی اختصاصی تعریف‌شده برای این بخش.",
  };
}
