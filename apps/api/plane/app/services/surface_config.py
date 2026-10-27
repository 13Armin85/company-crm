"""One registry for the native forms and tables visible in the CRM.

Native endpoints remain responsible for authorization and business operations.
Extra values are validated before and committed in the same transaction as them.
"""

import re
from copy import deepcopy
from types import SimpleNamespace

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    Workspace,
    WorkspaceMember,
    SurfaceConfiguration,
    SurfaceValues,
    FieldDefinition,
    EntityType,
    EntityRecord,
    EntityEvent,
    OrganizationRole,
    OrganizationUnit,
    TicketRoutingRule,
    User,
    Cycle,
    UserPermissionException,
    FileAsset,
    Profile,
    FormLayout,
)
from .access_control import has_permission
from .surface_designer import (
    designer_schema,
    LOCK_REASON,
    MAX_TABLE_TABS,
    MAX_TAB_TITLE,
)
from .entity_schema import (
    field_dict,
    schema_fields,
    present_schema,
    can_field,
    role_ids,
)
from .entity_rules import empty, normalize, compute, condition, validate_condition
from .entity_records import (
    default_value,
    validate_reference,
    native_queryset,
    record_payload,
    emit_definition,
)


def native(code, title, kind="short_text", required=False, locked=False, aliases=()):
    return {
        "code": code,
        "title": title,
        "kind": kind,
        "required": required,
        "locked": locked,
        "aliases": list(aliases),
    }


SURFACES = {
    "ticket": {
        "title": "کارهای پروژه",
        "path": "/issues",
        "permission": "Issue.View",
        "engine": "ticket",
        "columns": [
            "عنوان کار",
            "شناسه",
            "پروژه",
            "وضعیت",
            "اولویت",
            "موعد",
            "مسئول",
            "عملیات",
        ],
    },
    "task": {
        "title": "کارهای من",
        "path": "/my-work",
        "permission": "Issue.View",
        "engine": "ticket",
        "columns": [
            "عنوان کار",
            "شناسه",
            "پروژه",
            "وضعیت",
            "اولویت",
            "موعد",
            "مسئول",
            "عملیات",
        ],
    },
    "project": {
        "title": "پروژه‌ها",
        "path": "/projects",
        "permission": "Project.View",
        "engine": "project",
        "columns": ["نام پروژه", "پیشرفت", "اعضا", "موعد", "به‌روزرسانی", "عملیات"],
    },
    "leave": {
        "title": "عدم حضور و مرخصی",
        "path": "/absences",
        "permission": "Absence.View",
        "engine": "leave",
        "columns": ["کاربر", "بازه", "علت", "وضعیت", "عملیات"],
    },
    "users": {
        "title": "اعضا و اطلاعات کاربران",
        "path": "/team",
        "permission": "User.View",
        "columns": ["عضو", "نقش‌های سازمانی", "وضعیت", "عملیات"],
        "native": [
            native("first_name", "نام"),
            native("last_name", "نام خانوادگی"),
            native("display_name", "نام نمایشی", required=True, locked=True),
            native("email", "ایمیل", "email", True, True),
            native("username", "نام کاربری", required=True, locked=True),
            native("password", "رمز عبور اولیه", required=True, locked=True),
            native("role_ids", "نقش‌ها", "role", locked=True, aliases=("نقش‌های سازمانی",)),
            native("unit_ids", "واحدهای سازمانی", "unit", aliases=("واحدها",)),
            native("is_active", "عضویت فعال در این شرکت", "boolean"),
        ],
    },
    "roles": {
        "title": "نقش‌های سازمانی",
        "path": "/roles",
        "permission": "Role.View",
        "columns": [
            "نام نقش",
            "توضیح",
            "وضعیت",
            "مجوزها",
            "کاربران دارای نقش",
            "عملیات",
        ],
        "native": [
            native("name", "نام نقش", required=True, locked=True),
            native("description", "توضیح", "long_text"),
        ],
    },
    "units": {
        "title": "واحدهای سازمانی",
        "path": "/organization",
        "permission": "OrganizationUnit.View",
        "columns": [],
        "native": [
            native("title", "عنوان واحد", required=True, locked=True),
            native("parent_id", "واحد بالادستی", "unit"),
            native("manager_id", "مدیر فعلی", "user"),
            native("member_ids", "اعضای واحد", "user"),
            native("is_active", "واحد فعال باشد", "boolean"),
        ],
    },
    "routing": {
        "title": "قوانین ارجاع",
        "path": "/routing",
        "permission": "Routing.Manage",
        "columns": ["نام قانون", "واحد شروع", "نقش مورد نیاز", "وضعیت", "عملیات"],
        "native": [
            native("name", "نام قانون", required=True, locked=True),
            native("unit_id", "واحد شروع", "unit", True, True),
            native("required_role_id", "نقش مورد نیاز", "role", True, True),
            native("is_active", "قانون فعال باشد", "boolean"),
        ],
    },
    "cycles": {
        "title": "چرخه‌های پروژه",
        "path": "/projects",
        "permission": "Project.View",
        "columns": [],
        "native": [
            native("name", "نام چرخه", required=True, locked=True),
            native("start_date", "شروع", "date"),
            native("end_date", "پایان", "date"),
        ],
    },
    "profile": {
        "title": "تنظیمات پروفایل من",
        "path": "/settings?section=profile",
        "permission": "self",
        "columns": [],
        "native": [
            native("display_name", "نام نمایشی", required=True, locked=True),
            native("email", "ایمیل حساب", "email"),
        ],
    },
    "security": {
        "title": "امنیت حساب",
        "path": "/settings?section=security",
        "permission": "self",
        "columns": [],
        "native": [
            native("old_password", "رمز عبور فعلی", required=True, locked=True),
            native("new_password", "رمز عبور جدید", required=True, locked=True),
        ],
    },
    "notifications": {
        "title": "تنظیمات اعلان‌ها",
        "path": "/settings?section=notifications",
        "permission": "self",
        "columns": [],
        "native": [
            native(key, title, "boolean")
            for key, title in (
                ("property_change", "تغییر مشخصات کار"),
                ("state_change", "تغییر وضعیت"),
                ("comment", "دیدگاه‌ها"),
                ("mention", "اشاره به شما"),
                ("issue_completed", "تکمیل کار"),
            )
        ],
    },
    "workspace": {
        "title": "مشخصات فضای کاری",
        "path": "/settings?section=general",
        "permission": "self",
        "columns": [],
        "native": [
            native("name", "نام فضای کاری", required=True, locked=True),
            native("slug", "آدرس فضای کاری", required=True, locked=True),
        ],
    },
    "password": {
        "title": "تغییر رمز عبور کاربر",
        "path": "/team",
        "permission": "User.ChangePassword",
        "columns": [],
        "native": [
            native("new_password", "رمز عبور جدید", required=True, locked=True),
            native(
                "confirm_password", "تأیید رمز عبور جدید", required=True, locked=True
            ),
        ],
    },
    "exceptions": {
        "title": "دسترسی مستقیم کاربران",
        "path": "/team",
        "permission": "Access.UserException.Manage",
        "columns": ["دسته / مجوز", "نوع اثر", "وضعیت", "نتیجهٔ نهایی", "عملیات"],
        "native": [
            native("permission", "مجوز", required=True, locked=True),
            native("effect", "نوع اثر", required=True, locked=True),
        ],
    },
    "delegates": {
        "title": "جانشینان واحد",
        "path": "/organization",
        "permission": "OrganizationUnit.View",
        "columns": [],
        "native": [],
    },
    "role-permissions": {
        "title": "مجوزهای نقش",
        "path": "/roles",
        "permission": "Role.Permission.Assign",
        "columns": [],
        "native": [native("permission_ids", "مجوزهای نقش", "role", locked=True)],
    },
    "appearance": {
        "title": "ظاهر و ترجیحات",
        "path": "/settings?section=general",
        "permission": "self",
        "columns": [],
        "native": [],
    },
}

DESIGNABLE_SURFACES = {"ticket", "project", "task", "leave", "users", "roles", "units", "routing", "cycles"}

WRITE_PERMISSIONS = {
    "users": {"POST": ("User.Create",), "PATCH": ("User.Edit",)},
    "roles": {"POST": ("Role.Create",), "PATCH": ("Role.Edit",)},
    "units": {
        "POST": ("OrganizationUnit.Create",),
        "PATCH": ("OrganizationUnit.Edit",),
    },
    "routing": {"POST": ("Routing.Manage",), "PATCH": ("Routing.Manage",)},
    "cycles": {"POST": ("Project.Edit",), "PATCH": ("Project.Edit",)},
    "password": {"POST": ("User.ChangePassword",)},
    "exceptions": {
        "POST": ("Access.UserException.Manage",),
        "PATCH": ("Access.UserException.Manage",),
    },
    "delegates": {"PUT": ("OrganizationUnit.Delegate.Manage",)},
    "workspace": {"PATCH": ("Workspace.Edit",)},
    "role-permissions": {"PATCH": ("Role.Permission.Assign",)},
}


def member_workspace(request, slug):
    return get_object_or_404(
        Workspace,
        slug=slug,
        workspace_member__member=request.user,
        workspace_member__is_active=True,
        workspace_member__deleted_at__isnull=True,
    )


def allowed(request, workspace, code, manage=False, records=False):
    spec = SURFACES[code]
    if spec["permission"] == "self" and not manage:
        return
    permissions = ["FormDesigner.Publish"] if manage else [spec["permission"]]
    if not manage and not records:
        permissions += [
            "FormDesigner.Publish",
            *{p for grants in WRITE_PERMISSIONS.get(code, {}).values() for p in grants},
        ]
    if code == "exceptions" and not manage:
        permissions.append("Access.UserException.View")
    if not any(
        has_permission(request.user, workspace, p, request=request) for p in permissions
    ):
        raise PermissionDenied("مجوز مشاهده یا تنظیم این صفحه را ندارید.")


def configuration(workspace, code):
    # Both work pages share the same table tabs and fields after unification.
    row = SurfaceConfiguration.objects.filter(
        workspace=workspace, code="ticket" if code == "task" else code
    ).first()
    definition = deepcopy(row.definition) if row else {}
    definition.setdefault("native", {})
    definition.setdefault("fields", [])
    definition.setdefault(
        "columns", [f"native:{title}" for title in SURFACES[code]["columns"]]
    )
    definition.setdefault("table_tabs", [])
    return row, definition


def extra_fields(workspace, definition):
    library = {
        f.code: field_dict(f)
        for f in FieldDefinition.objects.filter(
            workspace=workspace, code__in=[b["field"] for b in definition["fields"]]
        ).select_related("lookup", "relation_entity")
    }
    result = {}
    for binding in definition["fields"]:
        if binding["field"] not in library:
            continue
        field = deepcopy(library[binding["field"]])
        field["binding"] = binding
        if binding.get("title"):
            field["title"] = binding["title"]
        field["config"].update(
            {
                key: binding[key]
                for key in ("required", "hidden", "readonly")
                if key in binding
            }
        )
        if "required" in binding:
            field["config"].pop("required_if", None)
        result[field["code"]] = field
    return result


def surface_schema(workspace, code, user):
    row, definition = configuration(workspace, code)
    spec = SURFACES[code]
    fields = extra_fields(workspace, definition)
    roles = role_ids(user, workspace)
    fields = {
        key: field
        for key, field in fields.items()
        if can_field(field, roles) and not field["config"].get("hidden") and not field["hidden_from_form"]
    }
    engine_fields = []
    form_definition = None
    if spec.get("engine"):
        entity = EntityType.objects.filter(
            workspace=workspace, code=spec["engine"], parent__isnull=True
        ).first()
        if entity:
            if has_permission(user, workspace, "FormDesigner.Publish"):
                form = (
                    FormLayout.objects.filter(entity=entity)
                    .select_related("published")
                    .first()
                )
                form_definition = {
                    "revision": form.revision if form else 0,
                    "layout": deepcopy(
                        form.published.schema
                        if form and form.published_id
                        else form.draft if form else {"tabs": [], "sections": []}
                    ),
                }
            engine_fields = [
                {**f, "options_surface": entity.code}
                for f in present_schema(entity, user)["fields"]
            ]
    defaults = {}
    user._engine_workspace = workspace
    for field in fields.values():
        field["config"]["readonly"] = field["config"].get(
            "readonly", False
        ) or not can_field(field, roles, edit=True)
        if field["is_active"] and field["kind"] != "computed":
            defaults[field["code"]] = default_value(field, user)
    return {
        "code": code,
        "title": spec["title"],
        "path": spec["path"],
        "engine": spec.get("engine"),
        "form": form_definition,
        "revision": row.revision if row else 0,
        "definition": definition,
        "native_fields": [
            {
                **f,
                **definition["native"].get(f["code"], {}),
                "lock_reason": LOCK_REASON if f["locked"] else "",
            }
            for f in spec.get("native", [])
        ],
        "native_columns": spec["columns"],
        "engine_fields": engine_fields,
        "designer": designer_schema(workspace, spec.get("engine") or code, user, engine_fields),
        "schema": {
            "entity": code,
            "time_zone": timezone.get_current_timezone_name(),
            "title": "اطلاعات تکمیلی",
            "schema_version": row.revision if row else 0,
            "fields": list(fields.values()),
            "defaults": defaults,
            "layout": {
                "tabs": [],
                "sections": [
                    {
                        "id": "extra",
                        "title": "اطلاعات تکمیلی",
                        "columns": 2,
                        "bindings": [{"field": key} for key in fields],
                    }
                ],
            },
        },
    }


def validate_definition(workspace, code, definition):
    if not isinstance(definition, dict) or set(definition) - {
        "native",
        "fields",
        "columns",
        "table_tabs",
    }:
        raise ValidationError("ساختار تنظیمات صفحه معتبر نیست.")
    if not isinstance(definition.get("native", {}), dict) or not isinstance(
        definition.get("fields", []), list
    ):
        raise ValidationError("فهرست فیلدهای فرم معتبر نیست.")
    definition = deepcopy(definition)
    definition.setdefault("native", {})
    definition.setdefault("fields", [])
    native_map = {f["code"]: f for f in SURFACES[code].get("native", [])}
    for key, patch in definition["native"].items():
        if (
            key not in native_map
            or not isinstance(patch, dict)
            or set(patch) - {"required", "hidden"}
        ):
            raise ValidationError("فیلد اصلی یا تنظیم آن معتبر نیست.")
        if any(not isinstance(v, bool) for v in patch.values()):
            raise ValidationError("الزام و نمایش فیلد باید بله یا خیر باشد.")
        if native_map[key]["locked"] and (
            patch.get("hidden") or patch.get("required") is False
        ):
            raise ValidationError({key: "این ورودی برای عملیات اصلی سیستم ضروری است."})
    if len(definition["fields"]) > 200:
        raise ValidationError("حداکثر دویست فیلد در هر فرم مجاز است.")
    seen = set()
    for binding in definition["fields"]:
        if not isinstance(binding, dict) or set(binding) - {
            "field",
            "required",
            "hidden",
            "readonly",
            "title",
        }:
            raise ValidationError("اتصال فیلد معتبر نیست.")
        field = binding.get("field")
        if not isinstance(field, str) or field in seen or field in native_map:
            raise ValidationError("فیلد تکراری یا با ورودی اصلی هم‌نام است.")
        if "title" in binding and (
            not isinstance(binding["title"], str)
            or not binding["title"].strip()
            or len(binding["title"]) > 255
        ):
            raise ValidationError("عنوان فیلد باید بین یک تا ۲۵۵ نویسه باشد.")
        if any(
            not isinstance(v, bool)
            for k, v in binding.items()
            if k not in {"field", "title"}
        ):
            raise ValidationError("تنظیم فیلد باید بله یا خیر باشد.")
        seen.add(field)
    fields = extra_fields(workspace, definition)
    if len(fields) != len(seen) or any(not f["is_active"] for f in fields.values()):
        raise ValidationError("فیلد باید فعال و متعلق به کتابخانه همین شرکت باشد.")
    for field in fields.values():
        for key in ("required_if", "visible_if"):
            validate_condition(field["config"].get(key), fields)
        if (
            field["config"].get("depends_on")
            and field["config"]["depends_on"] not in fields
        ):
            raise ValidationError("فیلد والد باید در همین فرم موجود باشد.")
    compute(fields, {}, strict=False)
    engine_codes = set()
    if SURFACES[code].get("engine"):
        entity = EntityType.objects.filter(
            workspace=workspace,
            code=SURFACES[code]["engine"],
            parent__isnull=True,
        ).first()
        if entity:
            engine_codes = set(schema_fields(entity)[1])
    choices = (
        {f"native:{title}" for title in SURFACES[code]["columns"]}
        | {f"field:{f}" for f in fields}
        | {f"engine:{f}" for f in engine_codes}
    )
    if SURFACES[code].get("engine"):
        roots = EntityType.objects.filter(
            workspace=workspace,
            code=SURFACES[code]["engine"],
            parent__isnull=True,
        )
        for root in roots:
            for subtype in EntityType.objects.filter(parent=root, is_active=True):
                choices |= {
                    f"engine:{field}" for field in schema_fields(root, subtype)[1]
                }
    columns = definition.get("columns")
    if (
        not isinstance(columns, list)
        or any(not isinstance(c, str) or c not in choices for c in columns)
        or len(set(columns)) != len(columns)
    ):
        raise ValidationError("ستون‌های جدول معتبر یا یکتا نیستند.")
    if SURFACES[code]["columns"] and not columns:
        raise ValidationError("حداقل یک ستون برای جدول انتخاب کنید.")
    tabs = definition.setdefault("table_tabs", [])
    if not isinstance(tabs, list) or len(tabs) > MAX_TABLE_TABS:
        raise ValidationError("حداکثر بیست تب جدول مجاز است.")
    if tabs and not SURFACES[code]["columns"]:
        raise ValidationError("این صفحه جدول ندارد.")
    identifiers, titles = set(), set()
    for index, tab in enumerate(tabs):
        error_key = f"table_tabs.{index}"
        if not isinstance(tab, dict):
            raise ValidationError({error_key: "اطلاعات تب جدول معتبر نیست."})
        if not isinstance(tab.get("title"), str) or not tab["title"].strip():
            raise ValidationError(
                {
                    f"{error_key}.title": "نام تب را وارد کنید؛ نام تب نمی‌تواند خالی باشد."
                }
            )
        if len(tab["title"]) > MAX_TAB_TITLE:
            raise ValidationError({f"{error_key}.title": "نام تب حداکثر ۸۰ نویسه است."})
        if tab["title"].strip().casefold() in titles:
            raise ValidationError(
                {
                    f"{error_key}.title": "نام تب تکراری است؛ برای هر تب نام متفاوتی انتخاب کنید."
                }
            )
        if not tab.get("columns"):
            raise ValidationError(
                {
                    f"{error_key}.columns": f"برای تب «{tab['title']}» حداقل یک ستون انتخاب کنید."
                }
            )
        if (
            not isinstance(tab, dict)
            or set(tab) != {"id", "title", "columns"}
            or not isinstance(tab["id"], str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", tab["id"])
            or tab["id"] in identifiers
            or not isinstance(tab["title"], str)
            or not tab["title"].strip()
            or len(tab["title"]) > MAX_TAB_TITLE
            or not isinstance(tab["columns"], list)
            or not tab["columns"]
            or any(not isinstance(c, str) or c not in choices for c in tab["columns"])
            or len(set(tab["columns"])) != len(tab["columns"])
        ):
            raise ValidationError("نام، شناسه یا ستون‌های تب جدول معتبر نیست.")
        tab["title"] = tab["title"].strip()
        identifiers.add(tab["id"])
        titles.add(tab["title"].casefold())
    return definition


SELF_SURFACES = {
    "/api/users/me/": "profile",
    "/auth/change-password/": "security",
    "/api/users/me/notification-preferences/": "notifications",
    "/api/users/me/profile/": "appearance",
}


def surface_route(path, request=None):
    if path in SELF_SURFACES and request:
        slug = request.headers.get("X-CRM-Workspace")
        actor = getattr(request, "user", None)
        if not slug and actor and actor.is_authenticated:
            preferred = (
                Profile.objects.filter(user=actor)
                .values_list("last_workspace_id", flat=True)
                .first()
            )
            memberships = Workspace.objects.filter(
                workspace_member__member=actor,
                workspace_member__is_active=True,
                workspace_member__deleted_at__isnull=True,
            )
            workspace = memberships.filter(id=preferred).first() if preferred else None
            workspace = workspace or memberships.order_by("created_at", "id").first()
            slug = workspace.slug if workspace else None
        if slug:
            return (
                slug,
                SELF_SURFACES[path],
                str(actor.id) if actor and actor.is_authenticated else None,
            )
    match = re.fullmatch(r"/api/(?:v1/)?workspaces/([^/]+)/(.*)", path)
    if not match:
        return None
    slug, suffix = match.groups()
    if not suffix:
        return slug, "workspace", None
    for code, pattern in (
        ("password", r"organization/users/([0-9a-f-]+)/password/"),
        ("exceptions", r"organization/users/[0-9a-f-]+/exceptions/(?:([0-9a-f-]+)/)?"),
        ("delegates", r"organization/units/([0-9a-f-]+)/delegates/"),
        ("roles", r"organization/roles/(?:([0-9a-f-]+)/)?"),
        ("units", r"organization/units/(?:([0-9a-f-]+)/)?"),
        ("routing", r"organization/routing-rules/(?:([0-9a-f-]+)/)?"),
        ("users", r"organization/users/([0-9a-f-]+)/"),
        ("users", r"members/(?:([0-9a-f-]+)/)?"),
        ("cycles", r"projects/[0-9a-f-]+/cycles/(?:([0-9a-f-]+)/)?"),
    ):
        found = re.fullmatch(pattern, suffix)
        if found:
            if (
                code == "roles"
                and request
                and request.headers.get("X-CRM-Surface") == "role-permissions"
            ):
                code = "role-permissions"
            return slug, code, found[1]
    return None


def prepare_surface_request(request):
    if request.method not in {"POST", "PUT", "PATCH"}:
        return
    if request.path == "/api/users/me/profile/" and set(request.data) == {
        "last_workspace_id"
    }:
        return  # Navigation state is separate from the appearance form.
    route = surface_route(request.path, request)
    if not route:
        return
    slug, code, object_id = route
    if code == "role-permissions" and set(request.data) - {
        "permission_ids",
        "custom_values",
    }:
        raise ValidationError(
            "در فرم مجوزهای نقش فقط مجوزها و اطلاعات تکمیلی همان فرم قابل تغییر است."
        )
    request._full_data = request.data.copy()
    workspace = member_workspace(request, slug)
    if code == "security":
        from zoneinfo import ZoneInfo

        timezone.activate(ZoneInfo(request.user.user_timezone))
    if code == "workspace":
        object_id = workspace.id
    # Serialize definition changes and value writes, including two concurrent creates.
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    _, definition = configuration(workspace, code)
    creating = request.method == "POST"
    request._engine_record_id = object_id
    original = None
    for field in SURFACES[code].get("native", []):
        config = {**field, **definition["native"].get(field["code"], {})}
        key = field["code"]
        if config.get("hidden") and key in request.data:
            # A removed optional native input cannot be changed through the old endpoint.
            request.data.pop(key)
            continue
        current_value = request.data.get(key)
        if (
            not creating
            and key not in request.data
            and object_id
            and definition["native"].get(key, {}).get("required")
        ):
            original = (
                original
                or scoped_objects(workspace, code, request.user, request)
                .filter(id=object_id)
                .first()
            )
            if original is None or not hasattr(original, key):
                continue
            current_value = getattr(original, key)
        if (
            definition["native"].get(key, {}).get("required")
            and not config.get("hidden")
            and empty(current_value)
        ):
            raise ValidationError({key: f"تکمیل «{field['title']}» الزامی است."})
    fields = extra_fields(workspace, definition)
    submitted = request.data.get("custom_values", {})
    if not isinstance(submitted, dict) or set(submitted) - set(fields):
        raise ValidationError(
            {"custom_values": "فیلد ناشناخته یا ساختار مقادیر نامعتبر است."}
        )
    request.data.pop("custom_values", None)
    if not creating and not submitted and not fields:
        return
    if submitted and code in WRITE_PERMISSIONS:
        permissions = WRITE_PERMISSIONS[code].get(request.method, ())
        if not any(
            has_permission(request.user, workspace, p, request=request)
            for p in permissions
        ):
            raise PermissionDenied("مجوز ویرایش اطلاعات تکمیلی این فرم را ندارید.")
    old = (
        SurfaceValues.objects.filter(
            workspace=workspace, code=code, object_id=object_id
        ).first()
        if object_id
        else None
    )
    values = deepcopy(old.values) if old else {}
    roles = role_ids(request.user, workspace)
    request.user._engine_workspace = workspace
    context = SimpleNamespace(workspace=workspace, code=code)
    for key, field in fields.items():
        if creating and key not in values and not field["hidden_from_form"]:
            values[key] = default_value(field, request.user)
        if key not in submitted:
            continue
        raw = submitted[key]
        if (
            not can_field(field, roles, edit=True)
            or field["hidden_from_form"]
            or field["config"].get("hidden")
            or field["config"].get("readonly")
            or field["kind"] == "computed"
        ):
            raise PermissionDenied({key: "ویرایش این فیلد مجاز نیست."})
        if not field["is_active"] and raw != values.get(key):
            raise ValidationError({key: "فیلد غیرفعال قابل تغییر نیست."})
        if (
            not creating
            and field["config"].get("editable_after_create") is False
            and raw != values.get(key)
        ):
            raise PermissionDenied({key: "این فیلد پس از ثبت قابل تغییر نیست."})
        try:
            values[key] = normalize(field, raw)
        except ValidationError as exc:
            raise ValidationError({key: exc.detail}) from exc
    values = compute(fields, values)
    for key, field in fields.items():
        config, value = field["config"], values.get(key)
        hidden = (
            config.get("hidden")
            or field["hidden_from_form"]
            or not can_field(field, roles)
            or not condition(config.get("visible_if"), values, fields)
        )
        if (
            key in submitted
            and hidden
            and value != (old.values.get(key) if old else None)
        ):
            raise PermissionDenied({key: "فیلد در این فرم قابل تغییر نیست."})
        required = (
            config.get("required")
            or config.get("required_if")
            and condition(config["required_if"], values, fields)
        )
        if field["is_active"] and required and not hidden and empty(value):
            raise ValidationError({key: f"تکمیل «{field['title']}» الزامی است."})
        if not empty(value):
            try:
                validate_reference(
                    context,
                    request.user,
                    field,
                    value,
                    values,
                    old.values.get(key) if old else None,
                    request,
                )
            except (ValueError, TypeError) as exc:
                raise ValidationError({key: "مقدار انتخابی معتبر نیست."}) from exc
        if config.get("unique") and not empty(value):
            matches = SurfaceValues.objects.filter(
                workspace=workspace, code=code, **{f"values__{key}": value}
            )
            if object_id:
                matches = matches.exclude(object_id=object_id)
            if matches.exists():
                raise ValidationError({key: "این مقدار قبلاً ثبت شده است."})
    request._surface_change = (
        workspace,
        code,
        object_id,
        values,
        old.values if old else {},
    )


def finish_surface_request(request, response):
    change = getattr(request, "_surface_change", None)
    if (
        not change
        or response.status_code >= 400
        or not hasattr(response, "data")
        or not isinstance(response.data, dict)
    ):
        return
    workspace, code, object_id, values, before = change
    payload = response.data
    if code == "users" and "/members/" in request.path:
        object_id = (
            WorkspaceMember.objects.filter(workspace=workspace, id=payload.get("id"))
            .values_list("member_id", flat=True)
            .first()
        )
    object_id = object_id or payload.get("id")
    if not object_id:
        raise ValidationError("شناسه رکورد برای ذخیره اطلاعات تکمیلی دریافت نشد.")
    SurfaceValues.objects.update_or_create(
        workspace=workspace, code=code, object_id=object_id, defaults={"values": values}
    )
    for key, field in extra_fields(
        workspace, configuration(workspace, code)[1]
    ).items():
        if field["kind"] == "file":
            FileAsset.objects.filter(
                workspace=workspace,
                id__in=values.get(key) or [],
                user=request.user,
                entity_type="CRM_FIELD",
                entity_identifier="",
                attributes__entity=code,
                attributes__field=key,
            ).update(entity_identifier=str(object_id))
    FieldDefinition.objects.filter(
        workspace=workspace, code__in=values, used_at__isnull=True
    ).update(used_at=timezone.now())
    if values != before:
        EntityEvent.objects.create(
            workspace=workspace,
            record_id=object_id,
            event_type="surface.values.updated",
            before=before,
            after=values,
            metadata={"surface": code},
            created_by=request.user,
        )


class SurfacePolicyMixin:
    def dispatch(self, request, *args, **kwargs):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and (
            request.path in SELF_SURFACES or surface_route(request.path)
        ):
            with transaction.atomic():
                response = super().dispatch(request, *args, **kwargs)
                if response.status_code >= 400:
                    transaction.set_rollback(True)
                return response
        return super().dispatch(request, *args, **kwargs)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        prepare_surface_request(request)

    def finalize_response(self, request, response, *args, **kwargs):
        finish_surface_request(request, response)
        return super().finalize_response(request, response, *args, **kwargs)


def scoped_objects(workspace, code, user, request):
    if code in {"profile", "security", "notifications", "appearance"}:
        return User.objects.filter(id=user.id)
    if code == "workspace":
        return Workspace.objects.filter(id=workspace.id)
    if code == "password":
        return User.objects.filter(
            member_workspace__workspace=workspace,
            member_workspace__deleted_at__isnull=True,
        ).distinct()
    if code == "exceptions":
        return UserPermissionException.objects.filter(workspace=workspace)
    if code == "delegates":
        return OrganizationUnit.objects.filter(workspace=workspace)
    if code == "role-permissions":
        return OrganizationRole.objects.filter(workspace=workspace)
    if SURFACES[code].get("engine"):
        entity = get_object_or_404(
            EntityType, workspace=workspace, code=code, parent__isnull=True
        )
        return native_queryset(entity, user, request)
    if code == "users":
        return User.objects.filter(
            member_workspace__workspace=workspace,
            member_workspace__deleted_at__isnull=True,
        ).distinct()
    if code == "cycles":
        from .project_visibility import visible_projects
        from plane.db.models import Project

        return Cycle.objects.filter(
            workspace=workspace,
            project__in=visible_projects(
                Project.objects.filter(workspace=workspace), user, workspace.slug
            ),
        )
    return {
        "roles": OrganizationRole,
        "units": OrganizationUnit,
        "routing": TicketRoutingRule,
    }[code].objects.filter(workspace=workspace)


def read_values(request, workspace, code, identifiers):
    allowed(request, workspace, code, records=True)
    if code in {"task", "ticket"}:
        result = {}
        for entity in EntityType.objects.filter(
            workspace=workspace, code="ticket", parent__isnull=True
        ):
            rows = list(
                native_queryset(entity, request.user, request).filter(
                    id__in=identifiers
                )
            )
            sidecars = {
                str(r.source_id): r
                for r in EntityRecord.objects.filter(
                    entity=entity, source_id__in=[r.id for r in rows]
                )
            }
            for row in rows:
                result[str(row.id)] = record_payload(
                    entity, request.user, sidecars.get(str(row.id)), row, request
                )["values"]
        return result
    rows = list(
        scoped_objects(workspace, code, request.user, request).filter(
            id__in=identifiers
        )
    )
    if SURFACES[code].get("engine"):
        entity = EntityType.objects.get(
            workspace=workspace, code=code, parent__isnull=True
        )
        sidecars = {
            str(r.source_id): r
            for r in EntityRecord.objects.filter(
                entity=entity, source_id__in=[r.id for r in rows]
            )
        }
        return {
            str(row.id): record_payload(
                entity, request.user, sidecars.get(str(row.id)), row, request
            )["values"]
            for row in rows
        }
    _, definition = configuration(workspace, code)
    fields = extra_fields(workspace, definition)
    roles = role_ids(request.user, workspace)
    stored = {
        str(r.object_id): r.values
        for r in SurfaceValues.objects.filter(
            workspace=workspace, code=code, object_id__in=[r.id for r in rows]
        )
    }
    return {
        str(row.id): {
            key: value
            for key, value in stored.get(str(row.id), {}).items()
            if key in fields
            and can_field(fields[key], roles)
            and not fields[key]["config"].get("hidden")
            and condition(
                fields[key]["config"].get("visible_if"),
                stored.get(str(row.id), {}),
                fields,
            )
        }
        for row in rows
    }
