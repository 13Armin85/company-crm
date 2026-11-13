"""Ticket 7 — customer requests are native tickets (decision 7.4).

Single source of truth for the portal life cycle of a ticket:

- submission creates an ``Issue`` (the ticket adapter row) with its engine record and
  number, ``portal_account`` = submitter (``created_by`` stays empty: no fake internal
  user), source ``portal`` when the company has a ``ticket-source`` field, a link to the
  customer through the existing ``customer ↔ ticket`` relation, the opening EXTERNAL
  message with its files, and then the **existing** ``TicketRoutingService.route_auto``
  (a matching rule, or the existing unassigned queue);
- triage (``Issue.portal_stage``): pending → accepted (starts the ticket's published
  workflow, if any) | rejected (customer-visible reason; ticket closed) |
  awaiting_customer (customer-visible question; pauses the running workflow step as
  "customer" when the step allows it); referral stays ticket 5's ``refer/``;
- feedback: one per ticket, only in the ``done`` category of ``ticket_core.work_category``,
  stored as ``EntityEvent`` rows (``portal.feedback`` unique, ``portal.feedback_edited``
  append-only), the current rating also projected to the ticket record data
  (``portal_rating``) so existing engine widgets can aggregate it.

Every step writes an append-only ``EntityEvent`` on the ticket (``portal.*``).
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityRelation,
    EntityRelationLink,
    FieldDefinition,
    FormLayout,
    Issue,
    IssueComment,
    SystemIdentifierCounter,
    WorkflowDefinition,
    WorkflowInstance,
)

from . import portal_files, portal_messages, portal_notify, portal_settings, quotes, ticket_core
from .access_control import has_permission
from .portal_access import own_request, request_queryset, root_entity

PAGE_SIZE = 20
STAGE_TITLES = portal_settings.STAGE_TITLES


class Conflict(APIException):
    status_code = 409
    default_detail = "بازخورد این درخواست قبلاً ثبت شده است."


# ------------------------------------------------------------------ helpers


def ticket_number(issue):
    number = EntityRecord.objects.filter(source_id=issue.id).values_list("number", flat=True).first()
    return number or f"#{issue.sequence_id}"


def _ticket_record(issue, entity):
    """The engine record (number) of the new ticket. The existing ``ensure_work_record`` signal
    normally created it already; otherwise it is created exactly as the engine does."""
    from .entity_identifiers import format_record_number
    from .entity_numbering import assign_numbers

    existing = EntityRecord.objects.filter(entity=entity, source_id=issue.id).first()
    if existing is not None:
        return existing
    counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
    form = FormLayout.objects.filter(entity=entity).first()
    row = EntityRecord(
        entity=entity,
        workspace=entity.workspace,
        source_id=issue.id,
        number=format_record_number(entity, counter.advance()),
        data={},
        form_version=form.published if form else None,
    )
    row.save(disable_auto_set_user=True)
    assign_numbers(row)
    return row


def _source_portal(record):
    """Set ``ticket-source = portal`` on the record when the company has such a field."""
    codes = list(
        FieldDefinition.objects.filter(
            workspace_id=record.workspace_id,
            lookup__code="ticket-source",
            lookup__values__code="portal",
            is_active=True,
        )
        .values_list("code", flat=True)
        .distinct()
    )
    for code in codes:
        record.data[code] = "portal"
    if codes:
        record.save(update_fields=["data", "updated_at"], disable_auto_set_user=True)
    return bool(codes)


def _link_customer(issue, account, ticket_entity):
    customer_entity = root_entity(issue.workspace_id, "customer")
    if customer_entity is None or ticket_entity is None:
        return None
    relation = (
        EntityRelation.objects.filter(deleted_at__isnull=True)
        .filter(
            Q(left_entity=customer_entity, right_entity=ticket_entity)
            | Q(left_entity=ticket_entity, right_entity=customer_entity)
        )
        .order_by("created_at")
        .first()
    )
    if relation is None:
        return None
    from .entity_relations import sync_projection

    customer_left = relation.left_entity_id == customer_entity.id
    left_id, right_id = (
        (account.customer_record_id, issue.id) if customer_left else (issue.id, account.customer_record_id)
    )
    link, _ = EntityRelationLink.objects.get_or_create(
        relation=relation, left_id=left_id, right_id=right_id, data_key=""
    )
    sync_projection(relation, "left", [left_id])
    sync_projection(relation, "right", [right_id])
    return link


def _subject(value):
    text = value.strip() if isinstance(value, str) else ""
    text = "".join(ch for ch in text if ord(ch) >= 32)
    if len(text) < 3:
        raise ValidationError({"subject": "موضوع درخواست را (دست‌کم ۳ نویسه) وارد کنید."})
    if len(text) > 200:
        raise ValidationError({"subject": "موضوع حداکثر می‌تواند ۲۰۰ نویسه باشد."})
    return text


# ------------------------------------------------------------------ customer side


def create_request(account, data, uploads):
    workspace = account.workspace
    config = portal_settings.load(workspace)
    subject = _subject(data.get("subject"))
    description = portal_messages.clean_text(data.get("description"), "description", minimum=10)
    checked = portal_files.validate_uploads(uploads, config)
    entity = ticket_core.root_entity(workspace.id)
    if entity is None:
        raise ValidationError("ثبت درخواست در این شرکت فعال نیست.")
    with transaction.atomic():
        issue = Issue(
            workspace=workspace,
            name=subject,
            description_html=portal_messages.to_html(description),
            portal_account=account,
            portal_stage="pending",
        )
        issue.save(disable_auto_set_user=True)
        record = _ticket_record(issue, entity)
        sourced = _source_portal(record)
        linked = _link_customer(issue, account, entity)
        portal_messages.post(
            issue, text=description, access=portal_messages.EXTERNAL, account=account, checked_files=checked
        )
        ticket_core.record(
            issue,
            None,
            "portal.request_submitted",
            account_id=str(account.id),
            account=account.display_name,
            customer_id=str(account.customer_record_id),
            files=len(checked),
            source="portal" if sourced else "",
            customer_linked=bool(linked),
        )
        from .ticket_routing import TicketRoutingService

        decision = TicketRoutingService.route_auto(issue, actor_id=None)
    return issue, decision


def _seen_at(account, issue):
    value = (account.seen or {}).get(str(issue.id))
    if not value:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _latest_update(issue):
    """Last moment something the customer can see changed: a team reply, status or quote."""
    moments = [issue.updated_at]
    staff = portal_messages.last_external_at(issue, from_staff=True)
    if staff:
        moments.append(staff)
    quote = quotes.versions(issue).exclude(data__quote_status=quotes.DRAFT).values_list("updated_at", flat=True).first()
    if quote:
        moments.append(quote)
    return max(m for m in moments if m)


def _unread(account, issue):
    seen = _seen_at(account, issue)
    staff = portal_messages.last_external_at(issue, from_staff=True)
    quote = quotes.versions(issue).exclude(data__quote_status=quotes.DRAFT).values_list("updated_at", flat=True).first()
    latest = max([m for m in (staff, quote) if m], default=None)
    if latest is None:
        return False
    return seen is None or latest > seen


def summary(account, issue, config):
    status = portal_settings.customer_status(issue, config)
    return {
        "id": str(issue.id),
        "number": ticket_number(issue),
        "subject": issue.name,
        "status": status,
        "created_at": ticket_core.iso(issue.created_at, issue.workspace),
        "updated_at": ticket_core.iso(_latest_update(issue), issue.workspace),
        "unread": _unread(account, issue) if account.notify_portal else False,
    }


def list_requests(account, params):
    config = portal_settings.load(account.workspace)
    rows = request_queryset(account).select_related("state", "workspace").order_by("-created_at")
    search = (params.get("q") or "").strip()[:100]
    if search:
        numbers = EntityRecord.objects.filter(number__icontains=search).values("source_id")
        rows = rows.filter(Q(name__icontains=search) | Q(id__in=numbers))
    items = [summary(account, issue, config) for issue in rows[:1000]]
    wanted = params.get("status")
    if wanted:
        items = [item for item in items if item["status"]["code"] == wanted]
    try:
        page = max(1, int(params.get("page") or 1))
    except ValueError:
        page = 1
    total = len(items)
    return {
        "results": items[(page - 1) * PAGE_SIZE : page * PAGE_SIZE],
        "count": total,
        "page": page,
        "pages": max(1, -(-total // PAGE_SIZE)),
        "statuses": config["labels"],
        "unread": sum(1 for item in items if item["unread"]),
    }


def feedback_state(issue, config):
    first = EntityEvent.objects.filter(record_id=issue.id, event_type="portal.feedback").first()
    if first is None:
        return None
    edits = EntityEvent.objects.filter(record_id=issue.id, event_type="portal.feedback_edited").order_by("-created_at")
    current = (edits.first() or first).metadata
    until = first.created_at + timedelta(hours=config["feedback_edit_hours"])
    return {
        "rating": current.get("rating"),
        "comment": current.get("comment", ""),
        "submitted_at": ticket_core.iso(first.created_at, issue.workspace),
        "edited": edits.exists(),
        "editable_until": ticket_core.iso(until, issue.workspace),
        "can_edit": timezone.now() <= until,
    }


def can_give_feedback(issue):
    return ticket_core.category_of(issue) == ticket_core.DONE and issue.portal_stage != "rejected"


def detail(account, issue_id, *, mark_seen=True):
    issue = own_request(account, issue_id)
    config = portal_settings.load(account.workspace)
    payload = {
        **summary(account, issue, config),
        "messages": portal_messages.portal_thread(issue, config),
        "quotes": quotes.portal_list(issue),
        "feedback": feedback_state(issue, config),
        "can_feedback": can_give_feedback(issue),
        "can_message": issue.portal_stage != "rejected",
        "files": {
            "max_count": config["files"]["max_count"],
            "max_size": config["files"]["max_size"],
            "extensions": config["files"]["extensions"],
        },
    }
    if mark_seen:
        account.seen = {**(account.seen or {}), str(issue.id): timezone.now().isoformat()}
        if len(account.seen) > 500:
            account.seen = dict(sorted(account.seen.items(), key=lambda kv: kv[1])[-500:])
        type(account).objects.filter(id=account.id).update(seen=account.seen)
        payload["unread"] = False
    return payload


def by_number(account, number):
    record = (
        EntityRecord.objects.filter(number=str(number)[:120], source_id__in=request_queryset(account).values("id"))
        .values_list("source_id", flat=True)
        .first()
    )
    return detail(account, record, mark_seen=False)


def customer_message(account, issue_id, data, uploads):
    config = portal_settings.load(account.workspace)
    text = portal_messages.clean_text(data.get("text"))
    checked = portal_files.validate_uploads(uploads, config)
    with transaction.atomic():
        issue = own_request(account, issue_id, lock=True)
        if issue.portal_stage == "rejected":
            raise ValidationError("این درخواست رد شده است و پیام جدید نمی‌پذیرد.")
        comment, files = portal_messages.post(
            issue, text=text, access=portal_messages.EXTERNAL, account=account, checked_files=checked
        )
        ticket_core.record(
            issue,
            None,
            "portal.customer_message",
            comment_id=str(comment.id),
            account_id=str(account.id),
            files=len(files),
        )
        if issue.portal_stage == "awaiting_customer":
            asked = (
                EntityEvent.objects.filter(record_id=issue.id, event_type="portal.info_requested")
                .order_by("-created_at")
                .first()
            )
            previous = (asked.metadata or {}).get("previous_stage") if asked else "pending"
            issue.portal_stage = previous if previous in ("pending", "accepted") else "pending"
            issue.save(update_fields=["portal_stage", "updated_at"], disable_auto_set_user=True)
            ticket_core.record(
                issue,
                None,
                "portal.info_provided",
                field="portal_stage",
                before="awaiting_customer",
                after=issue.portal_stage,
            )
        portal_notify.notify_team(issue, "customer_message", "پیام جدید مشتری", f"«{issue.name}» — {text[:120]}")
    return portal_messages.portal_message(comment, config, files)


def submit_feedback(account, issue_id, data):
    rating = data.get("rating")
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        raise ValidationError({"rating": "امتیاز باید عددی بین ۱ تا ۵ باشد."})
    comment = data.get("comment")
    comment = comment.strip() if isinstance(comment, str) else ""
    if len(comment) > 2000:
        raise ValidationError({"comment": "حداکثر ۲۰۰۰ نویسه مجاز است."})
    config = portal_settings.load(account.workspace)
    try:
        with transaction.atomic():
            issue = own_request(account, issue_id, lock=True)
            if not can_give_feedback(issue):
                raise ValidationError("بازخورد فقط پس از انجام‌شدن درخواست ثبت می‌شود.")
            existing = EntityEvent.objects.filter(record_id=issue.id, event_type="portal.feedback").first()
            if existing is not None:
                if timezone.now() > existing.created_at + timedelta(hours=config["feedback_edit_hours"]):
                    raise PermissionDenied("مهلت ویرایش بازخورد به پایان رسیده است.")
                previous = feedback_state(issue, config)
                ticket_core.record(
                    issue,
                    None,
                    "portal.feedback_edited",
                    before=previous["rating"],
                    after=rating,
                    rating=rating,
                    comment=comment,
                    account_id=str(account.id),
                )
            else:
                ticket_core.record(
                    issue,
                    None,
                    "portal.feedback",
                    after=rating,
                    rating=rating,
                    comment=comment,
                    account_id=str(account.id),
                    account=account.display_name,
                )
            _project_rating(issue, rating)
            portal_notify.notify_team(issue, "feedback", "بازخورد مشتری", f"«{issue.name}» — امتیاز {rating} از ۵")
    except IntegrityError:
        raise Conflict()
    return feedback_state(issue, config)


def _project_rating(issue, rating):
    FieldDefinition.objects.get_or_create(
        workspace_id=issue.workspace_id,
        code="portal_rating",
        defaults={"title": "امتیاز مشتری", "kind": "rating", "config": {"stars": 5}, "hidden_from_form": True},
    )
    record = EntityRecord.objects.select_for_update().filter(source_id=issue.id).first()
    if record is not None:
        record.data = {**(record.data or {}), "portal_rating": rating}
        record.revision += 1
        record.save(update_fields=["data", "revision", "updated_at"], disable_auto_set_user=True)


# ------------------------------------------------------------------ internal side (ticket panel)


def _require(user, workspace, code, request=None):
    if not has_permission(user, workspace, code, request=request):
        raise PermissionDenied("اجازهٔ انجام این عملیات را ندارید.")


def internal_summary(workspace, user, issue_id, request=None):
    issue = ticket_core.visible_ticket(workspace, user, issue_id, request)
    config = portal_settings.load(workspace)
    portal = bool(issue.portal_account_id)
    owner = ticket_core.is_owner(issue, user, request)
    can = {
        "note": owner,
        "reply": portal and owner and has_permission(user, workspace, "Portal.Reply", request=request),
        "triage": portal
        and issue.portal_stage in ("pending", "awaiting_customer")
        and has_permission(user, workspace, "Portal.Request.Triage", request=request),
        "quote": portal
        and issue.portal_stage != "rejected"
        and has_permission(user, workspace, "Quote.Manage", request=request),
        "feedback": has_permission(user, workspace, "Portal.Feedback.View", request=request),
    }
    account = issue.portal_account if portal else None
    return {
        "is_portal": portal,
        "stage": issue.portal_stage,
        "stage_title": STAGE_TITLES.get(issue.portal_stage, ""),
        "customer_status": portal_settings.customer_status(issue, config) if portal else None,
        "account": (
            {"display_name": account.display_name, "customer": str(account.customer_record_id)} if account else None
        ),
        "messages": portal_messages.internal_thread(issue),
        "quotes": quotes.internal_list(issue) if portal else [],
        "feedback": feedback_state(issue, config) if portal and can["feedback"] else None,
        "can": can,
        "staff_name": config["staff_name"],
        "team_name": config["team_name"],
    }


def internal_message(workspace, user, issue_id, data, uploads, request=None):
    access = data.get("access") or portal_messages.INTERNAL
    text = portal_messages.clean_text(data.get("text"))
    config = portal_settings.load(workspace)
    checked = portal_files.validate_uploads(uploads, config)
    with transaction.atomic():
        issue = ticket_core.visible_ticket(workspace, user, issue_id, request)
        ticket_core.require_owner(issue, user, request)
        if access == portal_messages.EXTERNAL:
            _require(user, workspace, "Portal.Reply", request)
            if not issue.portal_account_id:
                raise ValidationError("این تیکت از درگاه مشتری ثبت نشده است؛ فقط یادداشت داخلی ممکن است.")
        comment, files = portal_messages.post(issue, text=text, access=access, staff=user, checked_files=checked)
        ticket_core.record(
            issue,
            user,
            "portal.reply" if access == portal_messages.EXTERNAL else "portal.internal_note",
            comment_id=str(comment.id),
            files=len(files),
            access=access,
        )
    if access == portal_messages.EXTERNAL:
        portal_notify.notify_customer(issue, "reply", config, number=ticket_number(issue))
    return comment


def _running_instance(issue):
    return (
        WorkflowInstance.objects.filter(
            workspace_id=issue.workspace_id, record_id=issue.id, status=WorkflowInstance.Status.RUNNING
        )
        .exclude(definition__kind=WorkflowDefinition.Kind.FAST_PATH)
        .first()
    )


def triage(workspace, user, issue_id, data, request=None):
    action = data.get("action")
    if action not in ("approve", "reject", "need_info"):
        raise ValidationError({"action": "اقدام تریاژ معتبر نیست."})
    _require(user, workspace, "Portal.Request.Triage", request)
    message = data.get("message")
    with transaction.atomic():
        visible = ticket_core.visible_ticket(workspace, user, issue_id, request)
        issue = Issue.objects.select_for_update(of=("self",)).select_related("state", "workspace").get(id=visible.id)
        if not issue.portal_account_id:
            raise ValidationError("این تیکت از درگاه مشتری ثبت نشده است.")
        if issue.portal_stage not in ("pending", "awaiting_customer"):
            raise ValidationError("این درخواست قبلاً تعیین تکلیف شده است.")
        before = issue.portal_stage
        details = {}
        if action == "approve":
            issue.portal_stage = "accepted"
            issue.save(update_fields=["portal_stage", "updated_at"])
            if message:
                text = portal_messages.clean_text(message, "message")
                portal_messages.post(issue, text=text, access=portal_messages.EXTERNAL, staff=user, kind="approval")
            from .workflow_actions import auto_start

            entity = ticket_core.root_entity(workspace.id)
            instance = auto_start(entity, None, issue.id, user, request) if entity else None
            details["workflow_started"] = bool(instance)
            event = "portal.request_approved"
        elif action == "reject":
            text = portal_messages.clean_text(message, "message")
            portal_messages.post(issue, text=text, access=portal_messages.EXTERNAL, staff=user, kind="rejection")
            issue.portal_stage = "rejected"
            issue.save(update_fields=["portal_stage", "updated_at"])
            if ticket_core.category_of(issue) != ticket_core.DONE:
                ticket_core._close_ticket(issue, user)
            details["reason"] = text
            event = "portal.request_rejected"
        else:
            text = portal_messages.clean_text(message, "message")
            portal_messages.post(issue, text=text, access=portal_messages.EXTERNAL, staff=user, kind="info_request")
            issue.portal_stage = "awaiting_customer"
            issue.save(update_fields=["portal_stage", "updated_at"])
            details["paused"] = _pause_for_customer(workspace, user, issue, text)
            details["previous_stage"] = before
            event = "portal.info_requested"
        ticket_core.record(issue, user, event, field="portal_stage", before=before, after=issue.portal_stage, **details)
    config = portal_settings.load(workspace)
    portal_notify.notify_customer(
        issue,
        "status",
        config,
        number=ticket_number(issue),
        status=portal_settings.customer_status(issue, config)["title"],
    )
    return issue


def _pause_for_customer(workspace, user, issue, reason):
    """Pause the running step as "waiting for customer" when the step allows it; else the stage alone."""
    instance = _running_instance(issue)
    if instance is None:
        return False
    from . import workflow_actions

    try:
        with transaction.atomic():
            workflow_actions.pause(
                workspace, user, instance.id, {"kind": "customer", "reason": reason, "revision": instance.revision}
            )
        return True
    except (ValidationError, PermissionDenied):
        return False


def notify_contact(issue, actor, contact, request=None):
    """Decision 7.10: with "inform the customer" the contact summary becomes an EXTERNAL message."""
    _require(actor, issue.workspace, "Portal.Reply", request)
    if not issue.portal_account_id:
        raise ValidationError({"notify_customer": "این تیکت از درگاه مشتری ثبت نشده است."})
    text = f"خلاصهٔ تماس ({contact['channel_title']}، {contact['contact_text']}): {contact['summary']}" + (
        "\nنتیجه: حل شد." if contact["resolved"] else "\nنتیجه: پیگیری ادامه دارد."
    )
    comment, _ = portal_messages.post(issue, text=text, access=portal_messages.EXTERNAL, staff=actor, kind="contact")
    return comment


def thread_comment(issue_id, comment_id):
    return IssueComment.objects.filter(issue_id=issue_id, id=comment_id).first()
