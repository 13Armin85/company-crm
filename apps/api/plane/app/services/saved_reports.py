"""Ticket 8 — saved reports (decision 8.10). Single source of truth for create/open/edit/copy/delete/share.

Why a new ``SavedReport`` row and not ``IssueView``/``entity_views``: a saved engine view is
bound to one ``EntityType`` and to ``EntityQuery`` over ``EntityRecord`` (``engine_entity`` is
the query root, ``IssueView.save`` rewrites ``query`` from Issue filters, and Plane's native
view endpoints list every workspace ``IssueView``). Report sources are leave requests,
schedules, extensions, daily reports… none of them an entity. The sharing *shape* is the
same as ``entity_views`` (personal by default; shared with roles/units; recipients only run
or copy) and recipients are matched with the same role/unit membership helpers.

Saving or sharing never grants data: a recipient running a shared report sees only what
``report_scope`` gives *them* (the run path is ``report_sources.run``).
"""

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from uuid import UUID

from plane.db.models import OrganizationRole, OrganizationUnit, OrganizationUnitMember, SavedReport
from . import daily_reports as reports
from . import report_sources as sources
from .access_control import has_permission
from .entity_schema import role_ids
from .workflow_engine import Conflict


def _require(actor, workspace, code, request=None, message="مجوز انجام این عملیات را ندارید."):
    if not has_permission(actor, workspace, code, request=request):
        raise PermissionDenied(message)


def _unit_ids(user, workspace):
    return {
        str(v)
        for v in OrganizationUnitMember.objects.filter(
            user=user, unit__workspace=workspace, unit__is_active=True, is_active=True
        ).values_list("unit_id", flat=True)
    }


def visible(workspace, viewer):
    """Own reports and reports shared with one of the viewer's roles or units."""
    roles, units = role_ids(viewer, workspace), _unit_ids(viewer, workspace)
    rows = SavedReport.objects.filter(workspace=workspace).select_related("owner")
    result = []
    for row in rows.filter(Q(owner=viewer) | Q(visibility=SavedReport.Visibility.SHARED)):
        if row.owner_id == viewer.id:
            result.append(row)
        elif roles.intersection(map(str, row.shared_roles or [])) or units.intersection(
            map(str, row.shared_units or [])
        ):
            result.append(row)
    return result


def get(workspace, viewer, report_id):
    row = next((r for r in visible(workspace, viewer) if str(r.id) == str(report_id)), None)
    if row is None:
        raise NotFound("گزارش پیدا نشد یا با شما به اشتراک گذاشته نشده است.")
    return row


def payload(row, viewer, request=None):
    source = sources.SOURCES.get(row.source)
    mine = row.owner_id == viewer.id
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description,
        "source": row.source,
        "source_title": source.title if source else row.source,
        "definition": row.definition,
        "schema_version": row.schema_version,
        "visibility": row.visibility,
        "shared_roles": [str(v) for v in row.shared_roles or []],
        "shared_units": [str(v) for v in row.shared_units or []],
        "owner": reports.person(row.owner),
        "mine": mine,
        "revision": row.revision,
        "can": {
            "edit": mine and has_permission(viewer, row.workspace, "Report.Build", request=request),
            "delete": mine,
            "share": mine and has_permission(viewer, row.workspace, "Report.Share", request=request),
            "copy": has_permission(viewer, row.workspace, "Report.Build", request=request),
            "export": has_permission(viewer, row.workspace, "Report.Export", request=request),
        },
        "updated_at": row.updated_at.isoformat(),
    }


def _name(value):
    value = value.strip() if isinstance(value, str) else ""
    if not value:
        raise ValidationError({"name": "نام گزارش را وارد کنید."})
    if len(value) > 120:
        raise ValidationError({"name": "نام گزارش حداکثر ۱۲۰ نویسه است."})
    return value


def _sharing(workspace, actor, data, request=None):
    visibility = data.get("visibility", SavedReport.Visibility.PERSONAL)
    if visibility not in SavedReport.Visibility.values:
        raise ValidationError({"visibility": "نوع دسترسی گزارش معتبر نیست."})
    if visibility == SavedReport.Visibility.PERSONAL:
        return visibility, [], []
    _require(actor, workspace, "Report.Share", request, "مجوز اشتراک‌گذاری گزارش را ندارید.")
    roles = [str(v) for v in data.get("shared_roles") or []]
    units = [str(v) for v in data.get("shared_units") or []]
    if not roles and not units:
        raise ValidationError({"shared_roles": "برای اشتراک دست‌کم یک نقش یا واحد انتخاب کنید."})
    try:
        for value in roles + units:
            UUID(value)
    except ValueError:
        raise ValidationError({"shared_roles": "شناسهٔ نقش یا واحد معتبر نیست."})
    valid_roles = {
        str(v)
        for v in OrganizationRole.objects.filter(workspace=workspace, id__in=roles, is_active=True).values_list(
            "id", flat=True
        )
    }
    valid_units = {
        str(v)
        for v in OrganizationUnit.objects.filter(workspace=workspace, id__in=units, is_active=True).values_list(
            "id", flat=True
        )
    }
    if set(roles) - valid_roles or set(units) - valid_units:
        raise ValidationError({"shared_roles": "نقش یا واحد انتخاب‌شده در این شرکت وجود ندارد."})
    return visibility, sorted(valid_roles), sorted(valid_units)


def create(workspace, actor, data, request=None):
    _require(actor, workspace, "Report.Build", request, "مجوز ساخت و ذخیرهٔ گزارش را ندارید.")
    source = sources.get_source(data.get("source"))
    definition = sources.validate(source, data.get("definition"))
    limit = reports.policy(workspace)["personal_report_limit"]
    if SavedReport.objects.filter(workspace=workspace, owner=actor).count() >= limit:
        raise ValidationError({"name": f"حداکثر {reports.fa(limit)} گزارش ذخیره‌شده برای هر فرد مجاز است."})
    visibility, roles, units = _sharing(workspace, actor, data, request)
    with transaction.atomic():
        row = SavedReport(
            workspace=workspace,
            owner=actor,
            name=_name(data.get("name")),
            description=str(data.get("description") or "")[:1000],
            source=source.code,
            definition=definition,
            schema_version=source.version,
            visibility=visibility,
            shared_roles=roles,
            shared_units=units,
        )
        row.save(created_by_id=actor.id)
        reports.audit(workspace, actor, "saved_report.created", row.id, after=_snapshot(row))
    return row


def _snapshot(row):
    return {
        "name": row.name,
        "description": row.description,
        "source": row.source,
        "definition": row.definition,
        "schema_version": row.schema_version,
        "visibility": row.visibility,
        "shared_roles": row.shared_roles,
        "shared_units": row.shared_units,
    }


def _owned(workspace, actor, report_id, lock=False):
    rows = SavedReport.objects.filter(workspace=workspace, id=report_id)
    if lock:
        rows = rows.select_for_update()
    row = rows.first()
    if row is None or row.owner_id != actor.id:
        # A recipient (or anyone else) cannot tell an existing report from a missing one.
        if row is not None and any(r.id == row.id for r in visible(workspace, actor)):
            raise PermissionDenied("فقط سازندهٔ گزارش می‌تواند آن را ویرایش یا حذف کند.")
        raise NotFound("گزارش پیدا نشد.")
    return row


def update(workspace, actor, report_id, data, request=None):
    with transaction.atomic():
        row = _owned(workspace, actor, report_id, lock=True)
        _require(actor, workspace, "Report.Build", request, "مجوز ساخت و ذخیرهٔ گزارش را ندارید.")
        revision = data.get("revision")
        if revision is not None and revision != row.revision:
            raise Conflict("این گزارش هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.")
        before = _snapshot(row)
        if "name" in data:
            row.name = _name(data["name"])
        if "description" in data:
            row.description = str(data.get("description") or "")[:1000]
        if "definition" in data or "source" in data:
            source = sources.get_source(data.get("source", row.source))
            row.source = source.code
            row.definition = sources.validate(source, data.get("definition", row.definition))
            row.schema_version = source.version
        if any(key in data for key in ("visibility", "shared_roles", "shared_units")):
            row.visibility, row.shared_roles, row.shared_units = _sharing(
                workspace, actor, {**_snapshot(row), **data}, request
            )
        row.revision += 1
        row.save()
        reports.audit(workspace, actor, "saved_report.updated", row.id, before=before, after=_snapshot(row))
    return row


def copy(workspace, actor, report_id, request=None):
    original = get(workspace, actor, report_id)
    _require(actor, workspace, "Report.Build", request, "مجوز ساخت و ذخیرهٔ گزارش را ندارید.")
    limit = reports.policy(workspace)["personal_report_limit"]
    if SavedReport.objects.filter(workspace=workspace, owner=actor).count() >= limit:
        raise ValidationError({"name": f"حداکثر {reports.fa(limit)} گزارش ذخیره‌شده برای هر فرد مجاز است."})
    with transaction.atomic():
        row = SavedReport(
            workspace=workspace,
            owner=actor,
            name=f"نسخه از {original.name}"[:120],
            description=original.description,
            source=original.source,
            definition=original.definition,
            schema_version=original.schema_version,
        )
        row.save(created_by_id=actor.id)
        reports.audit(
            workspace, actor, "saved_report.copied", row.id, after=_snapshot(row), copied_from=str(original.id)
        )
    return row


def delete(workspace, actor, report_id, request=None):
    with transaction.atomic():
        row = _owned(workspace, actor, report_id, lock=True)
        before = _snapshot(row)
        row.delete()
        reports.audit(workspace, actor, "saved_report.deleted", row.id, before=before)


def share_options(workspace):
    return {
        "roles": [
            {"id": str(r.id), "name": r.name}
            for r in OrganizationRole.objects.filter(workspace=workspace, is_active=True).order_by("name")
        ],
        "units": [
            {"id": str(u.id), "name": u.title}
            for u in OrganizationUnit.objects.filter(workspace=workspace, is_active=True).order_by("title")
        ],
    }


def run_saved(workspace, viewer, report_id, *, overrides=None, page=1, page_size=50, request=None, now=None):
    row = get(workspace, viewer, report_id)
    definition = dict(row.definition or {})
    for key in ("filters", "range", "sort", "columns", "group_by", "aggregates"):
        if overrides and key in overrides:
            definition[key] = overrides[key]
    result = sources.run(
        workspace, viewer, row.source, definition, page=page, page_size=page_size, request=request, now=now, saved=row
    )
    result["saved"] = payload(row, viewer, request)
    return result


# Dashboard hook (decision 8.10): a dashboard widget may reference a saved report by id and render
# ``run_saved(...)["aggregates"]`` for the *viewing* user. No widget is shipped in ticket 8.
def dashboard_reference(workspace, viewer, report_id, request=None):
    result = run_saved(workspace, viewer, report_id, page=1, page_size=1, request=request)
    return {
        "id": str(report_id),
        "title": result["saved"]["name"],
        "total": result["total"],
        "aggregates": result["aggregates"],
    }
