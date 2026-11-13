"""Ticket 7 — cost estimates ("quotes") of a ticket, on the entity engine (decision 7.7).

A quote version is an ordinary ``EntityRecord`` of the configured entity ``quote``
(created on first use from engine configuration only: an ``EntityType``, library
``FieldDefinition`` rows, a ``quote-status`` lookup and a published form — no table of
its own). Its data holds amount (rial), item description, validity date, version and
status; ``quote_ticket`` ties it to the ticket.

Life cycle: draft → sent → approved | rejected | revision_requested; a revision is a
new version (a new record). After the customer's decision a version is locked: no
service path edits it and engine writes on the quote entity are refused.

A decision is one ``EntityEvent`` ``quote.decided`` on the version (date, portal
account, optional comment); the partial unique constraint ``crm_quote_one_decision``
plus a row lock make a second or concurrent decision impossible. IP and user agent go
to the portal audit log, not here.

Financial boundary: nothing here creates an invoice, a ledger row, a payment or calls a
finance system. :data:`quote_approved` is a documented extension point with **no**
receiver in this code base.
"""

from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.dispatch import Signal
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityType,
    FieldDefinition,
    FormLayout,
    FormVersion,
    LookupCategory,
    LookupValue,
    SystemIdentifierCounter,
)

from . import ticket_core

# Extension point for a future, separately approved finance integration. No receivers.
quote_approved = Signal()

CODE = "quote"
DRAFT, SENT, APPROVED, REJECTED, REVISION = "draft", "sent", "approved", "rejected", "revision_requested"
STATUS_TITLES = {
    DRAFT: "پیش‌نویس",
    SENT: "ارسال‌شده به مشتری",
    APPROVED: "تأییدشده",
    REJECTED: "ردشده",
    REVISION: "درخواست اصلاح",
}
DECISIONS = (APPROVED, REJECTED, REVISION)
FIELDS = (
    ("quote_ticket", "تیکت", "short_text", {}),
    ("quote_version", "نسخه", "integer", {}),
    ("quote_amount", "مبلغ برآورد", "money", {"unit": "ریال", "min": 0}),
    ("quote_items", "شرح اقلام", "long_text", {}),
    ("quote_valid_until", "اعتبار تا", "date", {}),
    ("quote_status", "وضعیت برآورد", "select", {}),
)
MAX_AMOUNT = Decimal("1000000000000000")


class Conflict(APIException):
    status_code = 409
    default_detail = "برای این نسخه قبلاً تصمیم ثبت شده است."


def ensure_entity(workspace, actor=None):
    """Idempotent engine configuration of the quote entity (no schema change)."""
    entity = EntityType.objects.filter(workspace=workspace, code=CODE, parent__isnull=True).first()
    if entity is not None:
        return entity
    with transaction.atomic():
        category, _ = LookupCategory.objects.get_or_create(
            workspace=workspace, code="quote-status", defaults={"title": "وضعیت برآورد", "is_system": True}
        )
        for position, (code, title) in enumerate(STATUS_TITLES.items()):
            LookupValue.objects.get_or_create(
                category=category, code=code, defaults={"title": title, "position": position}
            )
        permissions = {action: "Quote.Manage" for action in ("view", "view_all", "create", "edit", "delete")}
        entity = EntityType.objects.create(
            workspace=workspace,
            code=CODE,
            title="برآورد هزینه",
            icon="receipt",
            numbering={"prefix": "Q-", "padding": 4},
            record_permissions=permissions,
            title_field="quote_items",
        )
        bindings = []
        for code, title, kind, config in FIELDS:
            field, _ = FieldDefinition.objects.get_or_create(
                workspace=workspace,
                code=code,
                defaults={
                    "title": title,
                    "kind": kind,
                    "config": config,
                    "lookup": category if kind == "select" else None,
                    "hidden_from_form": code == "quote_ticket",
                },
            )
            bindings.append({"field": field.code})
        layout = {"tabs": [], "sections": [{"id": "quote", "title": "برآورد", "columns": 2, "bindings": bindings}]}
        form = FormLayout.objects.create(entity=entity, draft=layout)
        form.published = FormVersion.objects.create(layout=form, number=1, schema=layout, change_note="برآورد هزینه")
        form.save()
    return entity


def engine_write_refused(entity):
    """Engine create/edit/delete of a quote would bypass the version lock; only this service writes."""
    return entity.code == CODE and entity.parent_id is None


def _amount(value):
    try:
        amount = Decimal(str(value)).quantize(Decimal("1"))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({"amount": "مبلغ را به ریال و به‌صورت عدد وارد کنید."})
    if amount < 0 or amount > MAX_AMOUNT:
        raise ValidationError({"amount": "مبلغ معتبر نیست."})
    return str(amount)


def _valid_until(value):
    try:
        day = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError({"valid_until": "تاریخ اعتبار را انتخاب کنید."})
    if day < timezone.localdate():
        raise ValidationError({"valid_until": "تاریخ اعتبار نمی‌تواند در گذشته باشد."})
    return day.isoformat()


def _items(value):
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise ValidationError({"items": "شرح اقلام را وارد کنید."})
    if len(text) > 4000:
        raise ValidationError({"items": "حداکثر ۴۰۰۰ نویسه مجاز است."})
    return text


def versions(issue):
    entity = EntityType.objects.filter(workspace_id=issue.workspace_id, code=CODE, parent__isnull=True).first()
    if entity is None:
        return EntityRecord.objects.none()
    return EntityRecord.objects.filter(entity=entity, data__quote_ticket=str(issue.id), is_active=True).order_by(
        "-created_at"
    )


def _event(row, actor_id, event_type, **metadata):
    from .entity_records import json_value

    event = EntityEvent(
        workspace_id=row.workspace_id,
        entity_id=row.entity_id,
        record_id=row.id,
        event_type=event_type,
        metadata={k: json_value(v) for k, v in metadata.items()},
        created_by_id=actor_id,
    )
    event.save(created_by_id=actor_id, disable_auto_set_user=actor_id is None)
    return event


def _require_manager(actor, issue, request=None):
    if not ticket_core.has_permission(actor, issue.workspace, "Quote.Manage", request=request):
        raise PermissionDenied("مجوز «مدیریت برآورد هزینه» را ندارید.")
    if not issue.portal_account_id:
        raise ValidationError("برآورد فقط برای درخواست‌های ثبت‌شده از درگاه مشتری ارسال می‌شود.")


def create(workspace, actor, issue_id, data, request=None):
    """New draft: the first version, or the next one after a revision request."""
    issue = ticket_core.visible_ticket(workspace, actor, issue_id, request)
    _require_manager(actor, issue, request)
    entity = ensure_entity(workspace, actor)
    with transaction.atomic():
        rows = list(versions(issue).select_for_update())
        latest = rows[0] if rows else None
        status = (latest.data or {}).get("quote_status") if latest else None
        if status in (DRAFT, SENT):
            raise ValidationError("این تیکت یک برآورد باز دارد؛ ابتدا همان را ارسال یا تعیین تکلیف کنید.")
        if status == APPROVED:
            raise ValidationError("برآورد این تیکت تأیید شده است؛ نسخهٔ جدید ساخته نمی‌شود.")
        base = latest.data if latest else {}
        values = {
            "quote_ticket": str(issue.id),
            "quote_version": int(base.get("quote_version") or 0) + 1,
            "quote_amount": _amount(data.get("amount", base.get("quote_amount"))),
            "quote_items": _items(data.get("items", base.get("quote_items"))),
            "quote_valid_until": _valid_until(data.get("valid_until", base.get("quote_valid_until"))),
            "quote_status": DRAFT,
        }
        counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
        from .entity_identifiers import format_record_number
        from .entity_numbering import assign_numbers

        form = FormLayout.objects.filter(entity=entity).first()
        row = EntityRecord(
            entity=entity,
            workspace=workspace,
            number=format_record_number(entity, counter.advance()),
            data=values,
            form_version=form.published if form else None,
        )
        row.save(created_by_id=actor.id)
        assign_numbers(row)
        _event(
            row, actor.id, "quote.created", version=values["quote_version"], previous=str(latest.id) if latest else None
        )
        ticket_core.record(
            issue,
            actor,
            "quote.created",
            after=values["quote_version"],
            quote_id=str(row.id),
            amount=values["quote_amount"],
        )
    return row


def update_draft(workspace, actor, quote_id, data, request=None):
    with transaction.atomic():
        row = _locked(workspace, quote_id)
        issue = ticket_core.visible_ticket(workspace, actor, row.data.get("quote_ticket"), request)
        _require_manager(actor, issue, request)
        if row.data.get("quote_status") != DRAFT:
            raise ValidationError("فقط پیش‌نویس قابل ویرایش است؛ برای تغییر نسخهٔ ارسال‌شده نسخهٔ جدید بسازید.")
        before = dict(row.data)
        if "amount" in data:
            row.data["quote_amount"] = _amount(data["amount"])
        if "items" in data:
            row.data["quote_items"] = _items(data["items"])
        if "valid_until" in data:
            row.data["quote_valid_until"] = _valid_until(data["valid_until"])
        row.revision += 1
        row.save()
        _event(row, actor.id, "quote.draft_updated", before=before, after=row.data)
    return row


def send(workspace, actor, quote_id, request=None):
    from . import portal_notify, portal_settings

    with transaction.atomic():
        row = _locked(workspace, quote_id)
        issue = ticket_core.visible_ticket(workspace, actor, row.data.get("quote_ticket"), request)
        _require_manager(actor, issue, request)
        if row.data.get("quote_status") != DRAFT:
            raise ValidationError("این نسخه قبلاً ارسال شده است.")
        _valid_until(row.data.get("quote_valid_until"))
        row.data["quote_status"] = SENT
        row.revision += 1
        row.save()
        _event(row, actor.id, "quote.sent", version=row.data["quote_version"])
        ticket_core.record(issue, actor, "quote.sent", after=row.data["quote_version"], quote_id=str(row.id))
        portal_notify.notify_customer(issue, "quote", portal_settings.load(workspace), number=_ticket_number(issue))
    return row


def _locked(workspace, quote_id):
    entity = EntityType.objects.filter(workspace=workspace, code=CODE, parent__isnull=True).first()
    try:
        return EntityRecord.objects.select_for_update().get(entity=entity, id=quote_id, is_active=True)
    except (EntityRecord.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        raise NotFound("برآورد پیدا نشد.")


def _ticket_number(issue):
    return (
        EntityRecord.objects.filter(source_id=issue.id).values_list("number", flat=True).first()
        or f"#{issue.sequence_id}"
    )


def decide(account, quote_id, data):
    """The customer's decision on a sent version: once, dated, by this account, append-only."""
    from . import portal_access, portal_notify

    decision = data.get("decision")
    if decision not in DECISIONS:
        raise ValidationError({"decision": "تصمیم را انتخاب کنید (تأیید، رد یا درخواست اصلاح)."})
    comment = data.get("comment")
    comment = comment.strip() if isinstance(comment, str) else ""
    if len(comment) > 1000:
        raise ValidationError({"comment": "حداکثر ۱۰۰۰ نویسه مجاز است."})
    if decision == REVISION and not comment:
        raise ValidationError({"comment": "برای درخواست اصلاح، توضیح لازم است."})
    entity = EntityType.objects.filter(workspace_id=account.workspace_id, code=CODE, parent__isnull=True).first()
    try:
        with transaction.atomic():
            row = (
                EntityRecord.objects.select_for_update().filter(entity=entity, id=quote_id, is_active=True).first()
                if entity
                else None
            )
            if row is None:
                raise NotFound("برآورد پیدا نشد.")
            # Ownership: the quote's ticket must be one of this customer's requests; otherwise 404.
            issue = portal_access.own_request(account, row.data.get("quote_ticket"), lock=True)
            status = row.data.get("quote_status")
            if status == DRAFT:
                raise NotFound("برآورد پیدا نشد.")
            if status != SENT:
                raise Conflict()
            if date.fromisoformat(row.data["quote_valid_until"]) < timezone.localdate():
                raise ValidationError("مهلت اعتبار این برآورد گذشته است؛ نسخهٔ جدید را از تیم پشتیبانی بخواهید.")
            now = timezone.now()
            _event(
                row,
                None,
                "quote.decided",
                decision=decision,
                comment=comment,
                account_id=str(account.id),
                account=account.display_name,
                decided_at=now.isoformat(),
                version=row.data["quote_version"],
            )
            row.data["quote_status"] = decision
            row.revision += 1
            row.save(disable_auto_set_user=True)
            ticket_core.record(
                issue,
                None,
                f"quote.{decision}",
                after=row.data["quote_version"],
                quote_id=str(row.id),
                account_id=str(account.id),
                account=account.display_name,
                comment=comment,
            )
            portal_notify.notify_team(
                issue,
                "quote_decision",
                "تصمیم مشتری دربارهٔ برآورد",
                f"«{issue.name}» — نسخهٔ {row.data['quote_version']}: {STATUS_TITLES[decision]}",
            )
    except IntegrityError:
        raise Conflict()
    if decision == APPROVED:
        quote_approved.send(sender=EntityRecord, quote=row, issue=issue, account=account)
    return row


def _decision(row):
    event = EntityEvent.objects.filter(record_id=row.id, event_type="quote.decided").first()
    return event


def portal_payload(row):
    """Whitelist for the customer: never drafts, never internal ids or history."""
    data = row.data or {}
    status = data.get("quote_status")
    event = _decision(row)
    return {
        "id": str(row.id),
        "number": row.number,
        "version": data.get("quote_version"),
        "amount": data.get("quote_amount"),
        "items": data.get("quote_items"),
        "valid_until": data.get("quote_valid_until"),
        "status": {"code": status, "title": STATUS_TITLES.get(status, "")},
        "decided_at": (event.metadata or {}).get("decided_at") if event else None,
        "decision_comment": (event.metadata or {}).get("comment") if event else "",
        "can_decide": status == SENT and date.fromisoformat(data["quote_valid_until"]) >= timezone.localdate(),
    }


def portal_list(issue):
    return [portal_payload(row) for row in versions(issue) if (row.data or {}).get("quote_status") != DRAFT]


def internal_list(issue):
    rows = []
    for row in versions(issue):
        item = portal_payload(row)
        event = _decision(row)
        item["decided_by"] = (event.metadata or {}).get("account") if event else None
        item["can_edit"] = (row.data or {}).get("quote_status") == DRAFT
        item["can_send"] = (row.data or {}).get("quote_status") == DRAFT
        rows.append(item)
    return rows
