"""Readable user labels for record choices and exported relation values."""

import re


def user_label(user):
    full_name = " ".join(str(getattr(user, part, "") or "").strip() for part in ("first_name", "last_name")).strip()
    return full_name or next(
        (
            str(value).strip()
            for name in ("display_name", "username", "email")
            if (value := getattr(user, name, ""))
            and str(value).strip()
            and not str(value).strip().isdecimal()
            and not re.fullmatch(
                r"[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", str(value).strip()
            )
        ),
        "کاربر بدون نام",
    )


def user_search_filter(search):
    from django.db.models import Q

    match = Q()
    for word in search.split():
        match &= (
            Q(display_name__icontains=word)
            | Q(first_name__icontains=word)
            | Q(last_name__icontains=word)
            | Q(username__icontains=word)
        )
    return match
