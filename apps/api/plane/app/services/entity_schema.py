"""Field library, bindings and published form schemas. No record values live here."""

from copy import deepcopy
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    EntityType,
    FieldDefinition,
    FormLayout,
    FormVersion,
    LookupCategory,
    LookupValue,
    UserOrganizationRole,
    OrganizationRole,
)
from .entity_rules import (
    FIELD_KINDS,
    validate_condition,
    validate_regex,
    formula_fields,
    condition,
    condition_fields,
    normalize,
)

schema_request_cache = ContextVar("entity_schema_request_cache", default=None)


SOURCE_FIELDS = {
    "ticket": {"name", "description_html", "target_date", "priority", "state_id", "project_id", "assignee_ids"},
    "task": {"name", "target_date", "priority", "status", "assignee_id"},
    "project": {"name", "description", "target_date", "project_lead_id"},
    "leave": {"reason", "user_id", "starts_at", "ends_at", "status"},
}
SOURCE_KINDS = {
    "name": {"short_text"},
    "description": {"long_text", "rich_text"},
    "description_html": {"rich_text"},
    "target_date": {"date"},
    "priority": {"select"},
    "status": {"select"},
    "state_id": {"select"},
    "project_id": {"relation"},
    "assignee_id": {"user"},
    "assignee_ids": {"user"},
    "project_lead_id": {"user"},
    "reason": {"short_text", "long_text"},
    "user_id": {"user"},
    "starts_at": {"datetime"},
    "ends_at": {"datetime"},
}
DISPLAY_SETTINGS = {
    "title",
    "help_text",
    "placeholder",
    "show_in_summary",
    "searchable",
    "filterable",
    "table_visible",
    "is_active",
}


def field_dict(field):
    return {
        "id": str(field.id),
        "code": field.code,
        "title": field.title,
        "kind": field.kind,
        "help_text": field.help_text,
        "placeholder": field.placeholder,
        "config": deepcopy(field.config),
        "lookup": field.lookup.code if field.lookup_id else None,
        "relation_entity": field.relation_entity.code if field.relation_entity_id else None,
        "is_active": field.is_active,
        "used": field.used_at is not None,
        **{key: getattr(field, key) for key in ("show_in_summary", "searchable", "filterable", "table_visible")},
    }


def bindings(layout):
    return [binding for section in layout.get("sections", []) for binding in section.get("bindings", [])]


def validate_field_config(kind, config):
    if kind not in FIELD_KINDS or not isinstance(config, dict):
        raise ValidationError("نوع یا تنظیمات فیلد معتبر نیست.")
    if config.get("regex"):
        validate_regex(config["regex"])
    for key in ("required", "hidden", "readonly", "editable_after_create", "unique", "multiple"):
        if key in config and not isinstance(config[key], bool):
            raise ValidationError({key: "تنظیم رفتاری باید بله/خیر باشد."})
    for key in ("min_length", "max_length", "max_file_size", "stars"):
        if key in config and (type(config[key]) is not int or config[key] < 0):
            raise ValidationError({key: "عدد صحیح نامنفی وارد کنید."})
    for key in ("min", "max"):
        if key in config:
            try:
                if isinstance(config[key], bool) or not Decimal(str(config[key])).is_finite():
                    raise ValueError()
            except (ValueError, InvalidOperation):
                raise ValidationError({key: "حد عددی معتبر وارد کنید."})
    if "extensions" in config and (
        not isinstance(config["extensions"], list)
        or any(not isinstance(v, str) or not v or len(v) > 15 for v in config["extensions"])
    ):
        raise ValidationError("پسوند فایل‌ها باید یک فهرست معتبر باشد.")
    if "stars" in config and not 1 <= config["stars"] <= 10:
        raise ValidationError("تعداد ستاره باید بین یک و ده باشد.")
    for lower, upper in (("min", "max"), ("min_length", "max_length")):
        if lower in config and upper in config:
            try:
                if float(config[lower]) > float(config[upper]):
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValidationError("حداقل و حداکثر معتبر وارد کنید.")
    if kind == "computed":
        formula_fields(config.get("formula"))
    if config.get("default_dynamic") not in {None, "", "today", "current_user", "now"}:
        raise ValidationError("مقدار پیش‌فرض پویا معتبر نیست.")
    value = config.get("default")
    dynamic = config.get("default_dynamic") or (value.get("dynamic") if isinstance(value, dict) else None)
    allowed = {
        "current_user": {"user", "short_text", "long_text"},
        "today": {"date", "date_range", "datetime", "short_text", "long_text"},
        "now": {"datetime", "short_text", "long_text"},
    }
    if dynamic and kind not in allowed.get(dynamic, set()):
        raise ValidationError("پیش‌فرض پویا با نوع این فیلد سازگار نیست.")
    if not dynamic and value is not None and kind != "computed":
        normalize({"kind": kind, "config": config}, value)


def validate_layout(entity, layout):
    if not isinstance(layout, dict) or not isinstance(layout.get("sections"), list) or len(layout["sections"]) > 60:
        raise ValidationError("چیدمان باید شامل حداکثر شصت بخش باشد.")
    all_fields = {
        f.code: f
        for f in FieldDefinition.objects.filter(workspace=entity.workspace).select_related("lookup", "relation_entity")
    }
    root = entity.parent or entity
    parent_layout = published_layout(root) if entity.parent_id else {"sections": []}
    inherited = {b["field"] for b in bindings(parent_layout)}
    seen, section_ids = set(), set()
    sources = {b["source"] for b in bindings(parent_layout) if b.get("source")}
    tabs = layout.get("tabs", [])
    if (
        not isinstance(tabs, list)
        or len(tabs) > 20
        or any(not isinstance(t, dict) or not t.get("id") or not t.get("title") for t in tabs)
    ):
        raise ValidationError("تب‌های فرم معتبر نیستند.")
    tab_ids = {t["id"] for t in tabs}
    if len(tab_ids) != len(tabs):
        raise ValidationError("شناسه تب تکراری است.")
    for section in layout["sections"]:
        if not isinstance(section, dict) or not section.get("id") or section["id"] in section_ids:
            raise ValidationError("شناسه بخش خالی یا تکراری است.")
        section_ids.add(section["id"])
        if section.get("columns", 1) not in {1, 2, 3} or section.get("tab") and section["tab"] not in tab_ids:
            raise ValidationError("تعداد ستون یا تب بخش معتبر نیست.")
        if not isinstance(section.get("bindings"), list) or len(section["bindings"]) > 200:
            raise ValidationError("فهرست اتصال‌های بخش معتبر نیست.")
        for binding in section["bindings"]:
            if not isinstance(binding, dict) or binding.get("field") not in all_fields:
                raise ValidationError("فیلد اتصال باید از کتابخانه همین فضای کاری انتخاب شود.")
            code = binding["field"]
            if code in seen or code in inherited:
                raise ValidationError({code: "فیلد مشترک یا اتصال تکراری است؛ فیلد مشترک را در فرم اصلی ویرایش کنید."})
            seen.add(code)
            if binding.get("source") and binding["source"] not in SOURCE_FIELDS.get(root.adapter, set()):
                raise ValidationError({code: "اتصال به ستون سیستمی مجاز نیست."})
            if binding.get("source"):
                source = binding["source"]
                if source in sources or all_fields[code].kind not in SOURCE_KINDS[source]:
                    raise ValidationError({code: "اتصال سیستمی تکراری یا با نوع فیلد ناسازگار است."})
                sources.add(source)
            for role_key in ("view_roles", "edit_roles"):
                roles = binding.get(role_key)
                if roles is not None:
                    if not isinstance(roles, list):
                        raise ValidationError("نقش‌ها باید یک فهرست باشند.")
                    try:
                        role_ids = {UUID(str(v)) for v in roles}
                    except (ValueError, TypeError):
                        raise ValidationError("شناسه نقش معتبر نیست.")
                    if OrganizationRole.objects.filter(
                        workspace=entity.workspace, id__in=role_ids, is_active=True
                    ).count() != len(role_ids):
                        raise ValidationError("نقش باید فعال و متعلق به همین فضای کاری باشد.")
            for key in ("required", "hidden", "readonly", "editable_after_create"):
                if key in binding and not isinstance(binding[key], bool):
                    raise ValidationError({code: "تنظیم رفتاری باید بله/خیر باشد."})
    fields = {code: field_dict(field) for code, field in all_fields.items() if code in seen | inherited}
    mandatory = {
        "ticket": {"name", "project_id"},
        "task": {"name", "assignee_id"},
        "project": {"name"},
        "leave": {"user_id", "starts_at", "ends_at"},
    }
    if root.adapter and not mandatory[root.adapter].issubset(sources):
        raise ValidationError(
            "فیلدهای اصلی لازم برای ثبت رکورد سیستمی نباید از فرم حذف شوند؛ برای جابه‌جایی آن‌ها اتصال را حفظ کنید."
        )
    if root.title_field not in fields:
        raise ValidationError("فیلد عنوان رکورد باید در فرم مشترک موجودیت وجود داشته باشد.")
    for binding in bindings(layout) + bindings(parent_layout):
        config = fields[binding["field"]]["config"]
        if "default" in binding:
            validate_field_config(
                fields[binding["field"]]["kind"], {**config, "default_dynamic": "", "default": binding["default"]}
            )
            if not (isinstance(binding["default"], dict) and "dynamic" in binding["default"]):
                binding["default"] = normalize(
                    {"kind": fields[binding["field"]]["kind"], "config": config}, binding["default"]
                )
        for key in ("required_if", "visible_if"):
            validate_condition(binding.get(key, config.get(key)), fields)
        dependency = config.get("depends_on")
        if dependency and dependency not in fields:
            raise ValidationError("فیلد والد لیست وابسته در فرم وجود ندارد.")
        if config.get("formula") and not formula_fields(config["formula"]).issubset(fields):
            raise ValidationError("فیلد مرجع فرمول در فرم وجود ندارد.")
    # Dependency validation without evaluating arbitrary expressions or requiring sample dates.
    pending, complete = set(), set()

    def visit(code):
        if code in pending:
            raise ValidationError("وابستگی حلقوی میان فیلدها مجاز نیست.")
        if code in complete:
            return
        pending.add(code)
        config = fields[code]["config"]
        for dependency in formula_fields(config["formula"]) if config.get("formula") else []:
            visit(dependency)
        pending.remove(code)
        complete.add(code)

    for code in fields:
        visit(code)
    return layout


def published_layout(entity):
    form = FormLayout.objects.filter(entity=entity).select_related("published").first()
    return deepcopy(form.published.schema) if form and form.published_id else {"tabs": [], "sections": []}


def effective_layout(entity, subtype=None, draft=False):
    def get_layout(item):
        form = FormLayout.objects.filter(entity=item).select_related("published").first()
        return (
            deepcopy(form.draft if draft else form.published.schema)
            if form and (draft or form.published_id)
            else {"tabs": [], "sections": []}
        )

    result = get_layout(entity)
    if subtype:
        extra = get_layout(subtype)
        result["sections"] = result.get("sections", []) + extra.get("sections", [])
        existing = {t["id"] for t in result.get("tabs", [])}
        result["tabs"] = result.get("tabs", []) + [t for t in extra.get("tabs", []) if t["id"] not in existing]
    return result


def schema_fields(entity, subtype=None, draft=False):
    cache = schema_request_cache.get()
    cache_key = ("schema", str(entity.id), str(subtype.id) if subtype else None, draft)
    if cache is not None and cache_key in cache:
        return deepcopy(cache[cache_key])
    layout = effective_layout(entity, subtype, draft)
    codes = [binding["field"] for binding in bindings(layout)]
    library = {
        field.code: field_dict(field)
        for field in FieldDefinition.objects.filter(workspace=entity.workspace, code__in=codes).select_related(
            "lookup", "relation_entity"
        )
    }
    result = {}
    for binding in bindings(layout):
        code = binding["field"]
        if code not in library:
            continue
        field = deepcopy(library[code])
        field["binding"] = binding
        for key in ("required", "hidden", "readonly", "default", "required_if", "visible_if", "editable_after_create"):
            if key in binding:
                field["config"][key] = binding[key]
        if "default" in binding:
            field["config"].pop("default_dynamic", None)
        if "required" in binding and "required_if" not in binding:
            field["config"].pop("required_if", None)
        if binding.get("title"):
            field["title"] = binding["title"]
        result[code] = field
    if cache is not None:
        cache[cache_key] = deepcopy((layout, result))
    return layout, result


def role_ids(user, workspace):
    cache = schema_request_cache.get()
    key = ("roles", str(user.id), str(workspace.id))
    if cache is not None and key in cache:
        return set(cache[key])
    result = {
        str(v)
        for v in UserOrganizationRole.objects.filter(
            workspace=workspace,
            user=user,
            is_active=True,
            role__is_active=True,
            role__deleted_at__isnull=True,
        ).values_list("role_id", flat=True)
    }
    if cache is not None:
        cache[key] = result
    return result


def can_field(field, roles, edit=False):
    binding = field.get("binding", {})
    view = binding.get("view_roles")
    if view is not None and not set(view).intersection(roles):
        return False
    allowed = binding.get("edit_roles")
    return not edit or allowed is None or bool(set(allowed).intersection(roles))


def present_schema(entity, user, subtype=None, values=None, draft=False, stage=""):
    layout, fields = schema_fields(entity, subtype, draft)
    roles, values = role_ids(user, entity.workspace), values or {}
    visible = {
        code
        for code, field in fields.items()
        if can_field(field, roles)
        and not field["config"].get("hidden")
        and (not field["binding"].get("stage") or field["binding"]["stage"] == stage)
    }
    permitted = {}
    for code, field in fields.items():
        if code not in visible:
            continue
        config = field["config"]
        restricted_formula = config.get("formula") and not formula_fields(config["formula"]).issubset(visible)
        if restricted_formula:
            continue
        for key in ("required_if", "visible_if"):
            rule = config.get(key)
            if rule and not condition_fields(rule).issubset(visible):
                config["required" if key == "required_if" else "effective_visible"] = condition(rule, values, fields)
                config.pop(key)
        config["readonly"] = (
            config.get("readonly", False) or not can_field(field, roles, edit=True) or field["kind"] == "computed"
        )
        field["binding"].pop("view_roles", None)
        field["binding"].pop("edit_roles", None)
        if field["binding"].get("stage") and field["binding"]["stage"] != stage:
            config["hidden"] = True
        permitted[code] = field
    layout["sections"] = [
        {**section, "bindings": [{"field": b["field"]} for b in section["bindings"] if b["field"] in permitted]}
        for section in layout.get("sections", [])
    ]
    return {
        "entity": entity.code,
        "title": entity.title,
        "subtype": subtype.code if subtype else None,
        "layout": layout,
        "fields": list(permitted.values()),
        "schema_version": 1,
        "time_zone": timezone.get_current_timezone_name(),
    }


@transaction.atomic
def initialize_engine(workspace):
    """Explicit idempotent bootstrap for existing/new workspaces, never a read-time write."""
    priority, _ = LookupCategory.objects.get_or_create(
        workspace=workspace, code="priority", defaults={"title": "اولویت", "is_system": True}
    )
    for pos, (code, title, color) in enumerate(
        (
            ("urgent", "فوری", "#ef4444"),
            ("high", "زیاد", "#f97316"),
            ("medium", "متوسط", "#eab308"),
            ("low", "کم", "#22c55e"),
            ("none", "بدون اولویت", "#64748b"),
        )
    ):
        LookupValue.objects.get_or_create(
            category=priority, code=code, defaults={"title": title, "color": color, "position": pos}
        )
    statuses, _ = LookupCategory.objects.get_or_create(
        workspace=workspace, code="task-status", defaults={"title": "وضعیت وظیفه", "is_system": True}
    )
    for pos, (code, title) in enumerate(
        (
            ("todo", "انجام‌نشده"),
            ("in_progress", "در حال انجام"),
            ("review", "بازبینی"),
            ("done", "انجام‌شده"),
            ("blocked", "مسدود"),
        )
    ):
        LookupValue.objects.get_or_create(category=statuses, code=code, defaults={"title": title, "position": pos})
    leave_types, _ = LookupCategory.objects.get_or_create(
        workspace=workspace, code="leave-type", defaults={"title": "نوع مرخصی", "is_system": True}
    )
    for pos, (code, title) in enumerate((("annual", "استحقاقی"), ("sick", "استعلاجی"), ("unpaid", "بدون حقوق"))):
        LookupValue.objects.get_or_create(category=leave_types, code=code, defaults={"title": title, "position": pos})
    types = {}
    for code, title, adapter, prefix in (
        ("ticket", "تیکت", "ticket", "TKT"),
        ("project", "پروژه", "project", "PRJ"),
        ("task", "وظیفه", "task", "TSK"),
        ("leave", "درخواست مرخصی", "leave", "LEV"),
    ):
        permissions = (
            {
                "view": "Project.View",
                "view_all": "Project.ViewAll",
                "create": "Project.Create",
                "edit": "Project.Edit",
                "delete": "Project.Delete",
            }
            if adapter == "project"
            else {
                "view": "Absence.View",
                "view_all": "Absence.ManageAll",
                "create": "Absence.Create",
                "edit": "Absence.Edit",
                "delete": "Absence.End",
            }
            if adapter == "leave"
            else {
                "view": "Issue.View",
                "view_all": "Issue.ViewAll",
                "create": "Issue.Create",
                "edit": "Issue.Edit",
                "delete": "Issue.Delete",
            }
        )
        types[code], _ = EntityType.objects.get_or_create(
            workspace=workspace,
            code=code,
            defaults={
                "title": title,
                "adapter": adapter,
                "numbering": {"prefix": prefix, "padding": 5},
                "record_permissions": permissions,
                "title_field": "reason" if adapter == "leave" else "title",
            },
        )
    definitions = [
        ("title", "عنوان", "short_text", {"required": True, "max_length": 255}, None, None),
        ("description", "توضیحات", "long_text", {}, None, None),
        ("rich_description", "توضیحات", "rich_text", {}, None, None),
        ("due_date", "سررسید", "date", {}, None, None),
        ("assignee", "مسئول", "user", {"required": True}, None, None),
        ("project_lead", "مدیر پروژه", "user", {}, None, None),
        ("ticket_assignees", "مسئولان", "user", {"multiple": True}, None, None),
        ("project", "پروژه", "relation", {"required": True}, None, types["project"]),
        ("priority", "اولویت", "select", {"default": "medium", "lookup_codes": True}, priority, None),
        ("task_status", "وضعیت", "select", {"default": "todo", "lookup_codes": True}, statuses, None),
        ("ticket_state", "وضعیت", "select", {"provider": "project_states", "depends_on": "project"}, None, None),
        ("leave_user", "کاربر", "user", {"required": True}, None, None),
        ("starts_at", "شروع", "datetime", {"required": True}, None, None),
        ("ends_at", "پایان", "datetime", {"required": True}, None, None),
        ("reason", "علت", "long_text", {}, None, None),
        ("leave_type", "نوع مرخصی", "select", {}, leave_types, None),
    ]
    for code, title, kind, config, lookup, relation in definitions:
        FieldDefinition.objects.get_or_create(
            workspace=workspace,
            code=code,
            defaults={"title": title, "kind": kind, "config": config, "lookup": lookup, "relation_entity": relation},
        )
    maps = {
        "ticket": [
            ("title", "name"),
            ("project", "project_id"),
            ("rich_description", "description_html"),
            ("ticket_assignees", "assignee_ids"),
            ("priority", "priority"),
            ("ticket_state", "state_id"),
            ("due_date", "target_date"),
        ],
        "task": [
            ("title", "name"),
            ("assignee", "assignee_id"),
            ("priority", "priority"),
            ("task_status", "status"),
            ("due_date", "target_date"),
        ],
        "project": [
            ("title", "name"),
            ("description", "description"),
            ("project_lead", "project_lead_id"),
            ("due_date", "target_date"),
        ],
        "leave": [
            ("leave_user", "user_id"),
            ("starts_at", "starts_at"),
            ("ends_at", "ends_at"),
            ("reason", "reason"),
            ("leave_type", ""),
        ],
    }
    for code, mapping in maps.items():
        layout = {
            "tabs": [],
            "sections": [
                {
                    "id": "main",
                    "title": "اطلاعات اصلی",
                    "columns": 2,
                    "bindings": [
                        {"field": field, **({"source": source} if source else {})} for field, source in mapping
                    ],
                }
            ],
        }
        form, created = FormLayout.objects.get_or_create(entity=types[code], defaults={"draft": layout})
        if created:
            version = FormVersion.objects.create(layout=form, number=1, schema=layout, change_note="فرم پیش‌فرض سیستم")
            form.published = version
            form.save(update_fields=["published", "updated_at"])
    return types
