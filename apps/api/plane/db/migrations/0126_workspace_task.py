# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0125_add_review_state"),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkspaceTask",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                (
                    "id",
                    models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True),
                ),
                ("name", models.CharField(max_length=255)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("todo", "Todo"),
                            ("in_progress", "In Progress"),
                            ("review", "Review"),
                            ("done", "Done"),
                            ("blocked", "Blocked"),
                        ],
                        default="todo",
                        max_length=20,
                    ),
                ),
                (
                    "priority",
                    models.CharField(
                        choices=[
                            ("urgent", "Urgent"),
                            ("high", "High"),
                            ("medium", "Medium"),
                            ("low", "Low"),
                            ("none", "None"),
                        ],
                        default="none",
                        max_length=20,
                    ),
                ),
                ("sequence_id", models.PositiveIntegerField()),
                ("target_date", models.DateField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "assignee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="assigned_workspace_tasks",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="workspace_tasks",
                        to="db.workspace",
                    ),
                ),
            ],
            options={"db_table": "workspace_tasks", "ordering": ("-created_at",)},
        ),
        migrations.AddConstraint(
            model_name="workspacetask",
            constraint=models.UniqueConstraint(
                fields=("workspace", "sequence_id"),
                name="workspace_task_unique_sequence",
            ),
        ),
    ]
