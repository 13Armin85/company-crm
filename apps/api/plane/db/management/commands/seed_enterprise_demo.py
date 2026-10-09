# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Additive, repeatable demo data for the local enterprise CRM workspace."""

import os
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from plane.app.services import TicketRoutingService
from plane.app.services.permission_registry import PERMISSION_REGISTRY, sync_permission_catalog
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    Profile,
    Project,
    ProjectMember,
    RolePermission,
    State,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
    UserOrganizationRole,
    Workspace,
    WorkspaceMember,
    WorkspaceTask,
)


class Command(BaseCommand):
    help = "Add comprehensive non-destructive demo data to the local development workspace."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or os.environ.get("DEV_BOOTSTRAP") != "1":
            raise CommandError("Enterprise demo seed requires DEBUG and DEV_BOOTSTRAP=1.")

        workspace = Workspace.objects.filter(slug="dev-workspace").first()
        if workspace is None:
            raise CommandError("Run bootstrap_dev before seed_enterprise_demo.")

        password = os.environ.get("DEV_DEMO_PASSWORD", "DemoUser!2026")
        users = self._seed_users(workspace, password)
        permissions = self._seed_permissions(workspace)
        roles = self._seed_roles(workspace, permissions)
        self._seed_user_roles(workspace, users, roles)
        units = self._seed_units(workspace, users)
        self._seed_unit_members(units, users)
        projects = self._seed_projects(workspace, users)
        issues = self._seed_project_content(workspace, projects, users)
        self._seed_workspace_tasks(workspace, users)
        self._seed_routing(workspace, units, roles, issues)
        self._seed_notifications(workspace, users, issues)

        self.stdout.write(
            self.style.SUCCESS("Enterprise demo data is ready (additive mode: existing records were preserved).")
        )

    def _seed_users(self, workspace, password):
        specs = {
            "admin": ("admin@plane.local", "مدیر", "سیستم", 20),
            "developer": ("user@plane.local", "آرمین", "توسعه‌دهنده", 15),
            "sales_manager": ("sales.manager@plane.local", "علی", "رضایی", 15),
            "sales_expert": ("sales.expert@plane.local", "سارا", "احمدی", 15),
            "support_manager": ("support.manager@plane.local", "رضا", "محمدی", 15),
            "support_expert": ("support.expert@plane.local", "مریم", "کریمی", 15),
            "finance_manager": ("finance.manager@plane.local", "نگار", "حسینی", 15),
            "production_lead": ("production.lead@plane.local", "حامد", "اکبری", 15),
        }
        result = {}
        for key, (email, first_name, last_name, workspace_role) in specs.items():
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User(
                    email=email,
                    username=email.split("@")[0],
                    first_name=first_name,
                    last_name=last_name,
                    display_name=f"{first_name} {last_name}",
                    is_email_verified=True,
                    is_password_autoset=False,
                    is_managed=True,
                )
                user.set_password(password)
                user.save()
            WorkspaceMember.objects.get_or_create(
                workspace=workspace,
                member=user,
                defaults={"role": workspace_role, "is_active": True},
            )
            Profile.objects.get_or_create(
                user=user,
                defaults={
                    "is_onboarded": True,
                    "last_workspace_id": workspace.id,
                    "onboarding_step": {
                        "profile_complete": True,
                        "workspace_create": True,
                        "workspace_invite": True,
                        "workspace_join": True,
                    },
                },
            )
            result[key] = user
        return result

    def _seed_permissions(self, workspace):
        sync_permission_catalog(workspace)
        return {
            permission.code: permission
            for permission in OrganizationPermission.objects.filter(
                workspace=workspace, is_active=True, code__in=PERMISSION_REGISTRY
            )
        }

    def _seed_roles(self, workspace, permissions):
        specs = {
            "support": (
                "کارشناس پشتیبانی",
                ["Issue.View", "Issue.Status.Edit", "Routing.Queue.View", "Routing.Queue.Claim"],
            ),
            "developer": ("برنامه‌نویس", ["Project.View", "Issue.View", "Issue.Edit", "Issue.Status.Edit"]),
            "sales": ("کارشناس فروش", ["Issue.View"]),
            "senior_sales": ("کارشناس ارشد فروش", ["Issue.View", "Issue.Assign", "Referral.Create"]),
            "support_manager": (
                "مدیر پشتیبانی",
                [
                    "Issue.View",
                    "Issue.Assign",
                    "Issue.Status.Edit",
                    "Referral.Approve",
                    "User.View",
                    "OrganizationUnit.View",
                    "Absence.View",
                    "Absence.Create",
                    "Absence.Edit",
                    "Absence.End",
                ],
            ),
            "sales_manager": (
                "مدیر فروش",
                [
                    "Issue.View",
                    "Issue.Assign",
                    "Referral.Approve",
                    "User.View",
                    "OrganizationUnit.View",
                    "Absence.View",
                    "Absence.Create",
                    "Absence.Edit",
                    "Absence.End",
                ],
            ),
            "finance_manager": (
                "مدیر مالی",
                ["Issue.View", "Referral.Approve", "Absence.View", "Absence.Create", "Absence.Edit", "Absence.End"],
            ),
            "ceo": (
                "مدیرعامل",
                list(PERMISSION_REGISTRY),
            ),
        }
        result = {}
        for key, (name, permission_codes) in specs.items():
            role, _ = OrganizationRole.objects.get_or_create(
                workspace=workspace,
                name=name,
                defaults={"is_active": True},
            )
            for code in permission_codes:
                RolePermission.objects.get_or_create(role=role, permission=permissions[code])
            result[key] = role
        return result

    def _seed_user_roles(self, workspace, users, roles):
        assignments = {
            "admin": ["ceo"],
            "developer": ["developer", "support"],
            "sales_manager": ["sales_manager", "senior_sales"],
            "sales_expert": ["sales", "senior_sales"],
            "support_manager": ["support_manager", "support"],
            "support_expert": ["support"],
            "finance_manager": ["finance_manager"],
            "production_lead": ["developer"],
        }
        for user_key, role_keys in assignments.items():
            for role_key in role_keys:
                UserOrganizationRole.objects.get_or_create(
                    workspace=workspace,
                    user=users[user_key],
                    role=roles[role_key],
                    defaults={"is_active": True},
                )

    def _seed_units(self, workspace, users):
        result = {}

        def add(key, title, parent_key=None, manager_key=None):
            unit, _ = OrganizationUnit.objects.get_or_create(
                workspace=workspace,
                parent=result.get(parent_key),
                title=title,
                defaults={
                    "manager": users.get(manager_key),
                    "is_active": True,
                },
            )
            result[key] = unit

        add("organization", "سازمان", manager_key="admin")
        add("sales", "فروش", "organization", "sales_manager")
        add("domestic_sales", "فروش داخلی", "sales", "sales_manager")
        add("foreign_sales", "فروش خارجی", "sales")
        add("production", "تولید", "organization", "production_lead")
        add("line_1", "خط تولید ۱", "production", "production_lead")
        add("line_2", "خط تولید ۲", "production")
        add("support", "پشتیبانی", "organization", "support_manager")
        add("software_support", "پشتیبانی نرم‌افزار", "support", "support_manager")
        add("technical_support", "پشتیبانی فنی", "support")
        add("finance", "مالی", "organization", "finance_manager")
        add("finance_queue", "صف بررسی مالی", manager_key=None)
        return result

    def _seed_unit_members(self, units, users):
        assignments = {
            "organization": ["admin"],
            "sales": ["sales_manager", "sales_expert"],
            "domestic_sales": ["sales_manager", "sales_expert"],
            "foreign_sales": ["sales_expert"],
            "production": ["production_lead", "developer"],
            "line_1": ["production_lead"],
            "line_2": ["developer"],
            "support": ["support_manager", "support_expert", "developer"],
            "software_support": ["support_manager", "developer"],
            "technical_support": ["support_expert"],
            "finance": ["finance_manager"],
            "finance_queue": ["finance_manager"],
        }
        for unit_key, user_keys in assignments.items():
            for user_key in user_keys:
                OrganizationUnitMember.objects.get_or_create(
                    unit=units[unit_key],
                    user=users[user_key],
                    defaults={"is_active": True},
                )

    def _seed_projects(self, workspace, users):
        today = timezone.localdate()
        specs = {
            "sales": {
                "name": "اتوماسیون فروش سازمانی",
                "identifier": "SALE",
                "description": "مدیریت سرنخ‌ها، قراردادها و فرایند فروش داخلی و خارجی",
                "lead": users["sales_manager"],
                "target_date": today + timedelta(days=90),
                "members": ["admin", "sales_manager", "sales_expert", "finance_manager"],
            },
            "support": {
                "name": "مرکز پشتیبانی مشتریان",
                "identifier": "SUP",
                "description": "رسیدگی به درخواست‌های نرم‌افزاری و فنی مشتریان",
                "lead": users["support_manager"],
                "target_date": today + timedelta(days=60),
                "members": ["admin", "support_manager", "support_expert", "developer"],
            },
            "product": {
                "name": "توسعه محصول CRM",
                "identifier": "CRM",
                "description": "توسعه قابلیت‌های سازمانی، گزارش‌گیری و گردش کار",
                "lead": users["developer"],
                "target_date": today + timedelta(days=120),
                "members": ["admin", "developer", "production_lead", "support_manager"],
            },
        }
        result = {}
        for key, spec in specs.items():
            project = Project.objects.filter(workspace=workspace, identifier=spec["identifier"]).first()
            if project is None:
                project = Project.objects.create(
                    workspace=workspace,
                    name=spec["name"],
                    identifier=spec["identifier"],
                    description=spec["description"],
                    project_lead=spec["lead"],
                    default_assignee=spec["lead"],
                    target_date=spec["target_date"],
                    cycle_view=True,
                    module_view=True,
                    intake_view=True,
                    logo_props={"icon": {"color": "#4f46e5"}},
                )
            for user_key in spec["members"]:
                role = 20 if user_key == "admin" else 15
                ProjectMember.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    member=users[user_key],
                    defaults={"role": role, "is_active": True},
                )
            result[key] = project
        return result

    def _seed_project_content(self, workspace, projects, users):
        today = timezone.localdate()
        issue_specs = {
            "sales": [
                ("پیگیری قرارداد شرکت آفتاب", "started", "high", 7, "sales_manager"),
                ("آماده‌سازی پیش‌فاکتور سازمانی", "unstarted", "medium", 12, "sales_expert"),
                ("تماس با سرنخ‌های نمایشگاه", "backlog", "low", 20, "sales_expert"),
                ("تأیید تخفیف قرارداد خارجی", "started", "urgent", 4, "sales_manager"),
                ("ثبت گزارش فروش ماهانه", "completed", "medium", -2, "sales_expert"),
            ],
            "support": [
                ("خطای ورود مشتری کلیدی", "started", "urgent", 1, "support_manager"),
                ("کندی گزارش فروش", "unstarted", "high", 3, "support_expert"),
                ("درخواست آموزش پنل مدیریت", "backlog", "low", 14, "support_expert"),
                ("بررسی مشکل اعلان‌های ایمیل", "started", "medium", 6, "developer"),
                ("بستن تیکت بازیابی رمز عبور", "completed", "medium", -1, "support_expert"),
            ],
            "product": [
                ("طراحی داشبورد مدیریتی", "started", "high", 10, "developer"),
                ("افزودن گزارش عملکرد تیم‌ها", "unstarted", "medium", 18, "developer"),
                ("بهینه‌سازی جستجوی سراسری", "backlog", "low", 30, "production_lead"),
                ("تست گردش کار تأیید خرید", "started", "high", 8, "production_lead"),
                ("انتشار نسخه پایدار CRM", "completed", "urgent", -3, "developer"),
            ],
        }
        state_specs = [
            ("Backlog", "backlog", "#64748b"),
            ("Todo", "unstarted", "#3b82f6"),
            ("In Progress", "started", "#f59e0b"),
            ("Done", "completed", "#10b981"),
            ("Blocked", "cancelled", "#ef4444"),
        ]
        labels = {}
        for project_key, project in projects.items():
            states = {}
            for name, group, color in state_specs:
                state, _ = State.all_state_objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    name=name,
                    defaults={"group": group, "color": color, "default": group == "unstarted"},
                )
                states[group] = state
            if project.default_state_id is None:
                project.default_state = states["unstarted"]
                project.save(update_fields=["default_state", "updated_at"])

            for label_name, color in [("مهم", "#ef4444"), ("مشتری", "#3b82f6"), ("بهبود", "#10b981")]:
                label, _ = Label.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    name=label_name,
                    defaults={"color": color},
                )
                labels[(project_key, label_name)] = label

            cycle, _ = Cycle.objects.get_or_create(
                workspace=workspace,
                project=project,
                name="چرخه جاری",
                defaults={
                    "description": "چرخه نمونه برای بررسی فرایند جاری تیم",
                    "owned_by": project.project_lead or users["admin"],
                    "start_date": timezone.now() - timedelta(days=7),
                    "end_date": timezone.now() + timedelta(days=21),
                },
            )
            module, _ = Module.objects.get_or_create(
                workspace=workspace,
                project=project,
                name="تحویل سازمانی",
                defaults={
                    "description": "ماژول نمونه برای تحویل قابلیت‌های اصلی",
                    "lead": project.project_lead,
                    "start_date": today - timedelta(days=5),
                    "target_date": today + timedelta(days=30),
                    "status": "in-progress",
                },
            )

            for index, (name, group, priority, due_in, assignee_key) in enumerate(issue_specs[project_key]):
                issue = Issue.objects.filter(project=project, name=name, deleted_at__isnull=True).first()
                if issue is None:
                    issue = Issue.objects.create(
                        workspace=workspace,
                        project=project,
                        state=states[group],
                        name=name,
                        priority=priority,
                        start_date=today - timedelta(days=index + 1),
                        target_date=today + timedelta(days=due_in),
                        completed_at=timezone.now() if group == "completed" else None,
                        description_html=f"<p>داده نمایشی برای بررسی کامل پروژه {project.name}</p>",
                        description_stripped=f"داده نمایشی برای بررسی کامل پروژه {project.name}",
                        created_by=users["admin"],
                    )
                IssueAssignee.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    issue=issue,
                    assignee=users[assignee_key],
                )
                IssueLabel.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    issue=issue,
                    label=labels[(project_key, "مهم" if priority in {"urgent", "high"} else "بهبود")],
                )
                CycleIssue.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    cycle=cycle,
                    issue=issue,
                )
                ModuleIssue.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    module=module,
                    issue=issue,
                )
                IssueActivity.objects.get_or_create(
                    workspace=workspace,
                    project=project,
                    issue=issue,
                    verb="داده نمایشی ایجاد شد",
                    defaults={"actor": users["admin"], "field": "issue"},
                )
        queue_issue = Issue.objects.filter(
            project=projects["product"],
            name="درخواست خرید تجهیزات زیرساخت",
            deleted_at__isnull=True,
        ).first()
        if queue_issue is None:
            queue_issue = Issue.objects.create(
                workspace=workspace,
                project=projects["product"],
                state=State.objects.filter(project=projects["product"], group="unstarted").first(),
                name="درخواست خرید تجهیزات زیرساخت",
                priority="urgent",
                start_date=today,
                target_date=today + timedelta(days=5),
                description_html="<p>نمونه تیکت بدون مدیر واجد شرایط برای نمایش Role Queue</p>",
                description_stripped="نمونه تیکت بدون مدیر واجد شرایط برای نمایش Role Queue",
                created_by=users["admin"],
            )

        return {
            "sales": Issue.objects.get(project=projects["sales"], name="تأیید تخفیف قرارداد خارجی"),
            "support": Issue.objects.get(project=projects["support"], name="خطای ورود مشتری کلیدی"),
            "product": queue_issue,
        }

    def _seed_workspace_tasks(self, workspace, users):
        today = timezone.localdate()
        specs = [
            ("برگزاری جلسه هفتگی مدیران", "in_progress", "high", 2, "admin"),
            ("بازبینی SLA پشتیبانی", "review", "medium", 5, "support_manager"),
            ("تهیه گزارش فروش فصلی", "todo", "high", 10, "sales_manager"),
            ("تأیید بودجه خرید تجهیزات", "blocked", "urgent", 7, "finance_manager"),
            ("به‌روزرسانی مستندات فنی", "done", "low", -1, "developer"),
        ]
        for sequence, (name, status_value, priority, due_in, assignee_key) in enumerate(specs, start=1):
            if WorkspaceTask.objects.filter(workspace=workspace, name=name).exists():
                continue
            sequence_id = max(
                sequence,
                (
                    WorkspaceTask.objects.filter(workspace=workspace)
                    .order_by("-sequence_id")
                    .values_list("sequence_id", flat=True)
                    .first()
                    or 0
                )
                + 1,
            )
            WorkspaceTask.objects.create(
                workspace=workspace,
                assignee=users[assignee_key],
                name=name,
                status=status_value,
                priority=priority,
                sequence_id=sequence_id,
                target_date=today + timedelta(days=due_in),
            )

    def _seed_routing(self, workspace, units, roles, issues):
        specs = {
            "support": ("ارجاع پشتیبانی نرم‌افزار", units["software_support"], roles["support_manager"]),
            "sales": ("ارجاع فروش خارجی", units["foreign_sales"], roles["sales_manager"]),
            "queue": ("صف تأیید مالی", units["finance_queue"], roles["finance_manager"]),
        }
        rules = {}
        for key, (name, unit, role) in specs.items():
            rule, _ = TicketRoutingRule.objects.get_or_create(
                workspace=workspace,
                name=name,
                defaults={
                    "unit": unit,
                    "required_role": role,
                    "is_active": True,
                },
            )
            rules[key] = rule
        routing_pairs = [
            (issues["support"], rules["support"]),
            (issues["sales"], rules["sales"]),
            (issues["product"], rules["queue"]),
        ]
        for issue, rule in routing_pairs:
            if not TicketRoutingDecision.objects.filter(issue=issue, rule=rule).exists():
                TicketRoutingService.route(issue, rule)

    def _seed_notifications(self, workspace, users, issues):
        specs = [
            ("support_manager", issues["support"], "تیکت فوری پشتیبانی", "یک تیکت فوری به تیم پشتیبانی ارجاع شد."),
            ("sales_manager", issues["sales"], "نیاز به تأیید فروش", "درخواست تخفیف قرارداد خارجی منتظر بررسی است."),
            ("finance_manager", issues["product"], "درخواست تأیید مالی", "درخواست خرید جدید وارد صف نقش مالی شد."),
            ("developer", issues["product"], "به‌روزرسانی محصول", "یک فعالیت جدید در پروژه CRM ثبت شد."),
        ]
        for user_key, issue, title, message in specs:
            Notification.objects.get_or_create(
                workspace=workspace,
                project=issue.project,
                receiver=users[user_key],
                entity_identifier=issue.id,
                entity_name="issue",
                title=title,
                defaults={
                    "message_stripped": message,
                    "message_html": f"<p>{message}</p>",
                    "sender": "app",
                    "triggered_by": users["admin"],
                    "data": {"issue_id": str(issue.id), "project_id": str(issue.project_id)},
                },
            )
