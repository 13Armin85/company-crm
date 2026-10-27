import type { OrganizationPermission } from "../types";

const categories: Record<string, string> = {
  EntityType: "موجودیت‌ها",
  Lookup: "لیست‌های پایه",
  Field: "کتابخانه فیلدها",
  FormLayout: "فرم‌ساز",
  FormDesigner: "فرم‌ساز",
  UniqueRule: "قواعد یکتایی",
  NumberingRule: "شماره‌گذاری خودکار",
  Relation: "ارتباط بین موجودیت‌ها",
  Config: "پیکربندی موتور",
  View: "نماها",
  ConditionalFormat: "رنگ‌بندی شرطی",
  Export: "خروجی داده",
  User: "کاربران / اعضای تیم",
  Role: "نقش‌ها",
  Permission: "فهرست مجوزها",
  OrganizationUnit: "ساختار سازمانی",
  Access: "دسترسی کاربران",
  Absence: "عدم حضور",
  Referral: "ارجاع",
  Project: "پروژه‌ها",
  Issue: "کارها",
  Dashboard: "داشبورد",
  Routing: "مسیریابی",
  Workspace: "شرکت",
};
const actions: Record<string, string> = {
  "Personal.Create": "ساخت جدول شخصی",
  "Personal.Share": "اشتراک‌گذاری جدول شخصی",
  "Official.Manage": "مدیریت جدول رسمی",
  "Create.Personal": "ساخت نمای شخصی",
  "Create.Shared": "ساخت نمای اشتراکی",
  "Manage.All": "مدیریت همه نماها",
  Data: "خروجی داده",
  Publish: "انتشار",
  Export: "خروجی پیکربندی",
  Import: "ورود پیکربندی",
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
