"""Workflow engine, write side: the only module that changes workflow rows.

Invariants:
- every write runs in ``transaction.atomic`` and locks the instance row with
  ``select_for_update``; instance actions require the caller's ``revision``
  and answer 409 on a stale one, so two concurrent decisions cannot both apply;
- every change records a ``WorkflowDecision`` and an ``EntityEvent`` on the
  record (actor, time, before/after, reason, version number);
- nothing is overwritten silently or hard-deleted; published versions are
  never edited; a running instance changes version only through ``migrate``;
- record statuses are written only through ``entity_records.apply_workflow_status``.
"""

from datetime import datetime

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import (
    EntityType,
    User,
    WorkflowDecision,
    WorkflowDefinition,
    WorkflowDelayReport,
    WorkflowExtension,
    WorkflowInstance,
    WorkflowPause,
    WorkflowStepRun,
    WorkflowVersion,
)
from . import workflow_engine as engine
from .access_control import has_permission
from .crm_notifications import notify_members
from .entity_records import apply_workflow_status, emit, emit_definition, save_record
from .entity_rules import condition
from .work_calendar import add_working_time, calendar_zone, working_minutes_between

MAX_STEPS = 60
MAX_TRANSITIONS = 200


# ---------------------------------------------------------------- helpers


def _reason(data, required=True, key="reason"):
    value = data.get(key)
    value = value.strip() if isinstance(value, str) else ""
    if required and not value:
        raise ValidationError({key: "ثبت دلیل الزامی است."})
    if len(value) > 2000:
        raise ValidationError({key: "دلیل حداکثر می‌تواند ۲۰۰۰ نویسه باشد."})
    return value


def _moment(value, label, workspace):
    if not isinstance(value, str) or not value:
        raise ValidationError({label: "زمان را انتخاب کنید."})
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError({label: "قالب زمان معتبر نیست."})
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=calendar_zone(workspace))
    return parsed


def _member(workspace, user_id, label="user"):
    try:
        user = (
            User.objects.filter(
                id=user_id,
                is_active=True,
                member_workspace__workspace=workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            )
            .distinct()
            .first()
        )
    except (ValueError, TypeError, DjangoValidationError):
        user = None
    if user is None:
        raise ValidationError({label: "این فرد عضو فعال این شرکت نیست."})
    return user


def _audit(instance, actor, event_type, before=None, after=None, reason="", **extra):
    if actor is None:
        return None
    return emit(
        instance.entity,
        actor,
        event_type,
        instance.record_id,
        before=before,
        after=after,
        metadata={
            "reason": reason,
            "actor_id": str(actor.id),
            "workflow_instance": str(instance.id),
            "workflow_definition": str(instance.definition_id),
            "workflow_version": instance.version.number,
            **extra,
        },
    )


def _audit_definition(workspace, actor, event_type, row, before, after, reason=""):
    event = emit_definition(workspace, actor, event_type, row, before, after)
    event.metadata = {**event.metadata, "reason": reason, "actor_id": str(actor.id)}
    event.save(update_fields=["metadata"])
    return event


def _decide(instance, run, kind, actor, *, reason="", transition="", from_step="", to_step="", changed=None, data=None):
    return WorkflowDecision.objects.create(
        instance=instance,
        step_run=run,
        kind=kind,
        transition_code=transition or "",
        from_step=from_step or "",
        to_step=to_step or "",
        actor=actor,
        version_number=instance.version.number,
        reason=reason,
        changed_values=engine.json_safe(changed or {}),
        data=data or {},
    )


def _locked_instance(workspace, instance_id, revision):
    try:
        instance = (
            WorkflowInstance.objects.select_for_update(of=("self",))
            .select_related("version", "definition", "entity", "workspace", "subject")
            .get(workspace=workspace, id=instance_id)
        )
    except (WorkflowInstance.DoesNotExist, ValueError, ValidationError):
        raise NotFound("فرایند گردش‌کار پیدا نشد.")
    if revision is None or isinstance(revision, bool) or not isinstance(revision, int):
        raise ValidationError({"revision": "شمارهٔ نسخهٔ فرایند ارسال نشده است؛ صفحه را تازه کنید."})
    if revision != instance.revision:
        raise engine.Conflict()
    return instance


def _bump(instance):
    instance.revision += 1
    instance.save()


def _require_running(instance):
    if instance.status != WorkflowInstance.Status.RUNNING:
        raise ValidationError("این فرایند در جریان نیست و اقدامی روی آن ممکن نیست.")


def _active_run(instance):
    run = (
        WorkflowStepRun.objects.select_for_update(of=("self",))
        .select_related("assignee")
        .filter(instance=instance, status=WorkflowStepRun.Status.ACTIVE)
        .first()
    )
    if run is None:
        raise ValidationError("این فرایند مرحلهٔ جاری ندارد.")
    return run


def _require_actor(actor, run, instance, now=None):
    role = engine.actor_role(actor, run, instance.workspace, now)
    if role is None:
        raise PermissionDenied("شما مسئول یا جانشین مسئول مرحلهٔ جاری نیستید.")
    return role


def _values(instance):
    row, native = engine.record_parts(instance.entity, instance.record_id)
    if row is None and native is None:
        raise NotFound("رکورد این فرایند پیدا نشد.")
    return engine.record_values(instance.entity, row, native)


def _close_run(run, decision, now):
    run.status = WorkflowStepRun.Status.COMPLETED
    run.completed_at = now
    run.decision = decision
    if run.paused_at:
        pause = run.pauses.filter(resumed_at__isnull=True).first()
        if pause:
            pause.resumed_at = now
            pause.resume_reason = "پایان مرحله"
            pause.save()
        run.paused_at = None
    run.save()


def _fail(instance, actor, message, now):
    instance.status = WorkflowInstance.Status.ERROR
    instance.error_message = message
    instance.save()
    _decide(instance, None, "error", actor, reason=message, from_step=instance.current_step)
    _audit(instance, actor, "workflow.error", None, {"message": message, "step": instance.current_step}, message)


def _enter(instance, step_code, actor, now, *, explicit=None, reason=""):
    """Enter a step: status, assignee, deadline, then any automatic transitions (bounded)."""
    steps = engine.steps_of(instance.version.graph)
    while True:
        step = steps[step_code]
        instance.current_step = step_code
        if step.get("status_code"):
            apply_workflow_status(
                instance.entity,
                actor,
                instance.record_id,
                step["status_code"],
                {
                    "definition_settings": instance.definition.settings,
                    "workflow_instance": str(instance.id),
                    "workflow_version": instance.version.number,
                    "workflow_step": step_code,
                },
            )
        values = _values(instance)
        if step.get("type") == "end":
            WorkflowStepRun.objects.create(
                instance=instance,
                version=instance.version,
                step_code=step_code,
                step_title=step.get("title", step_code),
                status=WorkflowStepRun.Status.COMPLETED,
                entered_at=now,
                completed_at=now,
                decision="end",
                entry_values=engine.json_safe(values),
            )
            instance.status = WorkflowInstance.Status.COMPLETED
            instance.completed_at = now
            instance.error_message = ""
            instance.save()
            return
        resolved = explicit or engine.resolve_assignee(
            step, workspace=instance.workspace, subject=instance.subject, values=values, now=now
        )
        explicit = None
        target = None
        if step.get("target_minutes") and not resolved["error"]:
            target = engine.target_for(resolved["assignee"], now, step["target_minutes"], instance.workspace)
        run = WorkflowStepRun.objects.create(
            instance=instance,
            version=instance.version,
            step_code=step_code,
            step_title=step.get("title", step_code),
            assignee=resolved["assignee"],
            candidate_ids=resolved["candidates"],
            assignment_reason=" — ".join(part for part in (resolved["reason"], reason) if part),
            entered_at=now,
            target_minutes=step.get("target_minutes"),
            target_at=target,
            entry_values=engine.json_safe(values),
        )
        if resolved["error"]:
            _fail(instance, actor, resolved["error"], now)
            return
        instance.status = WorkflowInstance.Status.RUNNING
        instance.error_message = ""
        instance.save()
        fields = engine.entity_fields(instance.entity)
        auto = next(
            (
                row
                for row in engine.transitions_from(instance.version.graph, step_code)
                if row.get("auto") and condition(row.get("condition"), values, fields)
            ),
            None,
        )
        if auto is None:
            return
        limit = engine.max_auto_steps()
        if instance.auto_steps_in_row >= limit:
            _fail(
                instance,
                actor,
                f"اجرای پیاپی انتقال‌های خودکار از سقف {engine.fa_number(limit)} گام گذشت و فرایند "
                f"در مرحلهٔ «{step.get('title', step_code)}» متوقف شد؛ تعریف گردش‌کار را بررسی کنید.",
                now,
            )
            return
        instance.auto_steps_in_row += 1
        _close_run(run, auto.get("kind", "advance"), now)
        _decide(
            instance,
            run,
            "auto",
            actor,
            transition=auto.get("code", ""),
            from_step=step_code,
            to_step=auto["to"],
            data={"auto": True},
        )
        step_code = auto["to"]


def _status_rows(definition):
    return engine.status_options(definition.entity, definition.settings)


# ---------------------------------------------------------------- design


def _entity(workspace, code, label="entity"):
    entity = EntityType.objects.filter(workspace=workspace, code=code, parent__isnull=True).first()
    if entity is None:
        raise ValidationError({label: "نوع رکورد انتخاب‌شده وجود ندارد."})
    return entity


def _clean_settings(raw):
    raw = raw if isinstance(raw, dict) else {}
    result = {}
    if "require_manager_close" in raw:
        result["require_manager_close"] = bool(raw["require_manager_close"])
    if raw.get("instance_target_minutes") not in (None, ""):
        result["instance_target_minutes"] = engine.ensure_minutes(
            raw["instance_target_minutes"], "instance_target_minutes"
        )
    for key in ("status_field", "subject_field"):
        if isinstance(raw.get(key), str) and raw[key]:
            result[key] = raw[key][:80]
    return result


def _clean_graph(graph):
    if not isinstance(graph, dict):
        raise ValidationError({"graph": "ساختار گردش‌کار باید شامل مرحله‌ها و انتقال‌ها باشد."})
    steps, transitions = graph.get("steps", []), graph.get("transitions", [])
    if not isinstance(steps, list) or not isinstance(transitions, list):
        raise ValidationError({"graph": "مرحله‌ها و انتقال‌ها باید فهرست باشند."})
    if len(steps) > MAX_STEPS or len(transitions) > MAX_TRANSITIONS:
        raise ValidationError({"graph": "تعداد مرحله‌ها یا انتقال‌ها بیش از حد مجاز است."})
    if any(not isinstance(row, dict) for row in steps + transitions):
        raise ValidationError({"graph": "هر مرحله و انتقال باید یک شیء باشد."})
    return {"steps": steps, "transitions": transitions}


def blank_graph(definition):
    statuses = [row["code"] for row in _status_rows(definition)]
    first = statuses[0] if statuses else ""
    last = statuses[-1] if statuses else ""
    return {
        "steps": [
            {"code": "start", "title": "ثبت", "type": "start", "status_code": first, "assignee": {"type": "subject"}},
            {"code": "end", "title": "پایان", "type": "end", "status_code": last, "assignee": {"type": "none"}},
        ],
        "transitions": [{"code": "submit", "from": "start", "to": "end", "kind": "advance", "label": "ارسال"}],
    }


@transaction.atomic
def create_definition(workspace, actor, data):
    entity = _entity(workspace, data.get("entity"))
    subtype = None
    if data.get("subtype"):
        subtype = EntityType.objects.filter(workspace=workspace, parent=entity, code=data["subtype"]).first()
        if subtype is None:
            raise ValidationError({"subtype": "نوع کار انتخاب‌شده وجود ندارد."})
    kind = data.get("kind") or WorkflowDefinition.Kind.STANDARD
    if kind not in WorkflowDefinition.Kind.values:
        raise ValidationError({"kind": "نوع گردش‌کار معتبر نیست."})
    if kind == WorkflowDefinition.Kind.FAST_PATH and entity.adapter != "ticket":
        raise ValidationError({"kind": "مسیر کوتاه فقط برای تیکت‌ها (کارها) قابل تعریف است."})
    title = (data.get("title") or "").strip()
    if not title:
        raise ValidationError({"title": "عنوان گردش‌کار را وارد کنید."})
    if WorkflowDefinition.objects.filter(entity=entity, subtype=subtype, kind=kind).exists():
        raise ValidationError({"kind": "برای این نوع رکورد قبلاً گردش‌کاری از همین نوع تعریف شده است."})
    definition = WorkflowDefinition.objects.create(
        workspace=workspace,
        entity=entity,
        subtype=subtype,
        title=title[:255],
        kind=kind,
        settings=_clean_settings(data.get("settings")),
        created_by=actor,
    )
    graph = (
        engine.default_fast_path_graph(
            _status_rows(definition), definition.settings.get("require_manager_close", False)
        )
        if kind == WorkflowDefinition.Kind.FAST_PATH
        else blank_graph(definition)
    )
    if isinstance(data.get("graph"), dict):
        graph = _clean_graph(data["graph"])
    version = WorkflowVersion.objects.create(definition=definition, number=1, graph=graph, created_by=actor)
    _audit_definition(
        workspace, actor, "workflow.definition.created", definition, None, engine.serialize_definition(definition)
    )
    return definition, version


@transaction.atomic
def update_definition(workspace, actor, definition_id, data):
    definition = get_object_or_404(
        WorkflowDefinition.objects.select_for_update(), workspace=workspace, id=definition_id
    )
    before = engine.serialize_definition(definition, with_versions=False)
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            raise ValidationError({"title": "عنوان گردش‌کار را وارد کنید."})
        definition.title = title[:255]
    if "is_active" in data:
        definition.is_active = bool(data["is_active"])
    if "settings" in data:
        raw = data["settings"] if isinstance(data["settings"], dict) else {}
        merged = {**definition.settings, **_clean_settings(raw)}
        # An explicit empty value clears an optional setting (e.g. "no overall deadline").
        for key in ("instance_target_minutes", "status_field", "subject_field"):
            if key in raw and raw[key] in (None, "", 0):
                merged.pop(key, None)
        definition.settings = merged
    definition.save()
    after = engine.serialize_definition(definition, with_versions=False)
    _audit_definition(workspace, actor, "workflow.definition.updated", definition, before, after, _reason(data, False))
    return definition


@transaction.atomic
def new_draft(workspace, actor, definition_id):
    definition = get_object_or_404(
        WorkflowDefinition.objects.select_for_update(), workspace=workspace, id=definition_id
    )
    if definition.versions.filter(status=WorkflowVersion.Status.DRAFT).exists():
        raise ValidationError("یک پیش‌نویس باز برای این گردش‌کار وجود دارد؛ همان را ویرایش یا منتشر کنید.")
    latest = definition.versions.order_by("-number").first()
    version = WorkflowVersion.objects.create(
        definition=definition,
        number=(latest.number if latest else 0) + 1,
        graph=latest.graph if latest else blank_graph(definition),
        change_note="",
        created_by=actor,
    )
    _audit_definition(
        workspace,
        actor,
        "workflow.version.created",
        version,
        None,
        {"number": version.number, "from": latest.number if latest else None},
    )
    return version


@transaction.atomic
def save_draft(workspace, actor, version_id, data):
    version = get_object_or_404(
        WorkflowVersion.objects.select_for_update().select_related("definition"),
        definition__workspace=workspace,
        id=version_id,
    )
    if version.status != WorkflowVersion.Status.DRAFT:
        raise ValidationError("نسخهٔ منتشرشده یا بازنشسته قابل ویرایش نیست؛ «ساخت نسخهٔ جدید» را بزنید.")
    before = version.graph
    version.graph = _clean_graph(data.get("graph"))
    if isinstance(data.get("change_note"), str):
        version.change_note = data["change_note"][:2000]
    version.save()
    _audit_definition(workspace, actor, "workflow.version.updated", version, before, version.graph)
    return version


@transaction.atomic
def publish(workspace, actor, version_id, data):
    version = get_object_or_404(
        WorkflowVersion.objects.select_for_update().select_related("definition"),
        definition__workspace=workspace,
        id=version_id,
    )
    WorkflowDefinition.objects.select_for_update().get(id=version.definition_id)
    if version.status != WorkflowVersion.Status.DRAFT:
        raise ValidationError("فقط پیش‌نویس قابل انتشار است.")
    issues = engine.validate_graph(version.definition, version.graph)
    if issues:
        raise ValidationError({"detail": "پیش از انتشار، خطاهای گزارش بررسی را برطرف کنید.", "issues": issues})
    now = timezone.now()
    previous = version.definition.versions.filter(status=WorkflowVersion.Status.PUBLISHED).first()
    if previous:
        previous.status = WorkflowVersion.Status.RETIRED
        previous.save()
    version.status = WorkflowVersion.Status.PUBLISHED
    version.published_at = now
    version.published_by = actor
    if isinstance(data.get("change_note"), str) and data["change_note"].strip():
        version.change_note = data["change_note"].strip()[:2000]
    version.save()
    _audit_definition(
        workspace,
        actor,
        "workflow.version.published",
        version,
        {"published": previous.number if previous else None},
        {"published": version.number},
        version.change_note,
    )
    return version


# ---------------------------------------------------------------- instances


def auto_start(entity, subtype, record_id, actor, request=None):
    """Start the published workflow of a new record, if its type has one. Caller holds the transaction."""
    if engine.instance_for(entity, record_id, active_only=True):
        return None
    definition = engine.definition_for(entity, subtype)
    if definition is None:
        return None
    try:
        with transaction.atomic():
            return _start(entity, record_id, actor, definition)
    except ValidationError as exc:
        # The record itself is valid; keep it and leave a visible error instance instead of failing silently.
        detail = exc.detail if isinstance(exc.detail, list) else [exc.detail]
        message = "شروع گردش‌کار ممکن نشد: " + " ".join(str(item) for item in detail)
        version = engine.published_version(definition)
        row, native = engine.record_parts(entity, record_id)
        instance = WorkflowInstance.objects.create(
            workspace=entity.workspace,
            entity=entity,
            record_id=record_id,
            definition=definition,
            version=version,
            current_step=engine.start_step(version.graph)["code"],
            subject=engine.record_subject(entity, row, native, definition.settings),
            status=WorkflowInstance.Status.ERROR,
            error_message=message,
        )
        _decide(instance, None, "error", actor, reason=message)
        _audit(instance, actor, "workflow.error", None, {"message": message}, message)
        return instance


def _start(entity, record_id, actor, definition, now=None):
    now = now or timezone.now()
    version = engine.published_version(definition)
    row, native = engine.record_parts(entity, record_id)
    if row is None and native is None:
        raise NotFound("رکورد پیدا نشد.")
    values = engine.record_values(entity, row, native)
    subject = engine.record_subject(entity, row, native, definition.settings, values)
    start = engine.start_step(version.graph)
    minutes = definition.settings.get("instance_target_minutes")
    instance = WorkflowInstance.objects.create(
        workspace=entity.workspace,
        entity=entity,
        record_id=record_id,
        definition=definition,
        version=version,
        current_step=start["code"],
        subject=subject,
        target_minutes=minutes,
        target_at=engine.target_for(None, now, minutes, entity.workspace) if minutes else None,
        created_by=actor,
    )
    _decide(instance, None, "start", actor, to_step=start["code"])
    _audit(instance, actor, "workflow.started", None, {"version": version.number, "step": start["code"]})
    _enter(instance, start["code"], actor, now)
    return instance


@transaction.atomic
def start(workspace, actor, entity_code, record_id, data, request=None):
    entity = _entity(workspace, entity_code)
    row, native = engine.record_parts(entity, record_id)
    if row is None and native is None:
        raise NotFound("رکورد پیدا نشد.")
    from .entity_records import get_record

    get_record(entity, actor, record_id, request)
    if engine.instance_for(entity, record_id, active_only=True):
        raise ValidationError("این رکورد همین حالا یک گردش‌کار فعال دارد.")
    definition = engine.definition_for(entity, row.subtype if row else None, data.get("kind"))
    if definition is None:
        raise ValidationError("برای این نوع رکورد گردش‌کار منتشرشده و فعالی وجود ندارد.")
    return _start(entity, record_id, actor, definition)


def _run_transition(instance, run, actor, row, reason, now, *, explicit=None, data=None):
    values = _values(instance)
    changed = engine.changed_values(run, values)
    _close_run(run, row.get("kind", ""), now)
    _decide(
        instance,
        run,
        row.get("kind", ""),
        actor,
        reason=reason,
        transition=row.get("code", ""),
        from_step=instance.current_step,
        to_step=row["to"],
        changed=changed,
        data=data,
    )
    before = {"step": instance.current_step, "assignee": str(run.assignee_id) if run.assignee_id else None}
    instance.auto_steps_in_row = 0
    _enter(instance, row["to"], actor, now, explicit=explicit, reason=f"ارجاع: {reason}" if explicit else "")
    _bump(instance)
    _audit(
        instance,
        actor,
        "workflow.transition",
        before,
        {"step": instance.current_step, "status": instance.status},
        reason,
        transition=row.get("code", ""),
        kind=row.get("kind", ""),
        changed_values=engine.json_safe(changed),
        **({"data": data} if data else {}),
    )


@transaction.atomic
def transition(workspace, actor, instance_id, data, request=None, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    code = data.get("transition")
    row = next(
        (t for t in engine.transitions_from(instance.version.graph, instance.current_step) if t.get("code") == code),
        None,
    )
    if row is None or row.get("auto"):
        raise ValidationError({"transition": "این انتقال از مرحلهٔ جاری مجاز نیست."})
    label = row.get("label") or engine.TRANSITION_KINDS.get(row.get("kind"), "")
    if row.get("kind") == "return" and row.get("to") not in engine.visited_steps(instance):
        raise ValidationError({"transition": "بازگشت فقط به مرحله‌ای که قبلاً پیموده شده مجاز است."})
    needs_reason = row.get("kind") in engine.REASON_KINDS or bool(row.get("reason_required"))
    reason = _reason(data, required=False)
    if needs_reason and not reason:
        raise ValidationError({"reason": f"ثبت دلیل برای «{label}» الزامی است."})
    values = _values(instance)
    if not engine.transition_available(instance, row, values):
        raise ValidationError({"transition": f"شرط انتقال «{label}» با مقادیر فعلی رکورد برقرار نیست."})
    step = engine.current_step(instance)
    if row.get("kind") in engine.FORWARD_KINDS:
        missing = engine.missing_required(instance, step, values)
        if missing:
            raise ValidationError(missing)
        if engine.deadline_state(step, run, workspace, now)["overdue"] and not engine.has_delay_report(run):
            raise ValidationError(
                {"transition": "این مرحله از مهلت گذشته است؛ پیش از ادامه، گزارش دیرکرد را ثبت کنید."}
            )
    explicit = None
    if row.get("kind") == "refer":
        explicit = _referral(instance, data)
    _run_transition(instance, run, actor, row, reason, now, explicit=explicit)
    return instance


def _referral(instance, data):
    workspace = instance.workspace
    if data.get("user"):
        user = _member(workspace, data["user"], "user")
        return {"assignee": user, "candidates": [], "reason": f"ارجاع به {engine.user_name(user)}", "error": None}
    if data.get("role"):
        resolved = engine.resolve_assignee(
            {"type": "normal", "assignee": {"type": "role", "role_id": data["role"]}},
            workspace=workspace,
            subject=instance.subject,
            values={},
        )
        if resolved["error"]:
            raise ValidationError({"role": resolved["error"]})
        return resolved
    raise ValidationError({"user": "برای ارجاع، فرد یا گروه مقصد را انتخاب کنید."})


@transaction.atomic
def reassign(workspace, actor, instance_id, data, request=None, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    if instance.status not in {WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR}:
        raise ValidationError("این فرایند پایان یافته است.")
    run = _active_run(instance)
    if not engine.can_reassign(actor, instance, run, request):
        raise PermissionDenied("مجوز ارجاع مدیریتی این مرحله را ندارید یا این فرد در محدودهٔ مدیریت شما نیست.")
    reason = _reason(data)
    user = _member(workspace, data.get("user"))
    if user.id == run.assignee_id:
        raise ValidationError({"user": "این فرد همین حالا مسئول مرحله است."})
    before = {
        "assignee": engine._person(run.assignee),
        "candidates": run.candidate_ids,
        "target_at": engine.iso(run.target_at, workspace),
    }
    run.assignee = user
    run.candidate_ids = []
    run.assignment_reason = f"ارجاع مدیریتی توسط {engine.user_name(actor)}: {reason}"
    # Policy: a new assignee inherits the current deadline. Only an approved
    # extension moves it. A step that had no deadline (error) gets one now.
    step = engine.current_step(instance)
    if run.target_at is None and step.get("target_minutes"):
        run.target_at = engine.target_for(user, now, step["target_minutes"], workspace)
    run.save()
    was_error = instance.status == WorkflowInstance.Status.ERROR
    if was_error:
        instance.status = WorkflowInstance.Status.RUNNING
        instance.error_message = ""
    after = {"assignee": engine._person(user), "candidates": [], "target_at": engine.iso(run.target_at, workspace)}
    _decide(
        instance,
        run,
        "reassign",
        actor,
        reason=reason,
        from_step=instance.current_step,
        to_step=instance.current_step,
        data={"before": before, "after": after},
    )
    _bump(instance)
    _audit(instance, actor, "workflow.reassigned", before, after, reason, recovered_from_error=was_error)
    return instance


@transaction.atomic
def pause(workspace, actor, instance_id, data, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    kind = data.get("kind")
    step = engine.current_step(instance)
    if kind not in engine.PAUSE_KINDS:
        raise ValidationError({"kind": "نوع توقف معتبر نیست."})
    if not (step.get("pause") or {}).get(kind):
        raise ValidationError(
            {"kind": f"مرحلهٔ «{step.get('title', instance.current_step)}» اجازهٔ «{engine.PAUSE_KINDS[kind]}» را ندارد."}
        )
    if run.paused_at:
        raise ValidationError("این مرحله همین حالا متوقف است.")
    reason = _reason(data)
    remaining = engine.remaining_minutes(run, workspace, now)
    WorkflowPause.objects.create(
        step_run=run, kind=kind, paused_at=now, paused_by=actor, reason=reason, remaining_minutes=remaining
    )
    run.paused_at, run.pause_kind = now, kind
    run.save()
    _decide(
        instance,
        run,
        "pause",
        actor,
        reason=reason,
        from_step=instance.current_step,
        data={"kind": kind, "remaining_minutes": remaining},
    )
    _bump(instance)
    _audit(instance, actor, "workflow.paused", None, {"kind": kind, "remaining_minutes": remaining}, reason)
    return instance


@transaction.atomic
def resume(workspace, actor, instance_id, data, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    open_pause = run.pauses.select_for_update().filter(resumed_at__isnull=True).first()
    if not run.paused_at or open_pause is None:
        raise ValidationError("این مرحله متوقف نیست.")
    reason = _reason(data)
    before = engine.iso(run.target_at, workspace)
    if run.target_at is not None:
        # Working minutes left at pause time are re-applied from now on the assignee's calendar.
        run.target_at = add_working_time(engine.calendar_user(run), now, open_pause.remaining_minutes or 0, workspace)
    open_pause.resumed_at, open_pause.resumed_by, open_pause.resume_reason = now, actor, reason
    open_pause.save()
    run.paused_at, run.pause_kind = None, ""
    run.save()
    after = engine.iso(run.target_at, workspace)
    _decide(
        instance,
        run,
        "resume",
        actor,
        reason=reason,
        from_step=instance.current_step,
        data={"target_before": before, "target_after": after, "kind": open_pause.kind},
    )
    _bump(instance)
    _audit(instance, actor, "workflow.resumed", {"target_at": before}, {"target_at": after}, reason)
    return instance


@transaction.atomic
def delay_report(workspace, actor, instance_id, data, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    step = engine.current_step(instance)
    if not engine.deadline_state(step, run, workspace, now)["overdue"]:
        raise ValidationError("این مرحله هنوز از مهلت نگذشته است.")
    reason = _reason(data)
    progress = _reason(data, key="progress")
    expected = _moment(data.get("expected_at"), "expected_at", workspace)
    if expected <= now:
        raise ValidationError({"expected_at": "زمان مورد انتظار باید در آینده باشد."})
    report = WorkflowDelayReport.objects.create(
        step_run=run, reporter=actor, reason=reason, progress=progress, expected_at=expected, target_at=run.target_at
    )
    payload = {
        "progress": progress,
        "expected_at": engine.iso(expected, workspace),
        "expected_text": engine.fa_moment(expected, workspace),
        "target_at": engine.iso(run.target_at, workspace),
    }
    _decide(
        instance,
        run,
        "delay_report",
        actor,
        reason=reason,
        from_step=instance.current_step,
        data={"report_id": str(report.id), **payload},
    )
    _bump(instance)
    _audit(instance, actor, "workflow.delay_reported", None, payload, reason)
    return instance


@transaction.atomic
def request_extension(workspace, actor, instance_id, data, now=None):
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    run = _active_run(instance)
    role = _require_actor(actor, run, instance, now)
    if role == "candidate":
        raise PermissionDenied("درخواست تمدید فقط از سوی مسئول مرحله ممکن است.")
    scope = data.get("scope") or WorkflowExtension.Scope.STEP
    if scope not in WorkflowExtension.Scope.values:
        raise ValidationError({"scope": "دامنهٔ تمدید معتبر نیست."})
    previous = run.target_at if scope == WorkflowExtension.Scope.STEP else instance.target_at
    if previous is None:
        raise ValidationError({"scope": "برای این مورد مهلتی تعریف نشده که تمدید شود."})
    if WorkflowExtension.objects.filter(step_run=run, status=WorkflowExtension.Status.PENDING).exists():
        raise ValidationError("یک درخواست تمدید باز برای این مرحله وجود دارد.")
    reason = _reason(data)
    if data.get("minutes") not in (None, ""):
        minutes = engine.ensure_minutes(data.get("minutes"), "minutes")
        requested = add_working_time(engine.calendar_user(run), previous, minutes, workspace)
    else:
        requested = _moment(data.get("target_at"), "target_at", workspace)
    if requested <= previous:
        raise ValidationError(
            {"target_at": f"مهلت جدید باید بعد از مهلت فعلی ({engine.fa_moment(previous, workspace)}) باشد."}
        )
    row = WorkflowExtension.objects.create(
        step_run=run,
        scope=scope,
        requested_by=actor,
        previous_target_at=previous,
        requested_target_at=requested,
        reason=reason,
    )
    payload = engine.serialize_extension(row, workspace)
    _decide(instance, run, "extension", actor, reason=reason, from_step=instance.current_step, data=payload)
    _bump(instance)
    _audit(
        instance,
        actor,
        "workflow.extension_requested",
        {"target_at": payload["previous_target_at"]},
        {"requested_target_at": payload["requested_target_at"]},
        reason,
    )
    _, direct, _ = engine.managers_of(run.assignee or actor, workspace)
    if direct:
        notify_members(
            workspace.id,
            [direct[0]],
            actor_id=actor.id,
            sender="crm:workflow",
            entity_name="workflow",
            entity_id=instance.record_id,
            title="درخواست تمدید مهلت",
            message=(
                f"{engine.user_name(actor)} برای مرحلهٔ «{run.step_title}» "
                f"تا {payload['requested_target_text']} تمدید خواسته است."
            ),
            data={
                "crm_event": {
                    "kind": "workflow_extension",
                    "instance_id": str(instance.id),
                    "entity": instance.entity.code,
                    "record_id": str(instance.record_id),
                }
            },
        )
    return row


@transaction.atomic
def decide_extension(workspace, actor, extension_id, data, request=None, now=None):
    now = now or timezone.now()
    try:
        extension = WorkflowExtension.objects.select_related(
            "step_run__instance", "step_run__assignee", "requested_by"
        ).get(step_run__instance__workspace=workspace, id=extension_id)
    except (WorkflowExtension.DoesNotExist, ValueError, ValidationError):
        raise NotFound("درخواست تمدید پیدا نشد.")
    instance = _locked_instance(workspace, extension.step_run.instance_id, data.get("revision"))
    extension = WorkflowExtension.objects.select_for_update().get(id=extension.id)
    if extension.status != WorkflowExtension.Status.PENDING:
        raise ValidationError("این درخواست تمدید قبلاً بررسی شده است.")
    if not engine.extension_approver_ok(actor, extension, workspace, request, now):
        raise PermissionDenied(
            "فقط مدیر مستقیم مسئول این مرحله (یا جانشین فعال او) می‌تواند درخواست تمدید را بررسی کند."
        )
    approve = data.get("approve")
    if not isinstance(approve, bool):
        raise ValidationError({"approve": "تأیید یا رد درخواست را مشخص کنید."})
    reason = _reason(data, required=not approve)
    run = WorkflowStepRun.objects.select_for_update().get(id=extension.step_run_id)
    extension.status = WorkflowExtension.Status.APPROVED if approve else WorkflowExtension.Status.REJECTED
    extension.decided_by, extension.decided_at, extension.decision_reason = actor, now, reason
    extension.save()
    before = {"target_at": engine.iso(extension.previous_target_at, workspace)}
    after = before
    if approve:
        if extension.scope == WorkflowExtension.Scope.STEP:
            run.target_at = extension.requested_target_at
            if run.paused_at:
                # A paused step keeps counting from the new deadline when it resumes.
                open_pause = run.pauses.select_for_update().filter(resumed_at__isnull=True).first()
                if open_pause:
                    open_pause.remaining_minutes = working_minutes_between(
                        engine.calendar_user(run), run.paused_at, extension.requested_target_at, workspace
                    )
                    open_pause.save()
            run.save()
        else:
            instance.target_at = extension.requested_target_at
        after = {"target_at": engine.iso(extension.requested_target_at, workspace)}
    payload = engine.serialize_extension(extension, workspace)
    _decide(
        instance,
        run,
        "extension_approved" if approve else "extension_rejected",
        actor,
        reason=reason,
        from_step=instance.current_step,
        data=payload,
    )
    _bump(instance)
    _audit(instance, actor, "workflow.extension_decided", before, {**after, "approved": approve}, reason)
    if extension.requested_by_id:
        notify_members(
            workspace.id,
            [extension.requested_by_id],
            actor_id=actor.id,
            sender="crm:workflow",
            entity_name="workflow",
            entity_id=instance.record_id,
            title="نتیجهٔ درخواست تمدید",
            message=("درخواست تمدید شما تأیید شد." if approve else f"درخواست تمدید شما رد شد: {reason}"),
            data={
                "crm_event": {
                    "kind": "workflow_extension",
                    "instance_id": str(instance.id),
                    "entity": instance.entity.code,
                    "record_id": str(instance.record_id),
                }
            },
        )
    return extension


@transaction.atomic
def contact_resolve(workspace, actor, instance_id, data, now=None):
    """Fast path: record the contact on this ticket's history and resolve it in one step."""
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    if instance.definition.kind != WorkflowDefinition.Kind.FAST_PATH:
        raise ValidationError("ثبت تماس و حل فقط در مسیر کوتاه ممکن است.")
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    rows = engine.transitions_from(instance.version.graph, instance.current_step)
    row = next((t for t in rows if t.get("code") == "contact_resolve"), None) or next(
        (t for t in rows if t.get("kind") == "end"), None
    )
    if row is None:
        raise ValidationError("از مرحلهٔ جاری مسیر حل در تماس وجود ندارد.")
    channels = {item["code"]: item["title"] for item in engine.contact_channels(workspace)}
    channel = data.get("channel")
    if channel not in channels:
        raise ValidationError({"channel": "کانال تماس را از فهرست انتخاب کنید."})
    contact_name = _reason(data, key="contact_name")
    summary = _reason(data, key="summary")
    outcome = _reason(data, key="outcome")
    contact_at = _moment(data.get("contact_at"), "contact_at", workspace)
    if contact_at > now:
        raise ValidationError({"contact_at": "زمان تماس نمی‌تواند در آینده باشد."})
    values = _values(instance)
    missing = engine.missing_required(instance, engine.current_step(instance), values)
    if missing:
        raise ValidationError(missing)
    contact = {
        "channel": channel,
        "channel_title": channels[channel],
        "contact_name": contact_name,
        "contact_at": engine.iso(contact_at, workspace),
        "contact_text": engine.fa_moment(contact_at, workspace),
        "summary": summary,
        "outcome": outcome,
    }
    _run_transition(instance, run, actor, row, outcome, now, data={"contact": contact})
    return instance


@transaction.atomic
def to_standard(workspace, actor, instance_id, data, request=None, now=None):
    """Fast path not solved on contact: continue on the standard workflow of the same type."""
    now = now or timezone.now()
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    _require_running(instance)
    if instance.definition.kind != WorkflowDefinition.Kind.FAST_PATH:
        raise ValidationError("این فرایند در مسیر کوتاه نیست.")
    run = _active_run(instance)
    _require_actor(actor, run, instance, now)
    reason = _reason(data)
    row, _ = engine.record_parts(instance.entity, instance.record_id)
    standard = engine.definition_for(instance.entity, row.subtype if row else None, WorkflowDefinition.Kind.STANDARD)
    if standard is None:
        raise ValidationError("برای این نوع کار مسیر عادی منتشرشده‌ای وجود ندارد.")
    followup = None
    raw = data.get("followup") if isinstance(data.get("followup"), dict) else None
    if raw and (raw.get("title") or "").strip():
        ticket = EntityType.objects.filter(workspace=workspace, adapter="ticket", parent__isnull=True).first()
        assignee = _member(workspace, raw.get("assignee"), "followup")
        values = {ticket.title_field: raw["title"].strip()[:255], "ticket_assignees": [str(assignee.id)]}
        followup = save_record(ticket, actor, {"values": values}, request)
    before = {
        "definition": str(instance.definition_id),
        "version": instance.version.number,
        "step": instance.current_step,
    }
    _close_run(run, "to_standard", now)
    version = engine.published_version(standard)
    start_code = engine.start_step(version.graph)["code"]
    data_out = {
        "from_definition": str(instance.definition_id),
        "to_definition": str(standard.id),
        "to_version": version.number,
        **(
            {"followup": {"id": followup["id"], "title": followup["title"], "number": followup["number"]}}
            if followup
            else {}
        ),
    }
    _decide(
        instance,
        run,
        "to_standard",
        actor,
        reason=reason,
        from_step=instance.current_step,
        to_step=start_code,
        data=data_out,
    )
    instance.definition, instance.version, instance.auto_steps_in_row = standard, version, 0
    _enter(instance, start_code, actor, now)
    _bump(instance)
    _audit(
        instance,
        actor,
        "workflow.converted_to_standard",
        before,
        {"definition": str(standard.id), "version": version.number, "step": instance.current_step},
        reason,
        **data_out,
    )
    return instance


@transaction.atomic
def migrate(workspace, actor, instance_id, data, request=None, now=None):
    now = now or timezone.now()
    if not has_permission(actor, workspace, "Workflow.Migrate", request=request):
        raise PermissionDenied("مجوز انتقال فرایند فعال به نسخهٔ دیگر را ندارید.")
    instance = _locked_instance(workspace, instance_id, data.get("revision"))
    if instance.status not in {WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR}:
        raise ValidationError("فقط فرایند فعال قابل انتقال به نسخهٔ دیگر است.")
    version = WorkflowVersion.objects.filter(definition=instance.definition, id=data.get("version")).first()
    if version is None:
        raise ValidationError({"version": "نسخهٔ مقصد پیدا نشد."})
    step_map = data.get("step_map") if isinstance(data.get("step_map"), dict) else {}
    reason = _reason(data)
    preview = engine.migration_preview(instance, version, step_map, now)
    if not preview["can_migrate"]:
        raise ValidationError({"detail": "انتقال به این نسخه ممکن نیست.", "problems": preview["problems"]})
    run = _active_run(instance)
    _close_run(run, "migrate", now)
    before = preview["before"]
    target = preview["after"]["step"]
    _decide(
        instance,
        run,
        "migrate",
        actor,
        reason=reason,
        from_step=instance.current_step,
        to_step=target,
        data={"before": before, "after": preview["after"], "problems": preview["problems"]},
    )
    instance.version, instance.auto_steps_in_row = version, 0
    _enter(instance, target, actor, now)
    _bump(instance)
    _audit(instance, actor, "workflow.migrated", before, preview["after"], reason, problems=preview["problems"])
    return instance


# ---------------------------------------------------------------- reminders


def send_due_reminders(now=None):
    """Notify assignee and their direct manager once per step run; safe to call repeatedly."""
    now = now or timezone.now()
    sent = 0
    for candidate in engine.due_reminder_runs(now):
        with transaction.atomic():
            run = (
                WorkflowStepRun.objects.select_for_update(skip_locked=True, of=("self",))
                .select_related("instance__workspace", "instance__entity", "instance__version", "assignee")
                .filter(id=candidate.id, reminded_at__isnull=True)
                .first()
            )
            if run is None:
                continue
            instance, workspace = run.instance, run.instance.workspace
            step = engine.steps_of(instance.version.graph).get(run.step_code) or {}
            if not engine.needs_reminder(step, run, workspace, now):
                continue
            run.reminded_at = now
            run.save(update_fields=["reminded_at", "updated_at"])
            people = [run.assignee_id] if run.assignee_id else list(run.candidate_ids or [])
            if run.assignee_id:
                _, direct, _ = engine.managers_of(run.assignee, workspace)
                if direct:
                    people.append(direct[0])
            overdue = engine.deadline_state(step, run, workspace, now)["overdue"]
            notify_members(
                workspace.id,
                people,
                actor_id=None,
                sender="crm:workflow",
                entity_name="workflow",
                entity_id=instance.record_id,
                title="مهلت مرحلهٔ گردش‌کار گذشته است" if overdue else "مهلت مرحلهٔ گردش‌کار نزدیک است",
                message=f"مرحلهٔ «{run.step_title}» تا {engine.fa_moment(run.target_at, workspace)} مهلت دارد.",
                data={
                    "crm_event": {
                        "kind": "workflow_due",
                        "instance_id": str(instance.id),
                        "entity": instance.entity.code,
                        "record_id": str(instance.record_id),
                    }
                },
            )
            _decide(
                instance,
                run,
                "remind",
                None,
                from_step=run.step_code,
                data={"receivers": [str(p) for p in people], "overdue": overdue},
            )
            sent += 1
    return sent
