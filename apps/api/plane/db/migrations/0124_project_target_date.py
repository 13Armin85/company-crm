# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0123_profile_persian_language"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="target_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
