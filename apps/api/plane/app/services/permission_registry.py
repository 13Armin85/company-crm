"""Developer-owned CRM permission catalog. Codes are a stable public contract."""

# category, localized title, actions, delegatable actions
DEFINITIONS = (
    ("User", "کاربران / اعضای تیم", ("View", "Create", "Edit", "Delete", "ChangePassword", "Role.Assign"), ("View",)),
    ("Role", "نقش‌ها", ("View", "Create", "Edit", "Delete", "Disable", "Permission.Assign"), ()),
    ("Permission", "فهرست مجوزها", ("View",), ()),
    (
        "OrganizationUnit",
        "ساختار سازمانی",
        ("View", "Create", "Edit", "Delete", "Disable", "Member.Manage", "Manager.Assign", "Delegate.Manage"),
        ("View",),
    ),
    ("Access", "دسترسی کاربران", ("UserException.View", "UserException.Manage", "EffectivePermission.View"), ()),
    ("Absence", "عدم حضور", ("View", "Create", "Edit", "End", "ManageAll"), ("View", "Create", "Edit", "End")),
    (
        "Referral",
        "ارجاع",
        ("View", "Create", "Approve", "Delete", "External.Send"),
        ("View", "Create", "Approve", "Delete", "External.Send"),
    ),
    ("Project", "پروژه‌ها", ("View", "ViewAll", "Create", "Edit", "Delete", "Member.Manage"), ("View",)),
    (
        "Issue",
        "کارها",
        ("View", "ViewAll", "Create", "Edit", "Delete", "Status.Edit", "Assign"),
        ("View", "Create", "Edit", "Status.Edit", "Assign"),
    ),
    (
        "Routing",
        "مسیریابی",
        ("View", "Manage", "Route", "Queue.View", "Queue.ViewAll", "Queue.Claim"),
        ("View", "Route", "Queue.View", "Queue.Claim"),
    ),
    ("Workspace", "شرکت", ("Edit",), ()),
    ("EntityType", "موجودیت‌ها", ("View", "Create", "Edit", "Delete"), ()),
    ("Lookup", "لیست‌های پایه", ("View", "Create", "Edit", "Delete"), ()),
    ("Field", "کتابخانه فیلدها", ("View", "Create", "Edit", "Delete"), ()),
    ("FormLayout", "فرم‌ساز", ("Edit", "Publish"), ()),
    ("Config", "پیکربندی موتور", ("Export", "Import"), ()),
    ("View", "نماها", ("Create.Personal", "Create.Shared", "Manage.All"), ()),
    ("ConditionalFormat", "رنگ‌بندی شرطی", ("Edit",), ()),
    ("Export", "خروجی داده", ("Data",), ()),
)
ACTION_NAMES = {
    "Create.Personal": "ساخت نمای شخصی",
    "Create.Shared": "ساخت نمای اشتراکی",
    "Manage.All": "مدیریت همه نماها",
    "Data": "دریافت خروجی داده",
    "Publish": "انتشار",
    "Export": "خروجی پیکربندی",
    "Import": "ورود پیکربندی",
    "View": "مشاهده",
    "ViewAll": "مشاهده همه",
    "Create": "ایجاد",
    "Edit": "ویرایش",
    "Delete": "حذف",
    "Disable": "غیرفعال کردن",
    "ChangePassword": "تغییر رمز عبور",
    "Role.Assign": "تخصیص نقش",
    "Permission.Assign": "تخصیص مجوز",
    "Member.Manage": "مدیریت اعضا",
    "Manager.Assign": "تعیین مدیر",
    "Delegate.Manage": "مدیریت جانشینان",
    "UserException.View": "مشاهده استثناها",
    "UserException.Manage": "مدیریت استثناها",
    "EffectivePermission.View": "مشاهده دسترسی مؤثر",
    "End": "پایان",
    "ManageAll": "مدیریت همه",
    "Approve": "تأیید",
    "External.Send": "ارسال بیرونی",
    "Status.Edit": "تغییر وضعیت",
    "Assign": "انتقال",
    "Manage": "مدیریت",
    "Route": "ارجاع",
    "Queue.View": "مشاهده صف",
    "Queue.ViewAll": "مشاهده همه صف‌ها",
    "Queue.Claim": "دریافت از صف",
}
PERMISSION_REGISTRY = {
    f"{category}.{action}": {
        "name": f"{title}: {ACTION_NAMES[action]}",
        "description": f"مجوز {ACTION_NAMES[action]} در بخش {title}",
        "category": category,
        "is_delegatable": action in delegatable,
        "is_active": True,
    }
    for category, title, actions, delegatable in DEFINITIONS
    for action in actions
}
MEMBER_PERMISSIONS = {
    "View.Create.Personal",
    "Issue.Create",
    "Project.View",
    "Issue.View",
    "Issue.Status.Edit",
    "Issue.Assign",
    "Referral.View",
    "Routing.Queue.View",
    "Routing.Queue.Claim",
}

TICKET_SIX_PERMISSIONS = {
    "View.Personal.Create": "ساخت جدول شخصی",
    "View.Personal.Share": "اشتراک‌گذاری جدول شخصی",
    "View.Official.Manage": "مدیریت جدول رسمی",
    "UniqueRule.Manage": "مدیریت قاعده یکتایی",
    "NumberingRule.Manage": "مدیریت شماره‌گذاری خودکار",
    "Relation.View": "مشاهده ارتباط‌ها",
    "Relation.Create": "ایجاد ارتباط",
    "Relation.Edit": "ویرایش ارتباط",
    "Relation.Delete": "حذف ارتباط",
    "FormDesigner.View": "مشاهده فرم‌ساز",
    "FormDesigner.Publish": "ویرایش و انتشار فرم",
}
PERMISSION_REGISTRY.update({code: {"name": title, "description": title, "category": code.split(".")[0], "is_delegatable": False, "is_active": True} for code, title in TICKET_SIX_PERMISSIONS.items()})
MEMBER_PERMISSIONS.add("View.Personal.Create")

TICKET_SEVEN_PERMISSIONS = {
    "Dashboard.Personal.Manage": "ساخت و ویرایش داشبورد شخصی",
    "Dashboard.Default.Manage": "مدیریت داشبورد پیش‌فرض نقش‌ها",
    "Dashboard.Share": "اشتراک‌گذاری تب داشبورد",
    "Dashboard.Team.View": "مشاهده تب تیم من",
    "Dashboard.Team.Rules": "مدیریت قواعد رنگ‌بندی کارت‌ها",
    "Dashboard.Team.Assign": "ارجاع از روی کارت تیم",
    "Dashboard.Team.Remind": "ارسال یادآور به اعضای تیم",
}
PERMISSION_REGISTRY.update({code: {"name": title, "description": title, "category": "Dashboard", "is_delegatable": False, "is_active": True} for code, title in TICKET_SEVEN_PERMISSIONS.items()})
MEMBER_PERMISSIONS.add("Dashboard.Personal.Manage")


def sync_permission_catalog(workspace):
    from plane.db.models import OrganizationPermission

    for code, defaults in PERMISSION_REGISTRY.items():
        OrganizationPermission.objects.update_or_create(workspace=workspace, code=code, defaults=defaults)
    # Preserve historical definitions and assignments, but unknown codes grant nothing.
    OrganizationPermission.objects.filter(workspace=workspace).exclude(code__in=PERMISSION_REGISTRY).update(
        is_active=False
    )


def bootstrap_workspace_access(workspace):
    """Idempotent explicit bootstrap; never called by the permission evaluator."""
    from plane.db.models import OrganizationRole, RolePermission, UserOrganizationRole, WorkspaceMember

    sync_permission_catalog(workspace)
    for key, name, codes in (("admin", "مدیر", set(PERMISSION_REGISTRY)), ("member", "عضو", MEMBER_PERMISSIONS)):
        role = OrganizationRole.objects.filter(workspace=workspace, system_key=key).first()
        created = role is None
        if created:
            # Preserve a custom role's name and grants if it uses a default name.
            default_name = (
                name
                if not OrganizationRole.objects.filter(workspace=workspace, name=name).exists()
                else f"{name} (پیش‌فرض)"
            )
            suffix = 2
            while OrganizationRole.objects.filter(workspace=workspace, name=default_name).exists():
                default_name = f"{name} (پیش‌فرض {suffix})"
                suffix += 1
            role = OrganizationRole.objects.create(workspace=workspace, system_key=key, name=default_name)
        if created:
            for permission in workspace.organization_permissions.filter(code__in=codes):
                RolePermission.objects.get_or_create(role=role, permission=permission)
    roles = {role.system_key: role for role in workspace.organization_roles.filter(system_key__in=["admin", "member"])}
    for membership in WorkspaceMember.objects.filter(workspace=workspace, is_active=True):
        # Only initialize users who have no CRM assignments; do not undo deliberate changes.
        if not UserOrganizationRole.objects.filter(workspace=workspace, user_id=membership.member_id).exists():
            UserOrganizationRole.objects.get_or_create(
                workspace=workspace,
                user_id=membership.member_id,
                role=roles["admin" if membership.role == 20 else "member"],
            )


def initialize_bulk_memberships(memberships):
    """Bulk insert bypasses signals: initialize new CRM assignments explicitly."""
    from plane.db.models import OrganizationRole, UserOrganizationRole

    for membership in memberships:
        if (
            membership.is_active
            and not UserOrganizationRole.objects.filter(
                workspace_id=membership.workspace_id, user_id=membership.member_id
            ).exists()
        ):
            role = OrganizationRole.objects.filter(
                workspace_id=membership.workspace_id,
                system_key="admin" if membership.role == 20 else "member",
                is_active=True,
            ).first()
            if role:
                UserOrganizationRole.objects.get_or_create(
                    workspace_id=membership.workspace_id, user_id=membership.member_id, role=role
                )
