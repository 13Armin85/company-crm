"""Confirmed support intervals and traceable customer totals."""

from datetime import date, datetime, time, timedelta
from urllib.parse import urlencode
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import EntityEvent, EntityRecord, EntityRelationLink, EntityType, SupportActivity, User, WorkspaceMember
from .access_control import has_permission
from .entity_records import record_queryset, require_action
from .report_scope import people_scope, visible_ticket_ids
from .ticket_core import is_owner, visible_ticket
from .work_calendar import calendar_zone

MAX_RANGE = timedelta(days=1)
KIND_TITLES = dict(SupportActivity.Kind.choices)


def _customer_entity(workspace):
    entity = EntityType.objects.filter(workspace=workspace, code="customer", parent__isnull=True, is_active=True).first()
    if entity is None:
        raise ValidationError({"customer_id": "بخش مشتریان برای این شرکت تنظیم نشده است."})
    return entity


def _customer(workspace, actor, customer_id, request):
    entity = _customer_entity(workspace)
    require_action(entity, actor, "view", request)
    try:
        customer = record_queryset(entity, actor, request).filter(id=UUID(str(customer_id)), is_active=True).first()
    except (TypeError, ValueError):
        customer = None
    if customer is None:
        raise ValidationError({"customer_id": "مشتری پیدا نشد یا اجازهٔ دیدن آن را ندارید."})
    return customer


def _issue(workspace, actor, issue_id, customer, request):
    if not issue_id:
        return None
    issue = visible_ticket(workspace, actor, issue_id, request)
    if not is_owner(issue, actor, request):
        raise PermissionDenied("اجازهٔ ثبت فعالیت برای این تیکت را ندارید.")
    linked = EntityRelationLink.objects.filter(relation__deleted_at__isnull=True, deleted_at__isnull=True).filter(
        Q(left_id=issue.id, right_id=customer.id, relation__right_entity=customer.entity)
        | Q(right_id=issue.id, left_id=customer.id, relation__left_entity=customer.entity)
    )
    if not linked.exists():
        raise ValidationError({"customer_id": "مشتری انتخاب‌شده به این تیکت مرتبط نیست."})
    return issue


def _moment(raw, label):
    try:
        moment = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValidationError({label: "تاریخ و ساعت معتبر وارد کنید."})
    if timezone.is_naive(moment):
        raise ValidationError({label: "تاریخ و ساعت باید منطقهٔ زمانی داشته باشد."})
    return moment


def _values(workspace, actor, data, request):
    if data.get("confirm") is not True:
        raise ValidationError({"confirm": "زمان واقعی فعالیت را بررسی و ثبت آن را تأیید کنید."})
    kind = data.get("kind")
    if kind not in KIND_TITLES:
        raise ValidationError({"kind": "نوع فعالیت را انتخاب کنید."})
    starts_at = _moment(data.get("starts_at"), "starts_at")
    ends_at = _moment(data.get("ends_at"), "ends_at")
    span = ends_at - starts_at
    if span <= timedelta(0) or span > MAX_RANGE:
        raise ValidationError({"ends_at": "پایان باید پس از شروع و حداکثر ۲۴ ساعت بعد باشد."})
    if span.total_seconds() % 60:
        raise ValidationError({"ends_at": "بازهٔ فعالیت را با دقت دقیقه وارد کنید."})
    if ends_at > timezone.now():
        raise ValidationError({"ends_at": "فعالیت آینده را نمی‌توان انجام‌شده ثبت کرد."})
    customer = _customer(workspace, actor, data.get("customer_id"), request)
    issue = _issue(workspace, actor, data.get("issue_id"), customer, request)
    summary = data.get("summary") or ""
    if not isinstance(summary, str) or len(summary.strip()) > 2000:
        raise ValidationError({"summary": "خلاصهٔ فعالیت باید حداکثر ۲۰۰۰ نویسه باشد."})
    return {
        "customer": customer,
        "issue": issue,
        "kind": kind,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "duration_minutes": int(span.total_seconds() // 60),
        "summary": summary.strip(),
    }


def _snapshot(row):
    return {
        "customer_id": str(row.customer_id),
        "issue_id": str(row.issue_id) if row.issue_id else None,
        "supporter_id": str(row.supporter_id),
        "kind": row.kind,
        "starts_at": row.starts_at.isoformat(),
        "ends_at": row.ends_at.isoformat(),
        "duration_minutes": row.duration_minutes,
        "summary": row.summary,
    }


def _audit(row, actor, kind, before=None, reason=""):
    event = EntityEvent(
        workspace=row.workspace,
        entity=None,
        record_id=row.id,
        event_type=kind,
        before=before,
        after=_snapshot(row),
        metadata={"reason": reason, "actor_id": str(actor.id)},
    )
    event.save(created_by_id=actor.id)


def _require_member(workspace, actor, request):
    if not has_permission(actor, workspace, "Issue.Edit", request=request):
        raise PermissionDenied("مجوز ثبت فعالیت پشتیبانی را ندارید.")
    member = WorkspaceMember.objects.select_for_update().filter(
        workspace=workspace, member=actor, is_active=True, deleted_at__isnull=True
    ).first()
    if member is None:
        raise PermissionDenied("عضویت فعال در این شرکت پیدا نشد.")


def _check_overlap(workspace, supporter, starts_at, ends_at, exclude_id=None):
    overlap = SupportActivity.objects.filter(
        workspace=workspace,
        supporter=supporter,
        starts_at__lt=ends_at,
        ends_at__gt=starts_at,
    )
    if exclude_id:
        overlap = overlap.exclude(id=exclude_id)
    if overlap.exists():
        raise ValidationError({"starts_at": "این بازه با فعالیت ثبت‌شدهٔ دیگری هم‌پوشانی دارد؛ زمان را اصلاح کنید."})


def create(workspace, actor, data, request=None):
    with transaction.atomic():
        _require_member(workspace, actor, request)
        values = _values(workspace, actor, data, request)
        _check_overlap(workspace, actor, values["starts_at"], values["ends_at"])
        row = SupportActivity(workspace=workspace, supporter=actor, confirmed_at=timezone.now(), **values)
        row.save(created_by_id=actor.id)
        _audit(row, actor, "support_activity.confirmed")
        return row


def update(workspace, actor, activity_id, data, request=None):
    with transaction.atomic():
        _require_member(workspace, actor, request)
        row = SupportActivity.objects.select_for_update().filter(workspace=workspace, id=activity_id, supporter=actor).first()
        if row is None:
            raise NotFound("فعالیت پیدا نشد یا اجازهٔ ویرایش آن را ندارید.")
        if data.get("revision") != row.revision:
            raise ValidationError({"revision": "فعالیت تغییر کرده است؛ صفحه را تازه کنید."})
        reason = data.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValidationError({"reason": "دلیل اصلاح زمان یا اطلاعات فعالیت را بنویسید."})
        before = _snapshot(row)
        values = _values(workspace, actor, data, request)
        _check_overlap(workspace, actor, values["starts_at"], values["ends_at"], row.id)
        for key, value in values.items():
            setattr(row, key, value)
        row.confirmed_at = timezone.now()
        row.revision += 1
        row.updated_by = actor
        row.save(disable_auto_set_user=True)
        _audit(row, actor, "support_activity.corrected", before=before, reason=reason.strip())
        return row


def visible_rows(workspace, actor, request=None):
    customer = _customer_entity(workspace)
    require_action(customer, actor, "view", request)
    allowed_customers = record_queryset(customer, actor, request).values("id")
    rows = SupportActivity.objects.filter(workspace=workspace, customer_id__in=allowed_customers).filter(
        Q(issue__isnull=True) | Q(issue_id__in=visible_ticket_ids(actor, workspace, request))
    )
    rows = rows.filter(supporter_id__in=people_scope(actor, workspace, request=request).user_ids)
    return rows.select_related("customer", "customer__entity", "issue", "supporter")


def serialize(row, workspace):
    zone = calendar_zone(workspace)
    return {
        "id": str(row.id),
        "customer": {
            "id": str(row.customer_id),
            "title": (row.customer.data or {}).get(row.customer.entity.title_field) or row.customer.number,
        },
        "issue": {"id": str(row.issue_id), "title": row.issue.name} if row.issue_id else None,
        "supporter": {"id": str(row.supporter_id), "name": row.supporter.display_name or row.supporter.email},
        "kind": row.kind,
        "kind_label": KIND_TITLES[row.kind],
        "starts_at": row.starts_at.astimezone(zone).isoformat(),
        "ends_at": row.ends_at.astimezone(zone).isoformat(),
        "duration_minutes": row.duration_minutes,
        "summary": row.summary,
        "confirmed_at": row.confirmed_at.astimezone(zone).isoformat(),
        "revision": row.revision,
    }


def list_rows(workspace, actor, params, request=None):
    rows = _filtered_rows(workspace, actor, params, request)
    try:
        page = int(params.get("page") or 1)
        page_size = int(params.get("page_size") or 50)
    except (TypeError, ValueError):
        raise ValidationError({"page": "شمارهٔ صفحه یا اندازهٔ آن معتبر نیست."})
    if page < 1 or not 1 <= page_size <= 200:
        raise ValidationError({"page": "شمارهٔ صفحه باید مثبت و اندازهٔ صفحه حداکثر ۲۰۰ باشد."})
    offset = (page - 1) * page_size
    return {
        "results": [serialize(row, workspace) for row in rows.order_by("-starts_at", "-id")[offset : offset + page_size]],
        "total": rows.count(),
        "page": page,
        "page_size": page_size,
    }


def _filtered_rows(workspace, actor, params, request=None):
    rows = visible_rows(workspace, actor, request)
    for key in ("customer", "issue", "supporter"):
        value = params.get(key)
        if value:
            try:
                rows = rows.filter(**{f"{key}_id": UUID(value)})
            except ValueError:
                raise ValidationError({key: "شناسهٔ فیلتر معتبر نیست."})
    kind = params.get("kind")
    if kind:
        if kind not in KIND_TITLES:
            raise ValidationError({"kind": "نوع فعالیت معتبر نیست."})
        rows = rows.filter(kind=kind)
    ticket_type = params.get("ticket_type")
    if ticket_type:
        try:
            rows = rows.filter(issue__type_id=UUID(ticket_type))
        except ValueError:
            raise ValidationError({"ticket_type": "شناسهٔ نوع تیکت معتبر نیست."})
    result = params.get("result")
    if result:
        if result not in {"backlog", "unstarted", "started", "completed", "cancelled", "triage"}:
            raise ValidationError({"result": "نتیجهٔ تیکت معتبر نیست."})
        rows = rows.filter(issue__state__group=result)
    dates = {}
    for key in ("date_from", "date_to"):
        raw = params.get(key)
        if raw:
            try:
                dates[key] = date.fromisoformat(raw)
            except ValueError:
                raise ValidationError({key: "تاریخ فیلتر معتبر نیست."})
    if dates.get("date_from") and dates.get("date_to") and dates["date_to"] < dates["date_from"]:
        raise ValidationError({"date_to": "پایان بازه باید پس از شروع آن باشد."})
    zone = calendar_zone(workspace)
    if dates.get("date_from"):
        rows = rows.filter(starts_at__gte=datetime.combine(dates["date_from"], time.min, tzinfo=zone))
    if dates.get("date_to"):
        rows = rows.filter(starts_at__lt=datetime.combine(dates["date_to"] + timedelta(days=1), time.min, tzinfo=zone))
    return rows


def summary(workspace, actor, params, request=None):
    rows = _filtered_rows(workspace, actor, params, request)
    solved = Q(issue__type__name="با پشتیبانی حل شد", issue__state__group="completed")
    solved_total = rows.filter(solved).values("issue_id").distinct().count()
    grouped = list(
        rows.values("customer_id", "supporter_id", "kind")
        .annotate(minutes=Sum("duration_minutes"), count=Count("id"), resolved_tickets=Count("issue_id", filter=solved, distinct=True))
        .order_by("customer_id", "supporter_id", "kind")
    )
    customers = {
        row.id: row
        for row in EntityRecord.objects.select_related("entity").filter(id__in={r["customer_id"] for r in grouped})
    }
    users = {row.id: row for row in User.objects.filter(id__in={r["supporter_id"] for r in grouped})}
    filters = {key: params[key] for key in ("date_from", "date_to", "ticket_type", "result") if params.get(key)}
    result = []
    for group in grouped:
        customer = customers[group["customer_id"]]
        supporter = users[group["supporter_id"]]
        query = urlencode(
            {
                **filters,
                "customer": str(customer.id),
                "supporter": str(supporter.id),
                "kind": group["kind"],
            }
        )
        result.append(
            {
                "customer": {"id": str(customer.id), "title": (customer.data or {}).get(customer.entity.title_field) or customer.number},
                "supporter": {"id": str(supporter.id), "name": supporter.display_name or supporter.email},
                "kind": group["kind"],
                "kind_label": KIND_TITLES[group["kind"]],
                "duration_minutes": group["minutes"],
                "activity_count": group["count"],
                "resolved_ticket_count": group["resolved_tickets"],
                "drilldown": f"/support-activities?{query}",
            }
        )
    return {
        "groups": result,
        "duration_minutes": sum(group["duration_minutes"] for group in result),
        "resolved_ticket_count": solved_total,
    }
