"""Deterministic organization-aware ticket routing.

Ticket 5 extends the same ``TicketRoutingRule`` table: ordered rules with combined
criteria (type, priority, customer, project, requester unit) and a selection method
(``manager`` = the original unit-tree behavior, ``user``, ``group``, ``round_robin``,
``least_loaded``). The first matching active rule wins. Every outcome is one
``TicketRoutingDecision`` with a readable reason; when nobody is available the
ticket waits in the unassigned queue (``TicketRoleQueueEntry``).
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from .crm_notifications import notify_members, notify_role_queue, notify_routed_issue

from plane.db.models import (
    EntityRelationLink,
    EntityType,
    Issue,
    IssueAssignee,
    OrganizationUnit,
    OrganizationUnitMember,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkspaceMember,
)

AUTO = object()  # routing_rule_id == "auto": the first matching rule decides


def usable_rule(workspace, rule_id):
    """A rule a creator may pick, or :data:`AUTO`; ``None`` when invalid or inactive."""
    if rule_id == "auto":
        return AUTO
    try:
        rule = TicketRoutingRule.objects.select_related("unit", "required_role").get(
            workspace=workspace, id=rule_id, is_active=True
        )
    except Exception:  # missing row or malformed id
        return None
    if rule.unit_id and not rule.unit.is_active:
        return None
    if rule.required_role_id and not rule.required_role.is_active:
        return None
    return rule


CONDITION_KEYS = ("type_ids", "priorities", "customer_ids", "project_ids", "unit_ids", "expression")
CONDITION_TITLES = {
    "type_ids": "نوع",
    "priorities": "اولویت",
    "customer_ids": "مشتری/رکورد مرتبط",
    "project_ids": "پروژه",
    "unit_ids": "واحد درخواست‌کننده",
    "expression": "شرط پیشرفته",
}


def _name(user):
    return (user.display_name or user.email or user.username) if user else ""


def _absent(workspace_id, user_id, now):
    return UserAbsence.objects.filter(
        workspace_id=workspace_id, user_id=user_id, status="scheduled", starts_at__lte=now, ends_at__gt=now
    ).exists()


def _available(workspace, user, now):
    """Calendar availability: recorded absence (UserAbsence) makes a person unavailable.

    Outside working hours or in a meeting a person is still a valid recipient —
    the ticket waits for their next working time (the deadline counts only working time).
    """
    from .work_calendar import availability

    segments = availability(user, now, now + timedelta(minutes=1), workspace)
    return not any(seg["reason"] == "absence" for seg in segments)


def _substitute(workspace, user, now):
    from .workflow_engine import acting_delegate

    delegate = acting_delegate(user, workspace, now)
    if delegate and _available(workspace, delegate, now):
        return delegate
    return None


def _subtree(workspace_id, unit_ids):
    units = list(OrganizationUnit.objects.filter(workspace_id=workspace_id, is_active=True).values("id", "parent_id"))
    wanted = {str(u) for u in unit_ids}
    changed = True
    while changed:
        changed = False
        for row in units:
            if str(row["parent_id"]) in wanted and str(row["id"]) not in wanted:
                wanted.add(str(row["id"]))
                changed = True
    return wanted


class TicketRoutingService:
    """Route an issue to the first eligible manager in a unit's ancestry, or by a ticket-5 method."""

    # ------------------------------------------------------------ original manager method

    @staticmethod
    def _eligible_manager(unit: OrganizationUnit, rule: TicketRoutingRule):
        manager = unit.manager
        if manager is None or not manager.is_active:
            return None
        if not WorkspaceMember.objects.filter(
            workspace_id=rule.workspace_id,
            member_id=manager.id,
            is_active=True,
        ).exists():
            return None

        active_roles = UserOrganizationRole.objects.filter(
            workspace_id=rule.workspace_id,
            user_id=manager.id,
            is_active=True,
            role__is_active=True,
        )
        if not active_roles.filter(role_id=rule.required_role_id).exists():
            return None
        from .access_control import delegation_context

        substitution = delegation_context(rule.workspace_id).get(unit.id)
        if substitution:
            return User.objects.get(pk=substitution["user_id"])
        if _absent(rule.workspace_id, manager.id, timezone.now()):
            return None
        return manager

    # ------------------------------------------------------------ criteria

    @staticmethod
    def matches(rule, issue):
        """(matched, [failed criterion titles]). Empty criteria match every ticket."""
        conditions = rule.conditions or {}
        failed = []
        if conditions.get("type_ids") and str(issue.type_id) not in map(str, conditions["type_ids"]):
            failed.append("type_ids")
        if conditions.get("priorities") and (issue.priority or "none") not in conditions["priorities"]:
            failed.append("priorities")
        if conditions.get("project_ids") and str(issue.project_id) not in map(str, conditions["project_ids"]):
            failed.append("project_ids")
        if conditions.get("customer_ids"):
            ids = list(map(str, conditions["customer_ids"]))
            linked = EntityRelationLink.objects.filter(
                Q(left_id=issue.id, right_id__in=ids) | Q(right_id=issue.id, left_id__in=ids),
                relation__deleted_at__isnull=True,
            ).exists()
            if not linked:
                failed.append("customer_ids")
        if conditions.get("expression"):
            # Same condition language and evaluator as forms and workflows (ConditionEditor).
            from .entity_rules import condition
            from .workflow_engine import entity_fields, record_parts, record_values

            entity = EntityType.objects.filter(
                workspace_id=issue.workspace_id, code="ticket", parent__isnull=True
            ).first()
            if entity is None:
                failed.append("expression")
            else:
                row, native = record_parts(entity, issue.id)
                values = record_values(entity, row, native)
                if not condition(conditions["expression"], values, entity_fields(entity)):
                    failed.append("expression")
        if conditions.get("unit_ids"):
            units = _subtree(issue.workspace_id, conditions["unit_ids"])
            member = OrganizationUnitMember.objects.filter(
                user_id=issue.created_by_id, unit_id__in=units, is_active=True
            ).exists()
            if not member:
                failed.append("unit_ids")
        return not failed, [CONDITION_TITLES[key] for key in failed]

    @classmethod
    def select_rule(cls, issue):
        """First active rule (by position) whose criteria match; with the explanation of skipped rules."""
        skipped = []
        for rule in (
            TicketRoutingRule.objects.filter(workspace_id=issue.workspace_id, is_active=True)
            .select_related("unit", "required_role", "target_user")
            .order_by("position", "name", "id")
        ):
            ok, failed = cls.matches(rule, issue)
            if ok:
                return rule, skipped
            skipped.append({"rule": rule.name, "failed": failed})
        return None, skipped

    # ------------------------------------------------------------ pools and methods

    @staticmethod
    def pool(rule):
        """Sorted candidate ids: explicit members, else holders of the role (inside the unit subtree if set)."""
        members = set(
            WorkspaceMember.objects.filter(
                workspace_id=rule.workspace_id, is_active=True, member__is_active=True, member__is_bot=False
            ).values_list("member_id", flat=True)
        )
        if rule.member_ids:
            ids = [uid for uid in rule.member_ids if any(str(m) == str(uid) for m in members)]
            return sorted({str(i) for i in ids})
        ids = set()
        if rule.required_role_id:
            ids = set(
                UserOrganizationRole.objects.filter(
                    workspace_id=rule.workspace_id, role_id=rule.required_role_id, is_active=True, role__is_active=True
                ).values_list("user_id", flat=True)
            )
        if rule.unit_id:
            unit_members = set(
                OrganizationUnitMember.objects.filter(
                    unit_id__in=_subtree(rule.workspace_id, [rule.unit_id]), is_active=True
                ).values_list("user_id", flat=True)
            )
            ids = ids & unit_members if rule.required_role_id else unit_members
        return sorted(str(i) for i in ids & members)

    @staticmethod
    def open_load(workspace_id, user_ids):
        from .ticket_core import open_q

        rows = (
            IssueAssignee.objects.filter(
                workspace_id=workspace_id,
                assignee_id__in=user_ids,
                deleted_at__isnull=True,
                issue__deleted_at__isnull=True,
                issue__is_draft=False,
                issue__archived_at__isnull=True,
            )
            .filter(open_q("issue__"))
            .values("assignee_id")
            .annotate(total=Count("issue_id", distinct=True))
        )
        load = {str(uid): 0 for uid in user_ids}
        load.update({str(row["assignee_id"]): row["total"] for row in rows})
        return load

    @classmethod
    def choose(cls, rule, issue, now=None, *, dry_run=False):
        """``(user|None, reason, details)``; round-robin advances the pointer unless ``dry_run``."""
        now = now or timezone.now()
        workspace = issue.workspace
        method = rule.method
        skipped = []
        if method == TicketRoutingRule.Method.MANAGER:
            return None, "", {}
        if method == TicketRoutingRule.Method.USER:
            user = rule.target_user
            if user is None or not user.is_active:
                return None, "فرد ثابت این قاعده فعال نیست.", {"skipped": []}
            if _available(workspace, user, now):
                return user, f"فرد ثابت قاعده: {_name(user)}", {"skipped": []}
            delegate = _substitute(workspace, user, now)
            if delegate:
                return delegate, f"{_name(user)} غایب است؛ جانشین فعال او ({_name(delegate)}) جایگزین شد", {
                    "skipped": [{"user": _name(user), "why": "غایب"}]
                }
            return None, f"{_name(user)} غایب است و جانشین فعالی ندارد", {"skipped": [{"user": _name(user), "why": "غایب"}]}
        if method == TicketRoutingRule.Method.GROUP:
            return None, "گروه ثابت: تیکت در صف گروه قرار می‌گیرد تا یکی از اعضا آن را بردارد.", {"group": True}
        candidates = cls.pool(rule)
        if not candidates:
            return None, "این قاعده هیچ عضو فعالی برای انتخاب ندارد.", {"skipped": []}
        people = {str(u.id): u for u in User.objects.filter(id__in=candidates)}
        if method == TicketRoutingRule.Method.LEAST_LOADED:
            load = cls.open_load(issue.workspace_id, candidates)
            ordered = sorted(candidates, key=lambda uid: (load[uid], candidates.index(uid)))
        else:
            start = (rule.cursor + 1) % len(candidates)
            ordered = candidates[start:] + candidates[:start]
            load = None
        for uid in ordered:
            user = people.get(uid)
            if user is None:
                continue
            if _available(workspace, user, now):
                if method == TicketRoutingRule.Method.ROUND_ROBIN and not dry_run:
                    TicketRoutingRule.objects.filter(id=rule.id).update(cursor=candidates.index(uid))
                    rule.cursor = candidates.index(uid)
                why = (
                    f"کمترین حجم کار ({load[uid]} تیکت باز): {_name(user)}"
                    if load is not None
                    else f"نوبت {_name(user)} بود"
                )
                if skipped:
                    why += "؛ رد شدند: " + "، ".join(f"{s['user']} ({s['why']})" for s in skipped)
                return user, why, {"skipped": skipped, "load": load}
            skipped.append({"user": _name(user), "why": "غایب"})
        return None, "همهٔ اعضای این قاعده غایب‌اند.", {"skipped": skipped, "load": load}

    # ------------------------------------------------------------ writing a decision

    @staticmethod
    def _assign(issue, assignee, actor_id):
        _, created = IssueAssignee.objects.get_or_create(
            issue=issue,
            assignee=assignee,
            deleted_at__isnull=True,
            defaults={"workspace_id": issue.workspace_id, "project_id": issue.project_id},
        )
        if not issue.project_id and issue.assignee_id is None:
            Issue.objects.filter(pk=issue.pk).update(assignee=assignee)
        if created:
            notify_routed_issue(issue, assignee.id, actor_id or issue.created_by_id)

    @staticmethod
    def _queue(issue, rule, actor_id, reason):
        entry, created = TicketRoleQueueEntry.objects.get_or_create(
            issue=issue,
            rule=rule,
            status=TicketRoleQueueEntry.Status.OPEN,
            defaults={"required_role": rule.required_role if rule else None},
        )
        if created:
            if entry.required_role_id:
                notify_role_queue(entry, actor_id or issue.created_by_id)
            _notify_queue_managers(issue, rule, actor_id, reason)
        from .ticket_core import record

        record(issue, actor_id, "ticket.queued", reason=reason, rule=rule.name if rule else "")
        return entry

    @classmethod
    @transaction.atomic
    def route(cls, issue: Issue, rule: TicketRoutingRule, actor_id=None) -> TicketRoutingDecision:
        if issue.workspace_id != rule.workspace_id:
            raise ValueError("Issue and routing rule must belong to the same workspace.")
        if not rule.is_active:
            raise ValueError("Inactive routing rules cannot be used.")
        if rule.method != TicketRoutingRule.Method.MANAGER:
            return cls._route_method(issue, rule, actor_id)

        unit = (
            OrganizationUnit.objects.select_for_update(of=("self",))
            .select_related("manager", "parent")
            .get(pk=rule.unit_id)
        )
        resolved_unit = None
        assignee = None
        visited = set()
        passed = []
        while unit is not None and unit.id not in visited:
            visited.add(unit.id)
            if unit.is_active:
                assignee = cls._eligible_manager(unit, rule)
                if assignee:
                    resolved_unit = unit
                    break
                passed.append(unit.title)
            unit = unit.parent

        if assignee:
            if actor_id:
                from .task_policy import validate_other_assignees

                validate_other_assignees(User.objects.get(pk=actor_id), issue.workspace_id, [assignee.id])
            cls._assign(issue, assignee, actor_id)
            TicketRoleQueueEntry.objects.filter(issue=issue, rule=rule, status="open").update(status="closed")
            reason = f"قاعدهٔ «{rule.name}»: مدیر واحد «{resolved_unit.title}» ({_name(assignee)})"
            if passed:
                reason += "؛ واحدهای بدون مدیر واجد شرایط: " + "، ".join(passed)
            decision = TicketRoutingDecision.objects.create(
                issue=issue,
                rule=rule,
                resolved_unit=resolved_unit,
                assigned_user=assignee,
                outcome=TicketRoutingDecision.Outcome.ASSIGNED,
                method=rule.method,
                reason=reason,
            )
            _record_routed(issue, actor_id, decision)
            return decision

        reason = f"قاعدهٔ «{rule.name}»: هیچ مدیر حاضر با نقش لازم پیدا نشد؛ تیکت در صف نقش ماند."
        cls._queue(issue, rule, actor_id, reason)
        return TicketRoutingDecision.objects.create(
            issue=issue,
            rule=rule,
            outcome=TicketRoutingDecision.Outcome.QUEUED,
            method=rule.method,
            reason=reason,
        )

    @classmethod
    def _route_method(cls, issue, rule, actor_id):
        rule = TicketRoutingRule.objects.select_for_update(of=("self",)).select_related("target_user", "required_role").get(
            id=rule.id
        )
        user, why, details = cls.choose(rule, issue)
        if user is not None:
            if actor_id and str(actor_id) != str(user.id):
                from .task_policy import validate_other_assignees

                validate_other_assignees(User.objects.get(pk=actor_id), issue.workspace_id, [user.id])
            cls._assign(issue, user, actor_id)
            TicketRoleQueueEntry.objects.filter(issue=issue, status="open").update(status="closed")
            decision = TicketRoutingDecision.objects.create(
                issue=issue,
                rule=rule,
                assigned_user=user,
                outcome=TicketRoutingDecision.Outcome.ASSIGNED,
                method=rule.method,
                reason=f"قاعدهٔ «{rule.name}» ({rule.get_method_display()}): {why}",
                details=details,
            )
            _record_routed(issue, actor_id, decision)
            return decision
        reason = f"قاعدهٔ «{rule.name}» ({rule.get_method_display()}): {why}"
        cls._queue(issue, rule if rule.method == TicketRoutingRule.Method.GROUP else None, actor_id, reason)
        return TicketRoutingDecision.objects.create(
            issue=issue,
            rule=rule,
            outcome=TicketRoutingDecision.Outcome.QUEUED,
            method=rule.method,
            reason=reason,
            details=details,
        )

    @classmethod
    @transaction.atomic
    def route_auto(cls, issue, actor_id=None):
        """Normal path: first matching rule; without any rule the ticket waits unassigned."""
        rule, skipped = cls.select_rule(issue)
        if rule is not None:
            return cls.route(issue, rule, actor_id)
        reason = "هیچ قاعدهٔ ارجاع فعالی با این تیکت منطبق نبود؛ تیکت در صف بدون مسئول ماند."
        cls._queue(issue, None, actor_id, reason)
        return TicketRoutingDecision.objects.create(
            issue=issue, outcome=TicketRoutingDecision.Outcome.QUEUED, method="auto", reason=reason,
            details={"skipped_rules": skipped},
        )

    @classmethod
    def preview(cls, issue):
        """Which rule and which person, without writing anything (rule page test panel)."""
        rule, skipped = cls.select_rule(issue)
        if rule is None:
            return {"rule": None, "user": None, "queued": True, "skipped_rules": skipped,
                    "reason": "هیچ قاعده‌ای منطبق نیست؛ تیکت در صف بدون مسئول می‌ماند."}
        if rule.method == TicketRoutingRule.Method.MANAGER:
            unit, user = rule.unit, None
            while unit is not None and user is None:
                user = cls._eligible_manager(unit, rule) if unit.is_active else None
                unit = unit.parent if user is None else unit
            reason = f"مدیر واحد ({_name(user)})" if user else "هیچ مدیر حاضر با نقش لازم پیدا نشد."
            details = {}
        else:
            user, reason, details = cls.choose(rule, issue, dry_run=True)
        return {
            "rule": {"id": str(rule.id), "name": rule.name, "method": rule.method, "method_title": rule.get_method_display()},
            "user": {"id": str(user.id), "name": _name(user)} if user else None,
            "queued": user is None,
            "reason": reason,
            "details": details,
            "skipped_rules": skipped,
        }


def shadowed_rules(workspace_id):
    """Rules that can never run because an earlier active rule without criteria catches everything."""
    rows = list(TicketRoutingRule.objects.filter(workspace_id=workspace_id, is_active=True).order_by("position", "name", "id"))
    result = {}
    for index, rule in enumerate(rows):
        if not any((rule.conditions or {}).get(key) for key in CONDITION_KEYS):
            for later in rows[index + 1 :]:
                result[str(later.id)] = rule.name
            break
    return result


def _record_routed(issue, actor_id, decision):
    from .ticket_core import record

    record(
        issue,
        actor_id,
        "ticket.routed",
        field="assignee",
        after=[str(decision.assigned_user_id)],
        reason=decision.reason,
        decision_id=str(decision.id),
        rule=decision.rule.name if decision.rule_id else "",
    )


def _notify_queue_managers(issue, rule, actor_id, reason):
    """Flag the unassigned ticket for managers: the rule's unit manager and queue managers."""
    from .access_control import has_permission

    receivers = set()
    if rule and rule.unit_id and rule.unit.manager_id:
        receivers.add(rule.unit.manager_id)
    for row in WorkspaceMember.objects.filter(
        workspace_id=issue.workspace_id, is_active=True, member__is_active=True, member__is_bot=False
    ).select_related("member"):
        if has_permission(row.member, issue.workspace_id, "Routing.Queue.ViewAll"):
            receivers.add(row.member_id)
    notify_members(
        issue.workspace_id,
        list(receivers),
        actor_id=actor_id,
        sender="crm:routing:unassigned",
        project_id=issue.project_id,
        entity_name="issue",
        entity_id=issue.id,
        title="تیکت بدون مسئول",
        message=f"«{issue.name}» — {reason}",
        data={"crm_event": {"kind": "ticket_unassigned", "entity": "ticket", "record_id": str(issue.id)}},
    )
