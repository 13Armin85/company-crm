"""Stored dashboard layouts, role inheritance and widget registry metadata."""

from copy import deepcopy
from uuid import uuid4

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import DashboardConfiguration, OrganizationRole
from .access_control import has_permission
from .entity_records import emit_definition
from .entity_schema import role_ids


WIDGETS = {
    "counter": "شمارنده",
    "table": "جدول",
    "my-work": "فهرست کارهای من",
    "chart": "نمودار",
    "progress": "نوار پیشرفت",
    "calendar": "تقویم کوچک",
    "activity": "فعالیت‌های اخیر",
    "links": "پیوندهای سریع",
    "note": "یادداشت شخصی",
    "absences": "غایبین و مرخصی‌های امروز",
    "approvals": "درخواست‌های منتظر تأیید من",
    "workload": "نقشه بار کاری",
    "age": "سن رکوردها",
    "unassigned": "رکوردهای بدون مسئول",
    "team-cards": "کارت‌های تیم",
}


def validate_tabs(tabs, *, allow_locked=False):
    if not isinstance(tabs, list) or len(tabs) > 30:
        raise ValidationError("حداکثر ۳۰ تب داشبورد مجاز است.")
    seen_tabs, seen_widgets = set(), set()
    for tab in tabs:
        if not isinstance(tab, dict) or not isinstance(tab.get("id"), str) or not isinstance(tab.get("title"), str):
            raise ValidationError("تعریف تب معتبر نیست.")
        if not 1 <= len(tab["title"].strip()) <= 80 or tab["id"] in seen_tabs:
            raise ValidationError("نام یا شناسه تب تکراری یا نامعتبر است.")
        seen_tabs.add(tab["id"])
        widgets = tab.get("widgets", [])
        if not isinstance(widgets, list) or len(widgets) > 50:
            raise ValidationError("حداکثر ۵۰ ویجت در هر تب مجاز است.")
        for widget in widgets:
            if not isinstance(widget, dict) or widget.get("type") not in WIDGETS:
                raise ValidationError("نوع ویجت معتبر نیست.")
            wid = widget.get("id")
            if not isinstance(wid, str) or wid in seen_widgets:
                raise ValidationError("شناسه ویجت تکراری یا نامعتبر است.")
            seen_widgets.add(wid)
            if not isinstance(widget.get("config", {}), dict):
                raise ValidationError("تنظیمات ویجت معتبر نیست.")
            for key, minimum, maximum in (("x", 0, 11), ("y", 0, 999), ("w", 1, 12), ("h", 1, 8)):
                value = widget.get(key, 0 if key in {"x", "y"} else 1)
                if not isinstance(value, int) or not minimum <= value <= maximum:
                    raise ValidationError("جایگاه یا اندازه ویجت معتبر نیست.")
            if widget.get("x", 0) + widget.get("w", 1) > 12:
                raise ValidationError("ویجت از عرض شبکه بیرون می‌رود.")
            if widget.get("locked") and not allow_locked:
                raise ValidationError("فقط ادمین می‌تواند ویجت قفل‌شده تعریف کند.")
    return deepcopy(tabs)


def selected_role(workspace, user):
    ids = role_ids(user, workspace)
    return OrganizationRole.objects.filter(workspace=workspace, id__in=ids, is_active=True).order_by("system_key", "id").first()


def default_layout(workspace, user):
    role = selected_role(workspace, user)
    if role:
        config = DashboardConfiguration.objects.filter(workspace=workspace, role=role).first()
        if config:
            return config
    return None


def make_tab(title="کارهای من"):
    return {"id": str(uuid4()), "title": title, "widgets": []}


def starter_widgets():
    """Server-owned widgets for a personal dashboard without role defaults."""
    definitions = (
        ("counter", "تعداد کارها", 0, 0, 3, 3, {"entity": "ticket", "operation": "count"}),
        ("my-work", "کارهای من", 3, 0, 9, 3, {"entity": "ticket", "rows": 8}),
        ("table", "آخرین کارها", 0, 3, 12, 4, {"entity": "ticket", "rows": 8}),
        ("chart", "کارها بر اساس اولویت", 0, 7, 6, 4, {"entity": "ticket", "group_by": "priority", "chart": "bar"}),
        ("calendar", "تقویم کارها", 6, 7, 6, 4, {"entity": "ticket", "date_field": "due_date", "calendar_view": "month"}),
    )
    return [
        {"id": str(uuid4()), "type": kind, "title": title, "x": x, "y": y, "w": width, "h": height, "config": config}
        for kind, title, x, y, width, height, config in definitions
    ]


def make_widget(kind, existing):
    if kind not in WIDGETS:
        raise ValidationError("نوع ویجت معتبر نیست.")
    return {
        "id": str(uuid4()),
        "type": kind,
        "title": WIDGETS[kind],
        "x": 0,
        "y": max([widget.get("y", 0) + widget.get("h", 1) for widget in existing] or [0]),
        "w": 12 if kind in {"team-cards", "table"} else 6,
        "h": 5 if kind == "team-cards" else 3,
        "config": {
            "entity": "leave" if kind == "absences" else "ticket",
            "operation": "count",
            "chart": "bar",
            "group_by": "priority",
            **({"date_field": "due_date", "calendar_view": "month"} if kind == "calendar" else {}),
            "rows": 8,
            "refresh_seconds": 0,
        },
    }


def _copy_defaults(default):
    tabs = deepcopy(default.tabs if default else [make_tab()])
    if not default:
        tabs[0]["widgets"] = starter_widgets()
    for tab in tabs:
        for widget in tab.get("widgets", []):
            if default:
                widget["origin"] = widget["id"]
    return tabs


def _initial_tabs(workspace, user, default):
    tabs = _copy_defaults(default)
    if has_permission(user, workspace, "Dashboard.Team.View") and not any(
        widget.get("type") == "team-cards" for tab in tabs for widget in tab.get("widgets", [])
    ):
        tabs.append({"id": str(uuid4()), "title": "تیم من", "widgets": [
            {"id": str(uuid4()), "type": "team-cards", "title": "وضعیت تیم", "x": 0, "y": 0, "w": 12, "h": 5, "config": {"entity": "ticket", "refresh_seconds": 45}}
        ]})
    return tabs


@transaction.atomic
def personal_layout(workspace, user):
    default = default_layout(workspace, user)
    config, created = DashboardConfiguration.objects.select_for_update().get_or_create(
        workspace=workspace, user=user,
        defaults={"tabs": _initial_tabs(workspace, user, default), "inherited_revision": default.revision if default else 0},
    )
    added = False
    if not created and not default and config.revision == 1 and config.inherited_revision == 0:
        tabs = deepcopy(config.tabs)
        if (
            tabs and tabs[0].get("title") == "کارهای من" and not tabs[0].get("widgets")
            and (len(tabs) == 1 or (
                len(tabs) == 2 and tabs[1].get("title") == "تیم من"
                and len(tabs[1].get("widgets", [])) == 1
                and tabs[1]["widgets"][0].get("type") == "team-cards"
            ))
        ):
            tabs[0]["widgets"] = starter_widgets()
            config.tabs = tabs
            config.revision += 1
            config.save(update_fields=["tabs", "revision"])
            added = True
    if default and config.inherited_revision < default.revision:
        tabs = deepcopy(config.tabs)
        existing = {w.get("origin", w["id"]) for t in tabs for w in t.get("widgets", [])}
        if not tabs:
            tabs = [make_tab()]
        for tab in default.tabs:
            target = next((t for t in tabs if t["id"] == tab["id"]), None)
            if target is None:
                target = {"id": tab["id"], "title": tab["title"], "widgets": []}
                tabs.append(target)
                added = True
            for widget in tab.get("widgets", []):
                if widget["id"] not in existing:
                    new_widget = deepcopy(widget)
                    new_widget["origin"] = widget["id"]
                    new_widget["y"] = max([w.get("y", 0) + w.get("h", 1) for w in target.get("widgets", [])] or [0])
                    target.setdefault("widgets", []).append(new_widget)
                    added = True
        config.tabs = tabs
        config.inherited_revision = default.revision
        config.revision += 1
        config.save(update_fields=["tabs", "inherited_revision", "revision"])
    return config, added


def shared_tabs(workspace, user):
    roles = role_ids(user, workspace)
    result = []
    for config in DashboardConfiguration.objects.filter(workspace=workspace, user__isnull=False).exclude(user=user):
        for tab in config.tabs:
            share = tab.get("share", {})
            if str(user.id) in share.get("users", []) or roles.intersection(share.get("roles", [])):
                result.append({"id": tab["id"], "title": tab["title"], "widgets": tab.get("widgets", []), "mode": share.get("mode", "read"), "owner": str(config.user_id)})
    return result


@transaction.atomic
def save_layout(workspace, user, tabs, revision, *, role=None, request=None):
    if role:
        if not has_permission(user, workspace, "Dashboard.Default.Manage", request=request):
            raise PermissionDenied()
        target = DashboardConfiguration.objects.select_for_update().filter(workspace=workspace, role=role).first()
    else:
        if not has_permission(user, workspace, "Dashboard.Personal.Manage", request=request):
            raise PermissionDenied()
        target, _ = personal_layout(workspace, user)
        target = DashboardConfiguration.objects.select_for_update().get(pk=target.pk)
    if target and revision != target.revision:
        raise ValidationError("داشبورد در دستگاه دیگری تغییر کرده است؛ دوباره بارگذاری کنید.")
    clean = validate_tabs(tabs, allow_locked=True)
    if not role:
        defaults = default_layout(workspace, user)
        required = {w["id"] for tab in (defaults.tabs if defaults else []) for w in tab.get("widgets", []) if w.get("locked")}
        retained = {w["id"] for tab in clean for w in tab.get("widgets", [])}
        if not required.issubset(retained):
            raise ValidationError("ویجت قفل‌شدهٔ داشبورد پیش‌فرض را نمی‌توان حذف کرد.")
        old = {w["id"]: w for tab in target.tabs for w in tab.get("widgets", [])}
        for tab in clean:
            if tab.get("share") and not has_permission(user, workspace, "Dashboard.Share", request=request):
                raise PermissionDenied()
            for widget in tab.get("widgets", []):
                previous = old.get(widget["id"])
                if widget.get("locked") and not (previous and previous.get("locked")):
                    raise ValidationError("کاربر نمی‌تواند ویجت جدید را قفل کند.")
                if previous and previous.get("locked") and widget.get("origin", widget["id"]) == previous.get("origin", previous["id"]):
                    widget["locked"] = True
    before = deepcopy(target.tabs) if target else []
    if target:
        target.tabs, target.revision = clean, target.revision + 1
        target.save(update_fields=["tabs", "revision"])
    else:
        target = DashboardConfiguration.objects.create(workspace=workspace, role=role, tabs=clean)
    if role:
        emit_definition(workspace, user, "dashboard.default_changed", target, before, clean)
    return target


@transaction.atomic
def add_widget(workspace, user, kind, tab_id, tabs, revision, *, role=None, request=None):
    permission = "Dashboard.Default.Manage" if role else "Dashboard.Personal.Manage"
    if not has_permission(user, workspace, permission, request=request):
        raise PermissionDenied()
    if kind not in WIDGETS:
        raise ValidationError("نوع ویجت معتبر نیست.")
    if kind == "team-cards" and not has_permission(user, workspace, "Dashboard.Team.View", request=request):
        raise PermissionDenied()
    current = (
        DashboardConfiguration.objects.filter(workspace=workspace, role=role).first()
        if role else personal_layout(workspace, user)[0]
    )
    if revision != (current.revision if current else 0):
        raise ValidationError("داشبورد در دستگاه دیگری تغییر کرده است؛ دوباره بارگذاری کنید.")
    clean = validate_tabs(tabs if tabs is not None else (current.tabs if current else []), allow_locked=True)
    if not clean:
        clean = [make_tab("پیش‌فرض" if role else "کارهای من")]
    tab = next((item for item in clean if item["id"] == tab_id), None) if tab_id else clean[0]
    if tab is None:
        raise ValidationError("تب انتخاب‌شده پیدا نشد؛ داشبورد را دوباره بارگذاری کنید.")
    widgets = tab.setdefault("widgets", [])
    if len(widgets) >= 50:
        raise ValidationError("حداکثر ۵۰ ویجت در هر تب مجاز است.")
    widget = make_widget(kind, widgets)
    widgets.append(widget)
    saved = save_layout(workspace, user, clean, revision, role=role, request=request)
    return saved, widget, tab
