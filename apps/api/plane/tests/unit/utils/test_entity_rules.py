import pytest
from rest_framework.exceptions import ValidationError

from plane.app.services.entity_rules import normalize, compute, condition, validate_regex

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "kind,value",
    [
        ("integer", True),
        ("integer", 1.2),
        ("decimal", "NaN"),
        ("percent", 101),
        ("date", "2026-02-30"),
        ("datetime", "2026-10-19T12:00:00"),
        ("rating", -1),
        ("boolean", "false"),
        ("email", "invalid"),
        ("url", "javascript:alert(1)"),
    ],
)
def test_invalid_typed_value(kind, value):
    with pytest.raises(ValidationError):
        normalize({"kind": kind, "config": {}}, value)


def test_zero_false_are_not_empty_and_nested_conditions():
    rule = {
        "op": "and",
        "rules": [
            {"field": "zero", "op": "not_empty"},
            {
                "op": "or",
                "rules": [{"field": "flag", "op": "eq", "value": False}, {"field": "zero", "op": "gt", "value": 9}],
            },
        ],
    }
    assert condition(rule, {"zero": 0, "flag": False})


def test_formula_cycle_and_division_by_zero_are_explicit_errors():
    fields = {"a": {"kind": "computed", "config": {"formula": {"field": "a"}}}}
    with pytest.raises(ValidationError):
        compute(fields, {})
    fields = {"a": {"kind": "computed", "config": {"formula": {"op": "divide", "args": [{"value": 2}, {"value": 0}]}}}}
    with pytest.raises(ValidationError):
        compute(fields, {})


def test_simple_regex_supported_dangerous_pattern_rejected():
    validate_regex(r"[A-Z]{2}-\d{3}")
    assert normalize({"kind": "short_text", "config": {"regex": r"[A-Z]{2}-\d{3}"}}, "AB-123") == "AB-123"
    with pytest.raises(ValidationError):
        validate_regex("(a+)+$")


def test_money_and_datetime_conditions_use_typed_values():
    fields = {"amount": {"kind": "money"}, "when": {"kind": "datetime"}}
    assert condition(
        {"field": "amount", "op": "gt", "value": "9007199254740992.01"}, {"amount": "9007199254740992.02"}, fields
    )
    assert condition({"field": "amount", "op": "eq", "value": "12.10"}, {"amount": "12.1"}, fields)
    assert condition(
        {"field": "when", "op": "eq", "value": "2026-10-19T08:30:00Z"}, {"when": "2026-10-19T12:00:00+03:30"}, fields
    )
    assert not condition({"field": "text", "op": "contains", "value": {}}, {"text": "safe"})


def test_today_default_respects_datetime_and_date_range_types():
    from datetime import datetime, timedelta
    from django.utils import timezone
    from plane.app.services.entity_records import default_value

    datetime_field = {"kind": "datetime", "config": {"default_dynamic": "today"}}
    with timezone.override("Asia/Tehran"):
        parsed = datetime.fromisoformat(normalize(datetime_field, default_value(datetime_field, None)))
        assert parsed.hour == 0 and parsed.minute == 0
        assert parsed.utcoffset() == timedelta(hours=3, minutes=30)
    range_field = {"kind": "date_range", "config": {"default_dynamic": "today"}}
    value = default_value(range_field, None)
    assert value["start"] == value["end"]
    assert normalize(range_field, value) == value
