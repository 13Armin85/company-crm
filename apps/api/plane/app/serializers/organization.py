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
    unit_id = serializers.PrimaryKeyRelatedField(source="unit", queryset=OrganizationUnit.objects.all())
    required_role_id = serializers.PrimaryKeyRelatedField(
        source="required_role",
        queryset=OrganizationRole.objects.all(),
    )
    role_name = serializers.CharField(source="required_role.name", read_only=True)
    unit_title = serializers.CharField(source="unit.title", read_only=True)

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
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


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
            "created_at",
        )


class TicketRoleQueueEntrySerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="required_role.name", read_only=True)
    issue_name = serializers.CharField(source="issue.name", read_only=True)
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
