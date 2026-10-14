# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re
from uuid import UUID

# Django imports
from django.db.models import Q

# Module imports


def search_issues(query, queryset):
    query = query.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    if not query:
        return queryset
    try:
        identifier = UUID(query)
    except ValueError:
        pass
    else:
        return queryset.filter(id=identifier)

    reference = re.fullmatch(r"(.+?)\s*-\s*([0-9]{1,10})", query)
    if reference:
        sequence_id = int(reference[2])
        if sequence_id > 2147483647:
            return queryset.none()
        return queryset.filter(project__identifier__iexact=reference[1].strip(), sequence_id=sequence_id)

    q = Q(name__icontains=query) | Q(project__identifier__icontains=query)
    if re.fullmatch(r"[0-9]{1,10}", query) and int(query) <= 2147483647:
        q |= Q(sequence_id=int(query))
    return queryset.filter(q).distinct()


def search_workspace_tasks(query, queryset):
    query = query.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    if not query:
        return queryset
    try:
        identifier = UUID(query)
    except ValueError:
        pass
    else:
        return queryset.filter(id=identifier)
    reference = re.fullmatch(r"TEAM\s*-\s*([0-9]{1,10})", query, re.IGNORECASE)
    if reference:
        sequence_id = int(reference[1])
        return queryset.filter(sequence_id=sequence_id) if sequence_id <= 2147483647 else queryset.none()
    q = Q(name__icontains=query)
    if re.fullmatch(r"[0-9]{1,10}", query) and int(query) <= 2147483647:
        q |= Q(sequence_id=int(query))
    return queryset.filter(q)
