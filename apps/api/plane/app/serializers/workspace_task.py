# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import WorkspaceMember, WorkspaceTask

from .base import BaseSerializer
from .user import UserLiteSerializer


class WorkspaceTaskSerializer(BaseSerializer):
    assignee_id = serializers.UUIDField()
    assignee_detail = UserLiteSerializer(source="assignee", read_only=True)

    class Meta:
        model = WorkspaceTask
        fields = [
            "id",
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
        ]
        read_only_fields = [
            "id",
            "sequence_id",
            "completed_at",
            "created_at",
            "updated_at",
            "created_by",
        ]

    def validate_assignee_id(self, value):
        if not WorkspaceMember.objects.filter(
            workspace_id=self.context["workspace_id"],
            member_id=value,
            is_active=True,
            member__is_bot=False,
        ).exists():
            raise serializers.ValidationError("مسئول باید عضو فعال تیم باشد.")
        return value

