# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.db.models import Notification, UserNotificationPreference

# Third Party imports
from rest_framework import serializers
from django.utils.html import strip_tags
from html import unescape
import re


class NotificationSerializer(BaseSerializer):
    message_text = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    entity_title = serializers.CharField(read_only=True, allow_null=True)
    triggered_by_details = UserLiteSerializer(read_only=True, source="triggered_by")
    is_inbox_issue = serializers.BooleanField(read_only=True)
    is_intake_issue = serializers.BooleanField(read_only=True)
    is_mentioned_notification = serializers.BooleanField(read_only=True)

    def get_project_name(self, notification):
        if not notification.project_id or notification.project.workspace_id != notification.workspace_id:
            return None
        return notification.project.name

    def get_message_text(self, notification):
        html = re.sub(
            r"<br\s*/?>|</(?:p|div|li|h[1-6])\s*>", "\n", notification.message_html or "", flags=re.IGNORECASE
        )
        text = unescape(strip_tags(html)).strip()
        if text:
            return text
        if notification.message_stripped:
            return notification.message_stripped
        message = notification.message
        if isinstance(message, str):
            return message
        if isinstance(message, dict):
            return "\n".join(str(message[key]) for key in ("description", "body", "text") if message.get(key))
        return ""

    class Meta:
        model = Notification
        fields = "__all__"


class UserNotificationPreferenceSerializer(BaseSerializer):
    class Meta:
        model = UserNotificationPreference
        fields = "__all__"
