"""Workspace navigation metadata. Presentation never grants access to a record or API."""

import re
from copy import deepcopy

from plane.app.services.access_control import has_permission
from plane.app.services.entity_records import permission
from plane.app.services.navigation_defaults import DEFAULT_NAVIGATION
from plane.app.services.surface_config import DESIGNABLE_SURFACES, SURFACES
from plane.db.models import EntityType, SurfaceConfiguration

DESIGN_PERMISSIONS = (
    "FormDesigner.View",
    "UniqueRule.Manage",
    "NumberingRule.Manage",
    "Relation.View",
    "Field.View",
    "View.Official.Manage",
    "Workflow.Design",
)
PAGE_PERMISSIONS = {
    "/": ("Dashboard.Personal.Manage",),
    "/inbox": (),
    "/my-work": ("Issue.View",),
    "/daily-report": ("DailyReport.Submit", "DailyReport.Team.View"),
    "/daily-report/team": ("DailyReport.Team.View", "Report.ViewAll"),
    "/workflow-inbox": ("Workflow.View",),
    "/leave-requests": ("Workflow.View",),
    "/calendar": ("Issue.View",),
    "/issues": ("Issue.View",),
    "/projects": ("Project.View",),
    "/reports": ("Report.View", "Report.ViewAll"),
    "/entities": (),  # Read-only directory; catalog and records enforce their own scope.
    "/team": ("User.View",),
    "/organization": ("OrganizationUnit.View",),
    "/roles": ("Role.View",),
    "/routing": ("Routing.Queue.View",),
    "/absences": ("Absence.View",),
    "/leave-templates": ("LeaveTemplate.Manage",),
    "/signatures": ("Signature.Manage",),
    "/settings": (),
    "/settings/engine": DESIGN_PERMISSIONS,
    "/help": (),
    "/portal-settings": (
        "Portal.Account.Manage",
        "Portal.Settings.Manage",
        "Portal.Request.Triage",
        "Portal.Reply",
        "Quote.Manage",
        "Portal.Feedback.View",
    ),
}
REGISTERED_ITEMS = {
    item["code"]: item
    for category in DEFAULT_NAVIGATION["categories"]
    for item in category["items"]
}


def category_path(category, path):
    return f"/sections/{category}" + (path if path != "/" else "")


def navigation_document(workspace):
    row, _ = SurfaceConfiguration.objects.get_or_create(
        workspace=workspace,
        code="crm-navigation",
        defaults={"definition": deepcopy(DEFAULT_NAVIGATION)},
    )
    return row


def navigation_payload(request, workspace):
    document = navigation_document(workspace).definition
    can = lambda code: has_permission(request.user, workspace, code, request=request)
    categories, routes, seen = [], [], set()
    # Codes and paths are validated against the application route registry. Database
    # titles are plain text; an edited document cannot introduce executable/external URLs.
    for raw in document.get("categories", []):
        code = raw.get("id", "")
        if (
            not isinstance(code, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", code)
            or code in seen
        ):
            continue
        seen.add(code)
        category = {
            key: str(raw.get(key, code))[:255]
            for key in ("id", "label", "title", "icon")
        }
        category["to"] = category_path(code, "/")
        category["items"] = []
        for stored in raw.get("items", []):
            registered = REGISTERED_ITEMS.get(stored.get("code"))
            if not registered:
                continue
            path = registered["path"]
            item = {
                "code": registered["code"],
                "path": path,
                "to": category_path(code, path),
                "label": str(stored.get("label", registered["label"]))[:255],
                "icon": str(stored.get("icon", registered["icon"]))[:80],
                "end": registered["end"],
            }
            routes.append({**item, "category": code})
            grants = PAGE_PERMISSIONS.get(path, ())
            if not grants or any(can(grant) for grant in grants):
                category["items"].append(item)
        categories.append(category)
    category_codes = {category["id"] for category in categories}

    def category_for_path(path):
        candidates = [
            row
            for row in routes
            if row["path"] != "/"
            and (path == row["path"] or path.startswith(row["path"] + "/"))
        ]
        return (
            max(candidates, key=lambda row: len(row["path"]))["category"]
            if candidates
            else (
                "data" if "data" in category_codes else next(iter(category_codes), "")
            )
        )

    pages = []
    designer = any(can(code) for code in DESIGN_PERMISSIONS) or can("EntityType.View")
    entities = list(
        EntityType.objects.filter(workspace=workspace, is_active=True)
        .exclude(code="task")
        .exclude(adapter="leave_request")
        .select_related("parent", "workspace", "parent__workspace")
    )
    assignments = document.get("page_categories", {})
    entity_paths = {
        "ticket": "/issues",
        "project": "/projects",
        "leave": "/absences",
        "user": "/team",
        "unit": "/organization",
    }
    entity_codes = set()
    for entity in entities:
        root = entity.parent or entity
        if not designer and not permission(root, request.user, "view", request):
            continue
        path = entity_paths.get(root.adapter, f"/entities/{entity.code}")
        requested = assignments.get(
            entity.code,
            assignments.get(root.code, entity.view_settings.get("navigation_category")),
        )
        category = requested if requested in category_codes else category_for_path(path)
        entity_codes.add(entity.code)
        pages.append(
            {
                "code": entity.code,
                "title": entity.title,
                "category": category,
                "path": path,
                "to": category_path(category, path),
                "kind": (
                    "نوع فرعی"
                    if entity.parent_id
                    else "بخش اصلی سامانه" if entity.adapter else "بخش سفارشی"
                ),
            }
        )
    design_pages = list(pages) if designer else []
    if designer:
        for code in sorted(DESIGNABLE_SURFACES):
            alias = {"users": "user", "units": "unit"}.get(code, code)
            if alias in entity_codes or code == "task":
                continue
            spec = SURFACES[code]
            path = spec["path"].split("?")[0]
            requested = assignments.get(alias)
            category = (
                requested if requested in category_codes else category_for_path(path)
            )
            design_pages.append(
                {
                    "code": alias,
                    "title": spec["title"],
                    "category": category,
                    "path": path,
                    "to": category_path(category, path),
                    "kind": "فرم و جدول صفحه",
                }
            )
    preference = SurfaceConfiguration.objects.filter(
        workspace=workspace, code=f"navigation-user-{request.user.id}"
    ).first()
    if not designer:
        page_categories = {page["category"] for page in pages}
        categories = [category for category in categories if category["items"] or category["id"] in page_categories]
        visible_paths = {item["path"] for category in categories for item in category["items"]}
        routes = [route for route in routes if route["path"] in visible_paths]
    return {
        "categories": categories,
        "routes": routes,
        "entities": pages,
        "design_pages": design_pages,
        "design_tabs": document.get("design_tabs", []) if designer else [],
        "all_design_title": str(document.get("all_design_title", "همه دسته‌ها"))[:255],
        "preferences": (
            preference.definition if preference else {"design_sidebar": None}
        ),
    }
