# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models


def use_persian_for_existing_profiles(apps, schema_editor):
    Profile = apps.get_model("db", "Profile")
    Profile.objects.using(schema_editor.connection.alias).exclude(language="fa").update(language="fa")


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0122_alter_draftissue_assignees_alter_issue_assignees_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="profile",
            name="language",
            field=models.CharField(default="fa", editable=False, max_length=255),
        ),
        # Reversing the schema does not invent prior language preferences.
        migrations.RunPython(use_persian_for_existing_profiles, migrations.RunPython.noop),
    ]
