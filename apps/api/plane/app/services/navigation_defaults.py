"""Initial database navigation document; frontend labels come from the stored document."""

import json

DEFAULT_NAVIGATION = json.loads(r"""
{
  "categories": [
    {
      "id": "home",
      "label": "میز کار",
      "title": "میز کار من",
      "icon": "Home",
      "items": [
        {
          "code": "dashboard",
          "path": "/",
          "label": "داشبورد",
          "icon": "Home",
          "end": true
        },
        {
          "code": "inbox",
          "path": "/inbox",
          "label": "صندوق ورودی",
          "icon": "Inbox",
          "end": false
        },
        {
          "code": "my-work",
          "path": "/my-work",
          "label": "کارهای من",
          "icon": "ListTodo",
          "end": false
        },
        {
          "code": "daily-report",
          "path": "/daily-report",
          "label": "گزارش روزانه",
          "icon": "ClipboardList",
          "end": true
        },
        {
          "code": "workflow-inbox",
          "path": "/workflow-inbox",
          "label": "منتظر اقدام من",
          "icon": "Workflow",
          "end": false
        },
        {
          "code": "leave-requests",
          "path": "/leave-requests",
          "label": "درخواست مرخصی",
          "icon": "CalendarOff",
          "end": false
        },
        {
          "code": "calendar",
          "path": "/calendar",
          "label": "تقویم",
          "icon": "CalendarDays",
          "end": false
        }
      ]
    },
    {
      "id": "work",
      "label": "کارها",
      "title": "کارها و پروژه‌ها",
      "icon": "CheckSquare2",
      "items": [
        {
          "code": "issues",
          "path": "/issues",
          "label": "همه کارها",
          "icon": "CheckSquare2",
          "end": false
        },
        {
          "code": "projects",
          "path": "/projects",
          "label": "پروژه‌ها",
          "icon": "FolderKanban",
          "end": false
        }
      ]
    },
    {
      "id": "reports",
      "label": "گزارش‌ها",
      "title": "گزارش‌ها",
      "icon": "FileBarChart",
      "items": [
        {
          "code": "reports",
          "path": "/reports",
          "label": "گزارش‌ها",
          "icon": "FileBarChart",
          "end": false
        },
        {
          "code": "daily-report-team",
          "path": "/daily-report/team",
          "label": "گزارش روزانهٔ تیم",
          "icon": "Users",
          "end": false
        },
        {
          "code": "support-activities",
          "path": "/support-activities",
          "label": "فعالیت و زمان پشتیبانی",
          "icon": "Clock3",
          "end": false
        }
      ]
    },
    {
      "id": "data",
      "label": "داده‌ها",
      "title": "داده‌ها و فرم‌ها",
      "icon": "Database",
      "items": [
        {
          "code": "entities",
          "path": "/entities",
          "label": "همه صفحه‌ها",
          "icon": "LayoutGrid",
          "end": true
        }
      ]
    },
    {
      "id": "org",
      "label": "سازمان",
      "title": "سازمان و تیم",
      "icon": "Building2",
      "items": [
        {
          "code": "team",
          "path": "/team",
          "label": "اعضای تیم",
          "icon": "Users",
          "end": false
        },
        {
          "code": "organization",
          "path": "/organization",
          "label": "ساختار سازمانی",
          "icon": "Building2",
          "end": false
        },
        {
          "code": "roles",
          "path": "/roles",
          "label": "نقش‌های سازمانی",
          "icon": "ShieldCheck",
          "end": false
        },
        {
          "code": "routing",
          "path": "/routing",
          "label": "ارجاع هوشمند",
          "icon": "GitBranch",
          "end": false
        },
        {
          "code": "absences",
          "path": "/absences",
          "label": "عدم حضور",
          "icon": "UserX",
          "end": false
        },
        {
          "code": "leave-templates",
          "path": "/leave-templates",
          "label": "قالب فرم مرخصی",
          "icon": "FileText",
          "end": false
        },
        {
          "code": "signatures",
          "path": "/signatures",
          "label": "تصویر امضای کاربران",
          "icon": "PenLine",
          "end": false
        }
      ]
    },
    {
      "id": "settings",
      "label": "تنظیمات",
      "title": "تنظیمات",
      "icon": "Settings",
      "items": [
        {
          "code": "settings",
          "path": "/settings",
          "label": "تنظیمات حساب و شرکت",
          "icon": "Settings",
          "end": true
        },
        {
          "code": "settings-engine",
          "path": "/settings/engine",
          "label": "طراحی فرم‌ها و جدول‌ها",
          "icon": "SlidersHorizontal",
          "end": false
        },
        {
          "code": "portal-settings",
          "path": "/portal-settings",
          "label": "درگاه مشتری",
          "icon": "Globe",
          "end": false
        },
        {
          "code": "help",
          "path": "/help",
          "label": "راهنما و پشتیبانی",
          "icon": "CircleHelp",
          "end": false
        }
      ]
    }
  ],
  "design_tabs": [
    {
      "id": "fields",
      "label": "همه ورودی‌ها",
      "hint": "ویرایش تعریف ورودی‌های موجود"
    },
    {
      "id": "layout",
      "label": "طراحی فرم",
      "hint": "ورودی‌ها را پیدا کنید، به فرم بیفزایید و ترتیبشان را تغییر دهید"
    },
    {
      "id": "preview",
      "label": "پیش‌نمایش فرم",
      "hint": "فرم ثبت و ویرایش را امتحان کنید"
    },
    {
      "id": "versions",
      "label": "نسخه‌های قبلی",
      "hint": "بازگشت به چیدمان‌های قبلی"
    },
    {
      "id": "table",
      "label": "طراحی جدول",
      "hint": "ستون‌ها و نمای رسمی جدول"
    },
    {
      "id": "rules",
      "label": "قواعد ثبت",
      "hint": "جلوگیری از تکرار و شماره‌گذاری خودکار"
    },
    {
      "id": "relations",
      "label": "ارتباط‌ها",
      "hint": "اتصال به بخش‌های دیگر"
    },
    {
      "id": "workflow",
      "label": "گردش‌کار",
      "hint": "مرحله‌ها، تأییدها و مهلت‌های فرایند"
    }
  ],
  "page_categories": {},
  "all_design_title": "همه دسته‌ها"
}
""")
