# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import WorkspaceMember, WorkspaceTask

from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.app.services.entity_choices import ConfiguredChoiceField
from .issue import WorkNumberListSerializer


class WorkspaceTaskSerializer(BaseSerializer):
    work_number = serializers.SerializerMethodField()
    status = ConfiguredChoiceField(adapter="ticket",original_choices=WorkspaceTask.Status.values,required=False,max_length=50)
    assignee_id = serializers.UUIDField()
    assignee_detail = UserLiteSerializer(source="assignee", read_only=True)

    created_by_detail = UserLiteSerializer(source="created_by", read_only=True)
    was_assigned_to_me = serializers.BooleanField(read_only=True)

    class Meta:
        model = WorkspaceTask
        list_serializer_class = WorkNumberListSerializer
        fields = [
            "id",
            "work_number",
            "name",
            "status",
            "priority",
            "sequence_id",
            "target_date",
            "completed_at",
            "assignee_id",
            "assignee_detail",
            "created_at",
            "updated_at",
            "created_by",
            "created_by_detail",
            "was_assigned_to_me",
        ]
        read_only_fields = [
            "id",
            "work_number",
            "sequence_id",
            "completed_at",
            "created_at",
            "updated_at",
            "created_by",
            "created_by_detail",
        ]

    def get_work_number(self, issue):
        number = getattr(self, "_work_numbers", {}).get(issue.id)
        if number:
            return number
        from plane.db.models import EntityRecord

        return EntityRecord.objects.filter(entity__code="ticket", entity__parent__isnull=True, source_id=issue.id).values_list("number", flat=True).first()

    def validate_assignee_id(self, value):
        if not WorkspaceMember.objects.filter(
            workspace_id=self.context["workspace_id"],
            member_id=value,
            is_active=True,
            member__is_bot=False,
        ).exists():
            raise serializers.ValidationError("مسئول باید عضو فعال تیم باشد.")
        return value

