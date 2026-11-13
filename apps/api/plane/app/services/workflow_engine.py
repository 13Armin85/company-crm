"""Workflow engine, read side: the only place that evaluates graphs, assignees and deadlines.

Nothing in this module writes to the database. ``workflow_actions`` is the
only writer and calls these functions; views call only these two modules.

Decisions (see docs/TICKET-4-DELIVERY.fa.md):
- the step/transition graph is a validated JSON snapshot on the version;
- deadlines use the working calendar of the step assignee (``work_calendar``);
  a group step without a single assignee uses the company calendar;
- conditions are ``entity_rules`` conditions, statuses are the record's own
  statuses, manager scope is ``access_control.manager_chains``.
"""

from collections import deque
from uuid import UUID

from django.conf import settings as django_settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from plane.db.models import (
    EntityRecord,
    LookupValue,
    OrganizationRole,
    OrganizationUnitDelegate,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkflowDecision,
    WorkflowDefinition,
    WorkflowExtension,
    WorkflowInstance,
    WorkflowStepRun,
    WorkflowVersion,
    WorkspaceMember,
)
from .access_control import delegation_context, has_permission, management_relation, manager_chains
from .entity_rules import compute, condition, condition_fields, empty, validate_condition
from .entity_schema import schema_fields
from .work_calendar import add_working_time, calendar_zone, working_minutes_between
from .work_calendar_actions import fa_date

STEP_TYPES = {"start": "شروع", "normal": "عادی", "approval": "تأیید", "end": "پایان"}
TRANSITION_KINDS = {
    "approve": "تأیید",
    "reject": "رد",
    "return": "بازگشت برای اصلاح",
    "refer": "ارجاع",
    "end": "پایان",
    "advance": "ادامه",
}
ASSIGNEE_TYPES = {
    "user": "کاربر مشخص",
    "role": "نقش سازمانی",
    "record_field": "فیلد کاربرِ رکورد",
    "subject": "فرد رکورد",
    "direct_manager": "مدیر مستقیم",
    "upper_manager": "مدیر بالادست",
    "none": "بدون مسئول",
}
FORWARD_KINDS = {"approve", "advance", "end"}
REASON_KINDS = {"reject", "return"}
PAUSE_KINDS = {"customer": "در انتظار پاسخ مشتری", "formal": "توقف رسمی"}
LEAVE_STATUSES = [
    ("pending", "در انتظار تأیید"),
    ("scheduled", "تأییدشده (ثبت غیبت)"),
    ("cancelled", "لغوشده"),
    ("ended", "پایان‌یافته"),
]
# Project tickets keep Plane states; a task-status code maps to the project's state group.
STATE_GROUPS = {
    "todo": "unstarted",
    "in_progress": "started",
    "review": "started",
    "blocked": "started",
    "done": "completed",
}
CONFLICT_MESSAGE = "این درخواست هم‌زمان توسط فرد دیگری تغییر کرده است؛ صفحه را تازه کنید."
FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


class Conflict(APIException):
    status_code = 409
    default_detail = CONFLICT_MESSAGE


def json_safe(value):
    from .entity_records import json_value

    return json_value(value)


def max_auto_steps():
    return int(getattr(django_settings, "WORKFLOW_MAX_AUTO_STEPS", 10))


def fa_number(value):
    return str(value).translate(FA_DIGITS)


def fa_moment(value, workspace):
    if value is None:
        return ""
    local = value.astimezone(calendar_zone(workspace))
    return f"{fa_date(local.date())} ساعت {fa_number(local.strftime('%H:%M'))}"


def iso(value, workspace):
    return value.astimezone(calendar_zone(workspace)).isoformat() if value else None


def user_name(user):
    return (user.display_name or user.email or user.username) if user else ""


def company_calendar_user():
    """A placeholder person with no personal or unit schedule: resolves to the company calendar."""
    return User(id=UUID(int=0))


# ---------------------------------------------------------------- record sources
#
# A record source lets a record that is not an entity-engine adapter (e.g. a leave
# request with its own versions and documents) run on this engine unchanged. A
# source is an object with: ``get(workspace, record_id)``, ``status_options(entity)``,
# ``status(native)``, ``subject(native)``, ``title(native)``, ``values(native)``,
# ``apply_status(entity, actor, record_id, code, metadata)``, ``can_view(actor,
# native, request)``, ``blocks_transition(instance, row)`` (message or None),
# ``can_cancel(actor, instance, native)``, ``on_cancel(instance, actor, reason, now)``
# and ``default_graph(definition)``.

RECORD_SOURCE_MODULES = ("plane.app.services.leave_requests",)
_record_sources = {}


def register_record_source(adapter, source):
    _record_sources[adapter] = source


def record_source(entity):
    if not _record_sources:
        from importlib import import_module

        for name in RECORD_SOURCE_MODULES:
            import_module(name)
    return _record_sources.get(getattr(entity, "adapter", "") or "")


# ---------------------------------------------------------------- graph


def steps_of(graph):
    return {step["code"]: step for step in graph.get("steps", []) if isinstance(step, dict) and step.get("code")}


def transitions_from(graph, step_code):
    return [row for row in graph.get("transitions", []) if row.get("from") == step_code]


def start_step(graph):
    return next((step for step in graph.get("steps", []) if step.get("type") == "start"), None)


def entity_fields(entity, subtype=None):
    return schema_fields(entity, subtype)[1]


def status_field(entity, definition_settings=None):
    """Code of the form field that carries the record status (for history labels and locks)."""
    fields = entity_fields(entity)
    if entity.adapter in {"ticket", "task"}:
        return next(
            (code for code, f in fields.items() if f["binding"].get("source") in {"work_status", "state_id", "status"}),
            "",
        )
    if not entity.adapter:
        return (definition_settings or {}).get("status_field") or ""
    return ""


def status_options(entity, definition_settings=None):
    """Active statuses of this record type; workflows never define their own statuses."""
    source = record_source(entity)
    if source is not None:
        return source.status_options(entity)
    if entity.adapter == "leave":
        return [{"code": code, "title": title} for code, title in LEAVE_STATUSES]
    if entity.adapter in {"ticket", "task"}:
        return [
            {"code": row.code, "title": row.title}
            for row in LookupValue.objects.filter(
                category__workspace=entity.workspace,
                category__code="task-status",
                category__is_active=True,
                is_active=True,
            ).order_by("position", "id")
        ]
    if not entity.adapter:
        code = (definition_settings or {}).get("status_field")
        field = entity_fields(entity).get(code) if code else None
        if field and field.get("lookup"):
            rows = LookupValue.objects.filter(
                category__workspace=entity.workspace, category__code=field["lookup"], is_active=True
            ).order_by("position", "id")
            key = (lambda row: row.code) if field["config"].get("lookup_codes") else (lambda row: str(row.id))
            return [{"code": key(row), "title": row.title} for row in rows]
    return []


def _issue(issues, message, step=None, transition=None):
    issues.append({"step": step, "transition": transition, "message": message})


def validate_graph(definition, graph):
    """Pre-publish report. Each issue names the step or transition it belongs to."""
    issues = []
    if not isinstance(graph, dict) or not isinstance(graph.get("steps"), list):
        _issue(issues, "ساختار گردش‌کار معتبر نیست؛ فهرست مرحله‌ها پیدا نشد.")
        return issues
    transitions = graph.get("transitions") if isinstance(graph.get("transitions"), list) else []
    entity, subtype = definition.entity, definition.subtype
    fields = entity_fields(entity, subtype)
    statuses = {row["code"] for row in status_options(entity, definition.settings)}
    steps, codes = {}, []
    for step in graph["steps"]:
        code = step.get("code") if isinstance(step, dict) else None
        if not code or not isinstance(code, str):
            _issue(issues, "هر مرحله باید کد داشته باشد.")
            continue
        if code in steps:
            _issue(issues, f"کد مرحلهٔ «{code}» تکراری است.", step=code)
        steps[code] = step
        codes.append(code)
    starts = [code for code, step in steps.items() if step.get("type") == "start"]
    ends = {code for code, step in steps.items() if step.get("type") == "end"}
    if len(starts) != 1:
        _issue(issues, "گردش‌کار باید دقیقاً یک مرحلهٔ شروع داشته باشد.")
    if not ends:
        _issue(issues, "گردش‌کار دست‌کم یک مرحلهٔ پایان لازم دارد.")
    for code, step in steps.items():
        title = step.get("title") or code
        if step.get("type") not in STEP_TYPES:
            _issue(issues, f"نوع مرحلهٔ «{title}» معتبر نیست.", step=code)
        if not step.get("title"):
            _issue(issues, f"مرحلهٔ «{code}» عنوان ندارد.", step=code)
        if step.get("status_code") and step["status_code"] not in statuses:
            _issue(issues, f"وضعیت «{step['status_code']}» در فهرست وضعیت‌های فعال این رکورد نیست.", step=code)
        if not step.get("status_code") and statuses:
            _issue(issues, f"برای مرحلهٔ «{title}» وضعیت رکورد انتخاب نشده است.", step=code)
        minutes = step.get("target_minutes")
        if minutes is not None and (not isinstance(minutes, int) or isinstance(minutes, bool) or minutes <= 0):
            _issue(issues, f"مدت هدف مرحلهٔ «{title}» باید عددی مثبت (دقیقهٔ کاری) باشد.", step=code)
        for key, label in (("required_fields", "لازم"), ("editable_fields", "قابل ویرایش")):
            for field in step.get(key) or []:
                if field not in fields:
                    _issue(issues, f"فیلد {label} «{field}» در فرم این رکورد وجود ندارد.", step=code)
        reminder = step.get("reminder") or {}
        if reminder:
            value = reminder.get("value")
            if reminder.get("type") not in {"percent", "minutes"} or not isinstance(value, int) or value <= 0:
                _issue(issues, f"آستانهٔ یادآوری مرحلهٔ «{title}» معتبر نیست.", step=code)
            elif reminder["type"] == "percent" and value >= 100:
                _issue(issues, f"درصد یادآوری مرحلهٔ «{title}» باید کمتر از ۱۰۰ باشد.", step=code)
        if step.get("type") != "end":
            message = assignee_rule_problem(definition, step.get("assignee") or {}, fields)
            if message:
                _issue(issues, message, step=code)
    seen = set()
    outgoing = {code: [] for code in steps}
    for index, row in enumerate(transitions):
        code = row.get("code") or f"#{fa_number(index + 1)}"
        label = row.get("label") or code
        if code in seen:
            _issue(issues, f"کد انتقال «{code}» تکراری است.", transition=code)
        seen.add(code)
        if row.get("from") not in steps or row.get("to") not in steps:
            _issue(issues, f"مبدأ یا مقصد انتقال «{label}» مرحلهٔ موجودی نیست.", transition=code)
            continue
        if steps[row["from"]].get("type") == "end":
            _issue(issues, f"از مرحلهٔ پایان نمی‌توان انتقالی داشت («{label}»).", transition=code)
        if row.get("kind") not in TRANSITION_KINDS:
            _issue(issues, f"نوع انتقال «{label}» معتبر نیست.", transition=code)
        if row.get("kind") in REASON_KINDS and row.get("reason_required") is False:
            _issue(
                issues, f"انتقال «{label}» از نوع رد یا بازگشت است و دلیل آن نمی‌تواند اختیاری باشد.", transition=code
            )
        if row.get("auto") and row.get("kind") in REASON_KINDS:
            _issue(issues, f"انتقال «{label}» دلیل لازم دارد و نمی‌تواند خودکار باشد.", transition=code)
        if row.get("condition") is not None:
            try:
                validate_condition(row["condition"], fields)
            except ValidationError:
                missing = sorted(field for field in _safe_fields(row["condition"]) if field not in fields)
                detail = f" (فیلد ناموجود: {'، '.join(missing)})" if missing else ""
                _issue(issues, f"شرط انتقال «{label}» ناقص یا نامعتبر است{detail}.", transition=code)
        outgoing[row["from"]].append(row)
    for code, step in steps.items():
        if step.get("type") != "end" and not outgoing.get(code):
            _issue(
                issues, f"مرحلهٔ «{step.get('title') or code}» انتقال خروجی ندارد و فرایند در آن گیر می‌کند.", step=code
            )
    if len(starts) == 1:
        reachable = _reach(starts[0], outgoing)
        for code in codes:
            if code not in reachable:
                _issue(issues, f"مرحلهٔ «{steps[code].get('title') or code}» از مرحلهٔ شروع قابل دسترسی نیست.", step=code)
    # Every step must still be able to finish; a return loop is fine while an exit exists.
    for code in codes:
        if code in ends:
            continue
        if not (_reach(code, outgoing) & ends):
            _issue(issues, f"از مرحلهٔ «{steps[code].get('title') or code}» هیچ راهی به پایان وجود ندارد.", step=code)
    auto = {code: [row for row in rows if row.get("auto")] for code, rows in outgoing.items()}
    cycle = _auto_cycle(auto)
    if cycle:
        names = " ← ".join(steps[code].get("title") or code for code in cycle)
        _issue(issues, f"چرخهٔ انتقال‌های خودکار بدون اقدام انسانی وجود دارد: {names}.", step=cycle[0])
    return issues


def _safe_fields(rule):
    try:
        return condition_fields(rule)
    except (AttributeError, KeyError, TypeError):
        return set()


def _reach(start, outgoing):
    seen, queue = {start}, deque([start])
    while queue:
        for row in outgoing.get(queue.popleft(), []):
            if row.get("to") not in seen:
                seen.add(row["to"])
                queue.append(row["to"])
    return seen


def _auto_cycle(auto):
    state, path = {}, []

    def visit(code):
        state[code] = 1
        path.append(code)
        for row in auto.get(code, []):
            target = row.get("to")
            if state.get(target) == 1:
                return path[path.index(target) :] + [target]
            if state.get(target) is None:
                found = visit(target)
                if found:
                    return found
        state[code] = 2
        path.pop()
        return None

    for code in auto:
        if state.get(code) is None:
            found = visit(code)
            if found:
                return found
    return None


def assignee_rule_problem(definition, rule, fields):
    kind = rule.get("type") or "none"
    if kind not in ASSIGNEE_TYPES:
        return "قاعدهٔ مسئول مرحله معتبر نیست."
    workspace = definition.workspace
    if kind == "user":
        if not rule.get("user_id") or not _members(workspace).filter(member_id=rule["user_id"]).exists():
            return "کاربر مسئول انتخاب‌شده عضو فعال این شرکت نیست."
    if kind == "role":
        if (
            not rule.get("role_id")
            or not OrganizationRole.objects.filter(workspace=workspace, id=rule["role_id"], is_active=True).exists()
        ):
            return "نقش مسئول انتخاب‌شده فعال نیست یا وجود ندارد."
    if kind == "record_field":
        field = fields.get(rule.get("field") or "")
        if not field or field["kind"] != "user":
            return "فیلد مسئول باید یکی از فیلدهای «کاربر» همین فرم باشد."
    return None


def _members(workspace):
    return WorkspaceMember.objects.filter(workspace=workspace, is_active=True, member__is_active=True)


# ---------------------------------------------------------------- record context


def record_parts(entity, record_id):
    """(sidecar row, native row) of a record by its public id; no access checks."""
    from .entity_records import ADAPTERS

    source = record_source(entity)
    if source is not None:
        return None, source.get(entity.workspace, record_id)
    if entity.adapter:
        native = ADAPTERS[entity.adapter].objects.filter(workspace=entity.workspace, id=record_id).first()
        row = EntityRecord.objects.filter(entity=entity, source_id=record_id).first()
        return row, native
    return EntityRecord.objects.filter(entity=entity, id=record_id).first(), None


def record_values(entity, row, native):
    from .entity_records import all_values

    source = record_source(entity)
    if source is not None:
        return source.values(native) if native is not None else {}
    values = all_values(entity, row, native)
    try:
        return compute(entity_fields(entity, row.subtype if row else None), values, strict=False)
    except ValidationError:
        return values


def record_status(entity, row, native, definition_settings=None):
    source = record_source(entity)
    if source is not None:
        return source.status(native) if native is not None else None
    if entity.adapter == "leave":
        return native.status if native else None
    if entity.adapter in {"ticket", "task"} and native is not None:
        if getattr(native, "project_id", None) and native.state_id:
            return native.state.group
        return native.status
    code = (definition_settings or {}).get("status_field")
    return (row.data or {}).get(code) if row and code else None


def record_subject(entity, row, native, definition_settings=None, values=None):
    """The person a record is about: leave owner, else a configured user field, else creator."""
    source = record_source(entity)
    if source is not None:
        return source.subject(native) if native is not None else None
    if entity.adapter == "leave" and native is not None:
        return native.user
    code = (definition_settings or {}).get("subject_field")
    if code and values and values.get(code):
        value = values[code][0] if isinstance(values[code], list) else values[code]
        found = User.objects.filter(id=value).first()
        if found:
            return found
    creator = getattr(native or row, "created_by", None)
    return creator


def record_title(entity, row, native):
    source = record_source(entity)
    if source is not None:
        return source.title(native) if native is not None else entity.title
    if native is not None:
        for name in ("name", "title", "reason"):
            if getattr(native, name, ""):
                return str(getattr(native, name))
    if row is not None:
        value = (row.data or {}).get(entity.title_field)
        if isinstance(value, str) and value:
            return value
        return row.number
    return entity.title


# ---------------------------------------------------------------- people


def is_absent(user, workspace, now=None):
    now = now or timezone.now()
    return UserAbsence.objects.filter(
        workspace=workspace, user=user, status=UserAbsence.Status.SCHEDULED, starts_at__lte=now, ends_at__gt=now
    ).exists()


def unit_delegate(unit, workspace, now=None):
    """Highest-priority active delegate of a unit who is a member and not absent."""
    members = set(_members(workspace).values_list("member_id", flat=True))
    for row in OrganizationUnitDelegate.objects.filter(unit=unit, is_active=True).select_related("user"):
        if row.user_id in members and row.user_id != unit.manager_id and not is_absent(row.user, workspace, now):
            return row.user
    return None


def managers_of(user, workspace):
    """``(unit, direct_manager_id, upper_manager_id)`` for the first of the person's units."""
    chains = manager_chains(user, workspace)
    if not chains:
        return None, None, None
    unit, chain = next(((u, c) for u, c in chains if c), chains[0])
    direct = chain[0] if chain else None
    upper = chain[1] if len(chain) > 1 else None
    return unit, direct, upper


def acting_delegate(user, workspace, now=None):
    """The person currently substituting ``user`` as a unit manager, if any."""
    for item in delegation_context(workspace, now).values():
        if item["manager_id"] == user.id:
            return User.objects.filter(id=item["user_id"]).first()
    return None


def resolve_assignee(step, *, workspace, subject, values, now=None):
    """Who is responsible for a step.

    Returns ``{"assignee": User|None, "candidates": [ids], "reason": text,
    "error": text|None}``. Order of rules: specific user, organizational role,
    user field of the record, direct manager of the record's person, upper
    manager. A missing manager falls back to the unit's delegate; nothing ever
    falls back to an administrator or a random user.
    """
    now = now or timezone.now()
    rule = step.get("assignee") or {}
    kind = rule.get("type") or "none"
    result = {"assignee": None, "candidates": [], "reason": "", "error": None}
    if step.get("type") == "end" or kind == "none":
        return result
    if kind == "user":
        user = User.objects.filter(id=rule.get("user_id"), is_active=True).first()
        if not user or not _members(workspace).filter(member=user).exists():
            result["error"] = "کاربر مسئول این مرحله دیگر عضو فعال شرکت نیست."
            return result
        result.update(assignee=user, reason="کاربر مشخص‌شده در تعریف مرحله")
    elif kind == "subject":
        if subject is None:
            result["error"] = "فرد این رکورد مشخص نیست."
            return result
        result.update(assignee=subject, reason="فرد رکورد")
    elif kind == "record_field":
        raw = values.get(rule.get("field") or "")
        ids = [str(item) for item in (raw if isinstance(raw, list) else [raw] if raw else [])]
        users = list(User.objects.filter(id__in=ids, is_active=True, member_workspace__workspace=workspace).distinct())
        if not users:
            result["error"] = "فیلد مسئول این رکورد خالی است؛ ابتدا مسئول را در فرم مشخص کنید."
            return result
        if len(users) == 1:
            result.update(assignee=users[0], reason="فیلد مسئول رکورد")
        else:
            result.update(candidates=sorted(str(u.id) for u in users), reason="مسئولان ثبت‌شده در رکورد")
    elif kind == "role":
        role = OrganizationRole.objects.filter(workspace=workspace, id=rule.get("role_id"), is_active=True).first()
        if not role:
            result["error"] = "نقش مسئول این مرحله فعال نیست."
            return result
        ids = set(
            UserOrganizationRole.objects.filter(
                workspace=workspace, role=role, is_active=True, user__is_active=True
            ).values_list("user_id", flat=True)
        ) & set(_members(workspace).values_list("member_id", flat=True))
        present = sorted(str(uid) for uid in ids if not is_absent(User(id=uid), workspace, now))
        if not present:
            result["error"] = f"هیچ کاربر فعال و حاضری نقش «{role.name}» را ندارد."
            return result
        result.update(candidates=present, reason=f"گروه نقش «{role.name}»")
    elif kind in {"direct_manager", "upper_manager"}:
        if subject is None:
            result["error"] = "فرد این رکورد مشخص نیست و مدیر او قابل تعیین نیست."
            return result
        unit, direct, upper = managers_of(subject, workspace)
        found = direct if kind == "direct_manager" else upper
        label = "مدیر مستقیم" if kind == "direct_manager" else "مدیر بالادست"
        if found is None:
            delegate = unit_delegate(unit, workspace, now) if unit is not None and kind == "direct_manager" else None
            if delegate:
                result.update(assignee=delegate, reason=f"واحد «{unit.title}» مدیر ندارد؛ جانشین واحد جایگزین شد")
            else:
                name = unit.title if unit is not None else "این فرد"
                result["error"] = f"برای واحد {name} {label} یا جانشین فعالی تعریف نشده است."
            return result
        manager = User.objects.filter(id=found[0], is_active=True).first()
        if manager is None or not _members(workspace).filter(member=manager).exists():
            result["error"] = f"{label} واحد {found[1].title} عضو فعال شرکت نیست."
            return result
        result.update(assignee=manager, reason=f"{label} ({found[1].title})")
    assignee = result["assignee"]
    if (
        assignee is not None
        and is_absent(assignee, workspace, now)
        and step.get("absence_policy", "delegate") == "delegate"
    ):
        delegate = acting_delegate(assignee, workspace, now)
        if delegate:
            result.update(
                assignee=delegate,
                reason=(
                    f"{result['reason']}؛ {user_name(assignee)} غایب است و جانشین او ({user_name(delegate)}) جایگزین شد"
                ),
            )
        else:
            result["reason"] = f"{result['reason']}؛ {user_name(assignee)} غایب است و جانشین فعالی ندارد"
    return result


def target_for(assignee, start, minutes, workspace):
    """Deadline in working time of the assignee (company calendar for groups)."""
    if not minutes:
        return None
    return add_working_time(assignee or company_calendar_user(), start, minutes, workspace)


def calendar_user(step_run):
    return step_run.assignee or company_calendar_user()


# ---------------------------------------------------------------- runtime state


def current_step(instance):
    return steps_of(instance.version.graph).get(instance.current_step) or {}


def active_run(instance):
    return instance.step_runs.filter(status=WorkflowStepRun.Status.ACTIVE).select_related("assignee").first()


def remaining_minutes(step_run, workspace, now=None):
    if not step_run.target_at:
        return None
    moment = step_run.paused_at or now or timezone.now()
    if moment >= step_run.target_at:
        return 0
    return working_minutes_between(calendar_user(step_run), moment, step_run.target_at, workspace)


def reminder_threshold(step, step_run):
    """Remaining working minutes at which the "near due" reminder fires (None: never)."""
    reminder = step.get("reminder") or {}
    if not reminder or not step_run.target_minutes:
        return None
    if reminder.get("type") == "percent":
        return step_run.target_minutes * (100 - reminder["value"]) // 100
    return reminder.get("value")


def deadline_state(step, step_run, workspace, now=None):
    now = now or timezone.now()
    if step_run is None or not step_run.target_at:
        return {"near_due": False, "overdue": False, "remaining_minutes": None}
    overdue = not step_run.paused_at and now > step_run.target_at
    remaining = remaining_minutes(step_run, workspace, now)
    threshold = reminder_threshold(step, step_run)
    near = not overdue and threshold is not None and remaining is not None and remaining <= threshold
    return {"near_due": near, "overdue": overdue, "remaining_minutes": remaining}


def needs_reminder(step, step_run, workspace, now):
    """Pure predicate used by the periodic task and by tests."""
    if step_run.status != WorkflowStepRun.Status.ACTIVE or step_run.reminded_at or step_run.paused_at:
        return False
    state = deadline_state(step, step_run, workspace, now)
    return state["near_due"] or state["overdue"]


def due_reminder_runs(now=None):
    now = now or timezone.now()
    rows = (
        WorkflowStepRun.objects.filter(
            status=WorkflowStepRun.Status.ACTIVE,
            reminded_at__isnull=True,
            paused_at__isnull=True,
            target_at__isnull=False,
            instance__status=WorkflowInstance.Status.RUNNING,
        )
        .select_related("instance__workspace", "instance__version", "instance__entity", "assignee")
        .order_by("target_at")
    )
    return [
        row
        for row in rows
        if needs_reminder(
            steps_of(row.instance.version.graph).get(row.step_code) or {}, row, row.instance.workspace, now
        )
    ]


def has_delay_report(step_run):
    return bool(step_run.target_at) and step_run.delay_reports.filter(target_at=step_run.target_at).exists()


def actor_role(actor, step_run, workspace, now=None):
    """ "assignee", "candidate", "delegate" or None."""
    if step_run is None:
        return None
    if step_run.assignee_id == actor.id:
        return "assignee"
    if step_run.assignee_id is None and str(actor.id) in (step_run.candidate_ids or []):
        return "candidate"
    if step_run.assignee_id:
        delegate = acting_delegate(step_run.assignee, workspace, now)
        if delegate and delegate.id == actor.id:
            return "delegate"
    return None


def can_reassign(actor, instance, step_run, request=None):
    if step_run is None or not has_permission(actor, instance.workspace, "Workflow.Reassign", request=request):
        return False
    if has_permission(actor, instance.workspace, "Workflow.ViewAll", request=request):
        return True
    people = [person for person in (step_run.assignee, instance.subject) if person is not None]
    return any(management_relation(actor, person, instance.workspace, request=request) for person in people)


def extension_approver_ok(actor, extension, workspace, request=None, now=None):
    """Only the direct manager of the step assignee, or that manager's active delegate."""
    owner = extension.step_run.assignee or extension.requested_by
    if owner is None or actor.id == owner.id:
        return False
    if management_relation(actor, owner, workspace, request=request) == "direct":
        return True
    _, direct, _ = managers_of(owner, workspace)
    if direct is None:
        return False
    manager = User(id=direct[0])
    delegate = acting_delegate(manager, workspace, now)
    return bool(delegate and delegate.id == actor.id)


def transition_available(instance, row, values):
    return condition(row.get("condition"), values, entity_fields(instance.entity))


def visited_steps(instance):
    return set(instance.step_runs.values_list("step_code", flat=True))


def allowed_transitions(instance, step_run, actor, values, now=None):
    """Transitions the actor may run now; the server re-checks each one on submit."""
    if instance.status != WorkflowInstance.Status.RUNNING or step_run is None:
        return []
    if actor_role(actor, step_run, instance.workspace, now) is None:
        return []
    visited = visited_steps(instance)
    source = record_source(instance.entity)
    result = []
    for row in transitions_from(instance.version.graph, instance.current_step):
        if row.get("auto"):
            continue
        # The record owns this move (e.g. "sign and submit" of a leave request).
        if source is not None and source.blocks_transition(instance, row):
            continue
        if row.get("kind") == "return" and row.get("to") not in visited:
            continue
        if not transition_available(instance, row, values):
            continue
        result.append(row)
    return result


def missing_required(instance, step, values):
    fields = entity_fields(instance.entity)
    return {
        code: f"تکمیل فیلد «{fields.get(code, {}).get('title', code)}» پیش از ادامه الزامی است."
        for code in step.get("required_fields") or []
        if empty(values.get(code))
    }


def changed_values(step_run, values):
    before = step_run.entry_values or {}
    return {
        code: {"before": before.get(code), "after": value}
        for code, value in values.items()
        if before.get(code) != value
    }


def is_participant(entity, record_id, actor, request=None, now=None):
    """Whether ``actor`` takes part in this record's workflow, so may read the record.

    Participants are the people a step was assigned to (directly, as a group
    member or as the acting delegate) and the manager who must decide a pending
    extension. This only widens *reading*: every write still goes through the
    record's own permission and visibility rules.
    """
    if actor is None or not getattr(actor, "is_authenticated", False):
        return False
    try:
        instance = instance_for(entity, record_id)
    except (ValueError, DjangoValidationError):
        return False
    if instance is None:
        return False
    workspace = instance.workspace
    runs = list(instance.step_runs.all())
    if any(run.assignee_id == actor.id or str(actor.id) in (run.candidate_ids or []) for run in runs):
        return True
    active = next((run for run in runs if run.status == WorkflowStepRun.Status.ACTIVE), None)
    if active and actor_role(actor, active, workspace, now):
        return True
    # Anyone who already decided something here (e.g. approved an extension) keeps read access.
    if WorkflowDecision.objects.filter(instance=instance, actor=actor).exists():
        return True
    if WorkflowExtension.objects.filter(step_run__instance=instance, decided_by=actor).exists():
        return True
    pending = WorkflowExtension.objects.filter(
        step_run__instance=instance, status=WorkflowExtension.Status.PENDING
    ).select_related("step_run__assignee", "requested_by")
    return any(extension_approver_ok(actor, row, workspace, request, now) for row in pending)


def instance_for(entity, record_id, *, active_only=False):
    rows = WorkflowInstance.objects.filter(entity=entity, record_id=record_id).select_related(
        "version", "definition", "entity", "workspace", "subject"
    )
    if active_only:
        rows = rows.filter(status__in=[WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR])
    return rows.order_by("-created_at").first()


def step_field_lock(entity, record_id, submitted, old):
    """Fields a running step forbids changing: {code: message}. Status is owned by the workflow."""
    if not submitted:
        return {}
    instance = instance_for(entity, record_id, active_only=True)
    if instance is None or instance.status != WorkflowInstance.Status.RUNNING:
        return {}
    step = current_step(instance)
    status_code = status_field(entity, instance.definition.settings)
    errors = {}
    for code, value in submitted.items():
        if value == old.get(code):
            continue
        if code == status_code:
            errors[code] = "وضعیت این رکورد را گردش‌کار تعیین می‌کند؛ از دکمه‌های اقدام گردش‌کار استفاده کنید."
        elif step.get("lock_fields") and code not in (step.get("editable_fields") or []):
            errors[code] = f"این فیلد در مرحلهٔ «{step.get('title', instance.current_step)}» قابل ویرایش نیست."
    return errors


def published_version(definition):
    return definition.versions.filter(status=WorkflowVersion.Status.PUBLISHED).first()


def definition_for(entity, subtype=None, kind=None):
    """Active definition with a published version; subtype-specific wins over entity-wide."""
    kinds = [kind] if kind else [WorkflowDefinition.Kind.FAST_PATH, WorkflowDefinition.Kind.STANDARD]
    for wanted in kinds:
        for scope in ([subtype] if subtype else []) + [None]:
            row = WorkflowDefinition.objects.filter(entity=entity, subtype=scope, kind=wanted, is_active=True).first()
            if row and published_version(row):
                return row
    return None


# ---------------------------------------------------------------- dry run


def simulate(definition, graph, values, *, subject=None, now=None):
    """Walk the graph with sample values without saving anything.

    At each step the first automatic transition whose condition holds is taken,
    otherwise the first forward (approve/advance/end) transition whose
    condition holds. The walk stops at an end step, a dead end, or after the
    automatic-step cap.
    """
    now = now or timezone.now()
    workspace = definition.workspace
    fields = entity_fields(definition.entity, definition.subtype)
    try:
        values = compute(fields, dict(values or {}), strict=False)
    except ValidationError:
        values = dict(values or {})
    steps = steps_of(graph)
    step = start_step(graph)
    path, moment, guard = [], now, 0
    limit = max(len(steps) * 2, max_auto_steps())
    while step is not None and guard <= limit:
        guard += 1
        resolved = resolve_assignee(step, workspace=workspace, subject=subject, values=values, now=moment)
        target = None
        if step.get("target_minutes") and not resolved["error"]:
            target = target_for(resolved["assignee"], moment, step["target_minutes"], workspace)
        path.append(
            {
                "step": step["code"],
                "title": step.get("title", step["code"]),
                "type": step.get("type"),
                "status_code": step.get("status_code"),
                "assignee": _person(resolved["assignee"]),
                "candidates": [_person(u) for u in User.objects.filter(id__in=resolved["candidates"])],
                "assignment_reason": resolved["reason"],
                "error": resolved["error"],
                "entered_at": iso(moment, workspace),
                "target_at": iso(target, workspace),
                "target_text": fa_moment(target, workspace),
            }
        )
        if step.get("type") == "end" or resolved["error"]:
            break
        rows = transitions_from(graph, step["code"])
        usable = [row for row in rows if condition(row.get("condition"), values, fields)]
        chosen = next((row for row in usable if row.get("auto")), None) or next(
            (row for row in usable if row.get("kind") in FORWARD_KINDS), None
        )
        if chosen is None:
            path[-1]["error"] = "با این مقادیر هیچ انتقال رو به جلویی از این مرحله برقرار نیست."
            break
        path[-1]["transition"] = {
            "code": chosen.get("code"),
            "label": chosen.get("label"),
            "auto": bool(chosen.get("auto")),
        }
        moment = target or moment
        step = steps.get(chosen.get("to"))
    if guard > limit:
        path[-1]["error"] = f"شبیه‌سازی پس از {fa_number(limit)} گام متوقف شد؛ مسیر به پایان نمی‌رسد."
    return path


def _person(user):
    return {"id": str(user.id), "name": user_name(user)} if user else None


# ---------------------------------------------------------------- serialization


def serialize_version(version, workspace=None):
    workspace = workspace or version.definition.workspace
    return {
        "id": str(version.id),
        "number": version.number,
        "status": version.status,
        "graph": version.graph,
        "change_note": version.change_note,
        "published_at": iso(version.published_at, workspace),
        "published_by": _person(version.published_by),
        "is_editable": version.status == WorkflowVersion.Status.DRAFT,
    }


def serialize_definition(definition, *, with_versions=True):
    data = {
        "id": str(definition.id),
        "entity": definition.entity.code,
        "subtype": definition.subtype.code if definition.subtype else None,
        "title": definition.title,
        "kind": definition.kind,
        "is_active": definition.is_active,
        "settings": definition.settings,
    }
    if with_versions:
        data["versions"] = [serialize_version(row, definition.workspace) for row in definition.versions.all()]
    return data


def serialize_run(step_run, step, workspace, now=None):
    if step_run is None:
        return None
    state = deadline_state(step, step_run, workspace, now)
    return {
        "id": str(step_run.id),
        "step": step_run.step_code,
        "title": step_run.step_title,
        "assignee": _person(step_run.assignee),
        "candidates": [_person(u) for u in User.objects.filter(id__in=step_run.candidate_ids or [])],
        "assignment_reason": step_run.assignment_reason,
        "entered_at": iso(step_run.entered_at, workspace),
        "target_at": iso(step_run.target_at, workspace),
        "target_text": fa_moment(step_run.target_at, workspace),
        "paused": bool(step_run.paused_at),
        "pause_kind": step_run.pause_kind,
        **state,
        "has_delay_report": has_delay_report(step_run),
    }


def serialize_extension(row, workspace):
    return {
        "id": str(row.id),
        "scope": row.scope,
        "status": row.status,
        "requested_by": _person(row.requested_by),
        "previous_target_at": iso(row.previous_target_at, workspace),
        "previous_target_text": fa_moment(row.previous_target_at, workspace),
        "requested_target_at": iso(row.requested_target_at, workspace),
        "requested_target_text": fa_moment(row.requested_target_at, workspace),
        "reason": row.reason,
        "decided_by": _person(row.decided_by),
        "decision_reason": row.decision_reason,
        "created_at": iso(row.created_at, workspace),
    }


def timeline(instance):
    """Decisions of this record's workflow history, oldest first (all versions)."""
    workspace = instance.workspace
    rows = (
        instance.decisions.model.objects.filter(
            instance__entity=instance.entity, instance__record_id=instance.record_id
        )
        .select_related("actor")
        .order_by("created_at", "id")
    )
    return [
        {
            "id": str(row.id),
            "kind": row.kind,
            "transition": row.transition_code,
            "from_step": row.from_step,
            "to_step": row.to_step,
            "actor": _person(row.actor),
            "version": row.version_number,
            "reason": row.reason,
            "changed_values": row.changed_values,
            "data": row.data,
            "at": iso(row.created_at, workspace),
            "at_text": fa_moment(row.created_at, workspace),
        }
        for row in rows
    ]


def instance_payload(instance, actor, request=None, now=None):
    now = now or timezone.now()
    workspace = instance.workspace
    step = current_step(instance)
    run = active_run(instance) if instance.status == WorkflowInstance.Status.RUNNING else None
    row, native = record_parts(instance.entity, instance.record_id)
    values = record_values(instance.entity, row, native) if (row or native) else {}
    role = actor_role(actor, run, workspace, now)
    transitions = allowed_transitions(instance, run, actor, values, now)
    overdue = bool(run and deadline_state(step, run, workspace, now)["overdue"])
    pending = (
        WorkflowExtension.objects.filter(step_run=run, status=WorkflowExtension.Status.PENDING).first() if run else None
    )
    fast = instance.definition.kind == WorkflowDefinition.Kind.FAST_PATH
    actions = {
        "transitions": [
            {
                "code": t.get("code"),
                "label": t.get("label") or TRANSITION_KINDS.get(t.get("kind"), ""),
                "kind": t.get("kind"),
                "to": t.get("to"),
                "reason_required": t.get("kind") in REASON_KINDS or bool(t.get("reason_required")),
                "blocked": overdue and t.get("kind") in FORWARD_KINDS and not has_delay_report(run),
            }
            for t in transitions
        ],
        "can_pause": bool(run and role and not run.paused_at and (step.get("pause") or {})),
        "pause_kinds": [k for k, allowed in (step.get("pause") or {}).items() if allowed and k in PAUSE_KINDS],
        "can_resume": bool(run and role and run.paused_at),
        "can_report_delay": bool(run and role and overdue),
        "can_request_extension": bool(run and role in {"assignee", "delegate"} and run.target_at and pending is None),
        "can_decide_extension": bool(pending and extension_approver_ok(actor, pending, workspace, request, now)),
        "can_reassign": bool(run and can_reassign(actor, instance, run, request)),
        "can_contact_resolve": bool(fast and run and role and step.get("type") != "end"),
        "can_to_standard": bool(
            fast
            and run
            and role
            and definition_for(instance.entity, _subtype(instance), WorkflowDefinition.Kind.STANDARD)
        ),
        "can_migrate": has_permission(actor, workspace, "Workflow.Migrate", request=request)
        and instance.status in {WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR},
        "can_cancel": can_cancel(actor, instance),
    }
    steps = steps_of(instance.version.graph)
    migration_target = None
    if actions["can_migrate"]:
        latest = published_version(instance.definition)
        if latest is not None and latest.id != instance.version_id:
            migration_target = {
                "id": str(latest.id),
                "number": latest.number,
                "steps": [{"code": code, "title": s.get("title", code)} for code, s in steps_of(latest.graph).items()],
            }
    return {
        "id": str(instance.id),
        "migration_target": migration_target,
        "status": instance.status,
        "revision": instance.revision,
        "error_message": instance.error_message,
        "definition": {
            "id": str(instance.definition_id),
            "title": instance.definition.title,
            "kind": instance.definition.kind,
        },
        "version": {"id": str(instance.version_id), "number": instance.version.number},
        "current_step": {
            "code": instance.current_step,
            "title": step.get("title", instance.current_step),
            "type": step.get("type"),
        },
        "steps": [{"code": code, "title": s.get("title", code), "type": s.get("type")} for code, s in steps.items()],
        "run": serialize_run(run, step, workspace, now),
        "subject": _person(instance.subject),
        "target_at": iso(instance.target_at, workspace),
        "target_text": fa_moment(instance.target_at, workspace),
        "my_role": role,
        "actions": actions,
        "pending_extension": serialize_extension(pending, workspace) if pending else None,
        "extensions": [
            serialize_extension(row, workspace)
            for row in WorkflowExtension.objects.filter(step_run__instance=instance).select_related(
                "requested_by", "decided_by"
            )
        ],
        "timeline": timeline(instance),
        "contact_channels": contact_channels(workspace) if fast else [],
    }


def can_cancel(actor, instance):
    """Whether ``actor`` may cancel this active instance; only records whose source allows it."""
    if instance.status not in {WorkflowInstance.Status.RUNNING, WorkflowInstance.Status.ERROR}:
        return False
    source = record_source(instance.entity)
    if source is None:
        return False
    _, native = record_parts(instance.entity, instance.record_id)
    return native is not None and bool(source.can_cancel(actor, instance, native))


def _subtype(instance):
    row, _ = record_parts(instance.entity, instance.record_id)
    return row.subtype if row else None


def contact_channels(workspace):
    """Contact channels reuse the existing "ticket-source" lookup; a built-in list when it is absent."""
    rows = list(
        LookupValue.objects.filter(
            category__workspace=workspace, category__code="ticket-source", category__is_active=True, is_active=True
        ).order_by("position", "id")
    )
    if rows:
        return [{"code": row.code, "title": row.title} for row in rows]
    return [
        {"code": "phone", "title": "تلفن"},
        {"code": "onsite", "title": "حضوری"},
        {"code": "email", "title": "ایمیل"},
    ]


def can_view_instance(actor, instance, request=None):
    workspace = instance.workspace
    if not has_permission(actor, workspace, "Workflow.View", request=request):
        return False
    if has_permission(actor, workspace, "Workflow.ViewAll", request=request):
        return True
    if instance.subject_id == actor.id:
        return True
    runs = instance.step_runs.all()
    if any(run.assignee_id == actor.id or str(actor.id) in (run.candidate_ids or []) for run in runs):
        return True
    run = next((r for r in runs if r.status == WorkflowStepRun.Status.ACTIVE), None)
    if run and actor_role(actor, run, workspace):
        return True
    people = [p for p in (instance.subject, run.assignee if run else None) if p is not None]
    return any(management_relation(actor, p, workspace, request=request) for p in people)


def inbox(actor, workspace, request=None, now=None):
    """Steps waiting for me and extension requests I must decide."""
    now = now or timezone.now()
    delegated_for = [
        item["manager_id"] for item in delegation_context(workspace, now).values() if item["user_id"] == actor.id
    ]
    runs = (
        WorkflowStepRun.objects.filter(
            instance__workspace=workspace,
            instance__status=WorkflowInstance.Status.RUNNING,
            status=WorkflowStepRun.Status.ACTIVE,
        )
        .select_related("instance__entity", "instance__version", "assignee")
        .order_by("target_at", "entered_at")
    )
    steps = []
    for run in runs:
        if not (
            run.assignee_id == actor.id
            or run.assignee_id in delegated_for
            or (run.assignee_id is None and str(actor.id) in (run.candidate_ids or []))
        ):
            continue
        steps.append(_inbox_item(run, workspace, now))
    extensions = []
    for row in WorkflowExtension.objects.filter(
        step_run__instance__workspace=workspace, status=WorkflowExtension.Status.PENDING
    ).select_related("step_run__instance__entity", "step_run__assignee", "requested_by"):
        if extension_approver_ok(actor, row, workspace, request, now):
            extensions.append({**serialize_extension(row, workspace), **_inbox_item(row.step_run, workspace, now)})
    return {"steps": steps, "extensions": extensions}


def _inbox_item(run, workspace, now):
    instance = run.instance
    row, native = record_parts(instance.entity, instance.record_id)
    step = steps_of(instance.version.graph).get(run.step_code) or {}
    return {
        "instance_id": str(instance.id),
        "entity": instance.entity.code,
        "entity_title": instance.entity.title,
        "record_id": str(instance.record_id),
        "record_title": record_title(instance.entity, row, native),
        "step_title": run.step_title,
        "target_at": iso(run.target_at, workspace),
        "target_text": fa_moment(run.target_at, workspace),
        **deadline_state(step, run, workspace, now),
    }


def migration_preview(instance, version, step_map=None, now=None):
    """Read-only: what moving an active instance to ``version`` would change."""
    now = now or timezone.now()
    workspace = instance.workspace
    step_map = step_map or {}
    target_steps = steps_of(version.graph)
    mapped = step_map.get(instance.current_step) or instance.current_step
    problems = []
    if version.definition_id != instance.definition_id:
        problems.append("نسخهٔ مقصد متعلق به همین تعریف گردش‌کار نیست.")
    if version.status != WorkflowVersion.Status.PUBLISHED:
        problems.append("فقط به نسخهٔ منتشرشده می‌توان منتقل کرد.")
    if version.id == instance.version_id:
        problems.append("فرایند همین حالا روی این نسخه است.")
    step = target_steps.get(mapped)
    if step is None:
        problems.append(
            f"مرحلهٔ فعلی «{current_step(instance).get('title', instance.current_step)}» در نسخهٔ جدید نیست؛ "
            "مرحلهٔ مقصد را انتخاب کنید."
        )
    run = active_run(instance)
    current = current_step(instance)
    for code in sorted(visited_steps(instance) - set(target_steps)):
        problems.append(f"مرحلهٔ پیموده‌شدهٔ «{code}» در نسخهٔ جدید وجود ندارد؛ بازگشت به آن ممکن نخواهد بود.")
    before = {
        "version": instance.version.number,
        "step": instance.current_step,
        "assignee": _person(run.assignee) if run else None,
        "target_at": iso(run.target_at, workspace) if run else None,
    }
    after = None
    if step is not None:
        row, native = record_parts(instance.entity, instance.record_id)
        values = record_values(instance.entity, row, native) if (row or native) else {}
        resolved = resolve_assignee(step, workspace=workspace, subject=instance.subject, values=values, now=now)
        if resolved["error"]:
            problems.append(resolved["error"])
        target = None
        if step.get("target_minutes") and not resolved["error"]:
            target = target_for(resolved["assignee"], now, step["target_minutes"], workspace)
        if step.get("status_code") != current.get("status_code"):
            problems.append("وضعیت رکورد در مرحلهٔ مقصد تغییر می‌کند.")
        after = {
            "version": version.number,
            "step": mapped,
            "step_title": step.get("title", mapped),
            "assignee": _person(resolved["assignee"]),
            "target_at": iso(target, workspace),
            "target_text": fa_moment(target, workspace),
        }
    return {
        "before": before,
        "after": after,
        "problems": problems,
        "can_migrate": step is not None
        and not [p for p in problems if p.startswith(("نسخهٔ مقصد", "فقط به", "فرایند همین"))],
    }


def default_fast_path_graph(statuses, require_manager_close=False):
    """Template: ثبت ← رسیدگی ← حل (optionally with a manager close approval)."""
    codes = [row["code"] for row in statuses]

    def pick(*wanted):
        return next((code for code in wanted if code in codes), codes[0] if codes else "")

    steps = [
        {
            "code": "register",
            "title": "ثبت",
            "type": "start",
            "status_code": pick("todo"),
            "assignee": {"type": "subject"},
        },
        {
            "code": "handle",
            "title": "رسیدگی",
            "type": "normal",
            "status_code": pick("in_progress"),
            "assignee": {"type": "subject"},
        },
        {"code": "resolved", "title": "حل", "type": "end", "status_code": pick("done"), "assignee": {"type": "none"}},
    ]
    resolve_to = "resolved"
    if require_manager_close:
        steps.insert(
            2,
            {
                "code": "close_approval",
                "title": "تأیید بستن",
                "type": "approval",
                "status_code": pick("review"),
                "assignee": {"type": "direct_manager"},
            },
        )
        resolve_to = "close_approval"
    transitions = [
        {"code": "contact_resolve", "from": "register", "to": resolve_to, "kind": "end", "label": "حل در تماس اول"},
        {"code": "start_handling", "from": "register", "to": "handle", "kind": "advance", "label": "شروع رسیدگی"},
        {"code": "resolve", "from": "handle", "to": resolve_to, "kind": "end", "label": "حل شد"},
    ]
    if require_manager_close:
        transitions += [
            {
                "code": "close_approve",
                "from": "close_approval",
                "to": "resolved",
                "kind": "approve",
                "label": "تأیید بستن",
            },
            {
                "code": "close_return",
                "from": "close_approval",
                "to": "handle",
                "kind": "return",
                "label": "بازگشت برای رسیدگی",
                "reason_required": True,
            },
        ]
    return {"steps": steps, "transitions": transitions}


def ensure_minutes(value, label):
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValidationError({label: "مدت باید عددی مثبت بر حسب دقیقهٔ کاری باشد."})
    return value
