"""Server-side paging and search shared by every CRM table.

A list endpoint stays backwards compatible: callers that do not send ``page``
still receive the full list (selectors, exports). Tables send ``page`` and get
an envelope with the current slice and the totals needed for the pager.
"""

from math import ceil

from django.db.models import Q
from rest_framework.response import Response

PAGE_SIZES = (10, 25, 50, 100)
DEFAULT_PAGE_SIZE = 25
# Persian keyboards and imported data mix Arabic and Persian letter forms.
_VARIANTS = (("ي", "ی"), ("ك", "ک"), ("ة", "ه"), ("ۀ", "ه"))


def wants_page(request):
    return "page" in request.query_params


def page_params(request):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = int(request.query_params.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        size = DEFAULT_PAGE_SIZE
    return page, size if size in PAGE_SIZES else DEFAULT_PAGE_SIZE


def normalize(text):
    text = (text or "").strip().lower()
    for arabic, persian in _VARIANTS:
        text = text.replace(arabic, persian)
    return text


def search_terms(request, param="q"):
    return [term for term in normalize(request.query_params.get(param, "")).split() if term]


def search_q(terms, fields):
    """Every term must match at least one field, in either letter form."""
    query = Q()
    for term in terms:
        forms = {term}
        for arabic, persian in _VARIANTS:
            forms.add(term.replace(persian, arabic))
        any_field = Q()
        for field in fields:
            for form in forms:
                any_field |= Q(**{f"{field}__icontains": form})
        query &= any_field
    return query


def matches_terms(terms, values):
    """In-memory counterpart of ``search_q`` for rows built in Python."""
    haystack = normalize(" ".join(str(value) for value in values if value))
    return all(term in haystack for term in terms)


def list_values(request, param):
    raw = request.query_params.get(param, "")
    return [value for value in raw.split(",") if value]


def paginate(request, items, serialize, extra=None):
    page, size = page_params(request)
    count = len(items) if isinstance(items, list) else items.count()
    pages = max(1, ceil(count / size))
    page = min(page, pages)
    chunk = items[(page - 1) * size : page * size]
    return Response(
        {
            "results": serialize(chunk),
            "count": count,
            "page": page,
            "page_size": size,
            "pages": pages,
            **(extra or {}),
        }
    )
