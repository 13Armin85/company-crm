from rest_framework import serializers

from plane.db.models import (
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
)


class OrganizationPermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationPermission
        fields = (
            "id",
            "code",
            "name",
            "description",
            "category",
            "is_delegatable",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class OrganizationRoleSerializer(serializers.ModelSerializer):
    user_count = serializers.IntegerField(read_only=True, default=0)
    permission_ids = serializers.PrimaryKeyRelatedField(
        source="permissions",
        many=True,
        read_only=True,
    )

    class Meta:
        model = OrganizationRole
        fields = (
            "id",
            "name",
            "description",
            "system_key",
            "is_active",
            "permission_ids",
            "user_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "system_key", "created_at", "updated_at")


class OrganizationUnitSerializer(serializers.ModelSerializer):
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent",
        queryset=OrganizationUnit.objects.all(),
        allow_null=True,
        required=False,
    )
    manager_id = serializers.PrimaryKeyRelatedField(
        source="manager",
        queryset=User.objects.all(),
        allow_null=True,
        required=False,
    )
    manager_name = serializers.CharField(source="manager.display_name", read_only=True)
    member_ids = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationUnit
        fields = (
            "id",
            "title",
            "parent_id",
            "manager_id",
            "manager_name",
            "member_ids",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_member_ids(self, obj):
        return [row.user_id for row in obj.memberships.all() if row.is_active and row.deleted_at is None]


class TicketRoutingRuleSerializer(serializers.ModelSerializer):
    unit_id = serializers.PrimaryKeyRelatedField(
        source="unit", queryset=OrganizationUnit.objects.all(), required=False, allow_null=True
    )
    required_role_id = serializers.PrimaryKeyRelatedField(
        source="required_role",
        queryset=OrganizationRole.objects.all(),
        required=False,
        allow_null=True,
    )
    target_user_id = serializers.PrimaryKeyRelatedField(
        source="target_user", queryset=User.objects.all(), required=False, allow_null=True
    )
    role_name = serializers.CharField(source="required_role.name", read_only=True, default="")
    unit_title = serializers.CharField(source="unit.title", read_only=True, default="")
    target_user_name = serializers.CharField(source="target_user.display_name", read_only=True, default="")
    method_title = serializers.CharField(source="get_method_display", read_only=True)

    def validate_conditions(self, value):
        from plane.app.services.ticket_routing import CONDITION_KEYS

        if not isinstance(value, dict) or set(value) - set(CONDITION_KEYS):
            raise serializers.ValidationError("شرط‌های قاعده معتبر نیستند.")
        expression = value.get("expression")
        if expression is not None:
            from plane.app.services.entity_rules import validate_condition
            from plane.app.services.workflow_engine import entity_fields
            from plane.db.models import EntityType

            workspace = self.context.get("workspace")
            entity = EntityType.objects.filter(workspace=workspace, code="ticket", parent__isnull=True).first()
            if entity is None:
                raise serializers.ValidationError("موجودیت تیکت برای شرط پیشرفته پیدا نشد.")
            try:
                validate_condition(expression, entity_fields(entity))
            except Exception as exc:
                raise serializers.ValidationError(str(getattr(exc, "detail", exc)))
        for key, items in value.items():
            if key == "expression":
                continue
            if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
                raise serializers.ValidationError("هر شرط باید فهرستی از مقادیر باشد.")
        return value

    def validate_member_ids(self, value):
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise serializers.ValidationError("اعضای قاعده باید فهرستی از شناسه‌ها باشند.")
        return value

    def validate(self, attrs):
        method = attrs.get("method", getattr(self.instance, "method", "manager"))
        user = attrs.get("target_user", getattr(self.instance, "target_user", None))
        if method == "user" and user is None:
            raise serializers.ValidationError({"target_user_id": "برای روش «فرد ثابت» فرد را انتخاب کنید."})
        if method == "group" and not attrs.get("required_role", getattr(self.instance, "required_role", None)):
            raise serializers.ValidationError({"required_role_id": "برای روش «گروه ثابت» نقش گروه را انتخاب کنید."})
        return attrs

    class Meta:
        model = TicketRoutingRule
        fields = (
            "id",
            "name",
            "unit_id",
            "unit_title",
            "required_role_id",
            "role_name",
            "is_active",
            "position",
            "conditions",
            "method",
            "method_title",
            "target_user_id",
            "target_user_name",
            "member_ids",
            "cursor",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "cursor", "created_at", "updated_at")


class TicketRoutingDecisionSerializer(serializers.ModelSerializer):
    assigned_user_name = serializers.CharField(source="assigned_user.display_name", read_only=True)
    resolved_unit_title = serializers.CharField(source="resolved_unit.title", read_only=True)

    class Meta:
        model = TicketRoutingDecision
        fields = (
            "id",
            "outcome",
            "assigned_user_id",
            "assigned_user_name",
            "resolved_unit_id",
            "resolved_unit_title",
            "rule_id",
            "method",
            "reason",
            "details",
            "response",
            "created_at",
        )


class TicketRoleQueueEntrySerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="required_role.name", read_only=True)
    issue_name = serializers.CharField(source="issue.name", read_only=True)
    issue_identifier = serializers.SerializerMethodField()
    project_id = serializers.UUIDField(source="issue.project_id", read_only=True)
    project_name = serializers.CharField(source="issue.project.name", read_only=True)
    rule_name = serializers.CharField(source="rule.name", read_only=True)
    claimed_by_name = serializers.CharField(source="claimed_by.display_name", read_only=True)

    class Meta:
        model = TicketRoleQueueEntry
        fields = (
            "id",
            "issue_id",
            "issue_name",
            "issue_identifier",
            "project_id",
            "project_name",
            "rule_id",
            "rule_name",
            "required_role_id",
            "role_name",
            "status",
            "claimed_by_id",
            "claimed_by_name",
            "created_at",
            "updated_at",
        )

    def get_issue_identifier(self, obj):
        if not obj.issue.project_id:
            return f"#{obj.issue.sequence_id}"
        return f"{obj.issue.project.identifier}-{obj.issue.sequence_id}"
