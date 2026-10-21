"""A small data-only rules language, shared by schema validation and record writes."""

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.core.validators import validate_email, URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework.exceptions import ValidationError


FIELD_KINDS = {
    "short_text": "متن کوتاه",
    "long_text": "متن بلند",
    "rich_text": "متن غنی",
    "integer": "عدد صحیح",
    "decimal": "عدد اعشاری",
    "money": "مبلغ",
    "percent": "درصد",
    "date": "تاریخ شمسی",
    "datetime": "تاریخ و ساعت",
    "date_range": "بازه تاریخ",
    "checkbox": "چک‌باکس",
    "boolean": "بله / خیر",
    "select": "انتخاب تکی",
    "multi_select": "انتخاب چندتایی",
    "tags": "تگ",
    "user": "کاربر",
    "unit": "واحد سازمانی",
    "role": "نقش",
    "file": "فایل / تصویر",
    "url": "لینک",
    "email": "ایمیل",
    "phone": "شماره تلفن",
    "rating": "امتیاز",
    "computed": "محاسباتی",
    "relation": "ارتباط",
}
NUMBER_KINDS = {"integer", "decimal", "money", "percent", "rating"}
MULTI_KINDS = {"multi_select", "tags", "file"}
COMPARE_OPS = {"eq", "ne", "in", "not_in", "empty", "not_empty", "contains", "gt", "gte", "lt", "lte"}


def empty(value):
    return value is None or value == "" or value == []


def validate_condition(rule, fields, depth=0):
    if rule is None:
        return
    if depth > 8 or not isinstance(rule, dict):
        raise ValidationError("ساختار شرط نامعتبر یا بیش از حد تو‌در‌تو است.")
    if rule.get("op") in {"and", "or"}:
        children = rule.get("rules")
        if not isinstance(children, list) or not children or len(children) > 30:
            raise ValidationError("گروه شرط باید یک تا سی شرط داشته باشد.")
        for child in children:
            validate_condition(child, fields, depth + 1)
    elif not isinstance(rule.get("field"), str) or rule.get("field") not in fields or rule.get("op") not in COMPARE_OPS:
        raise ValidationError("فیلد یا عملگر شرط معتبر نیست.")


def condition_fields(rule):
    if not rule:
        return set()
    if rule.get("op") in {"and", "or"}:
        return set().union(*(condition_fields(child) for child in rule.get("rules", [])))
    return {rule["field"]}


def condition(rule, values, fields=None):
    if rule is None:
        return True
    op = rule.get("op")
    if op in {"and", "or"}:
        results = [condition(child, values, fields) for child in rule["rules"]]
        return all(results) if op == "and" else any(results)
    left, right = values.get(rule["field"]), rule.get("value")
    if isinstance(right, dict) and right.get("dynamic") == "today":
        right = timezone.localdate().isoformat()
    kind = (fields or {}).get(rule["field"], {}).get("kind")
    if not empty(left) and not empty(right):
        try:
            if kind in NUMBER_KINDS or kind == "computed":
                left = Decimal(str(left))
                right = [Decimal(str(v)) for v in right] if isinstance(right, list) else Decimal(str(right))
            elif kind == "datetime":
                left = datetime.fromisoformat(str(left).replace("Z", "+00:00"))
                right = datetime.fromisoformat(str(right).replace("Z", "+00:00"))
                if right.tzinfo is None:
                    right = timezone.make_aware(right)
        except (ValueError, TypeError, InvalidOperation):
            return False
    if op == "empty":
        return empty(left)
    if op == "not_empty":
        return not empty(left)
    if op == "eq":
        return type(left) is type(right) and left == right
    if op == "ne":
        return not (type(left) is type(right) and left == right)
    if op in {"in", "not_in"}:
        found = left in right if isinstance(right, list) else False
        return found if op == "in" else not found
    if op == "contains":
        return (isinstance(left, str) and isinstance(right, str) and right in left) or (
            isinstance(left, list) and right in left
        )
    if empty(left) or empty(right):
        return False
    try:
        return {
            "gt": lambda: left > right,
            "gte": lambda: left >= right,
            "lt": lambda: left < right,
            "lte": lambda: left <= right,
        }[op]()
    except (TypeError, KeyError):
        return False


def formula_fields(node, depth=0):
    if depth > 12 or not isinstance(node, dict):
        raise ValidationError("فرمول معتبر نیست یا بیش از حد پیچیده است.")
    if "field" in node:
        if not isinstance(node["field"], str):
            raise ValidationError("کد فیلد مرجع فرمول باید متن باشد.")
        return {node["field"]}
    if "value" in node or node.get("dynamic") == "today":
        return set()
    if node.get("op") not in {"add", "subtract", "multiply", "divide", "date_diff"}:
        raise ValidationError("عملیات فرمول پشتیبانی نمی‌شود.")
    if not isinstance(node.get("args"), list) or len(node["args"]) != 2:
        raise ValidationError("هر عملیات فرمول دقیقاً دو ورودی دارد.")
    return set().union(*(formula_fields(arg, depth + 1) for arg in node["args"]))


def formula(node, values):
    if "field" in node:
        return values.get(node["field"])
    if "value" in node:
        return node["value"]
    if node.get("dynamic") == "today":
        return timezone.localdate().isoformat()
    left, right = (formula(arg, values) for arg in node["args"])
    if empty(left) or empty(right):
        return None
    if node["op"] == "date_diff":
        return (date.fromisoformat(str(left)[:10]) - date.fromisoformat(str(right)[:10])).days
    a, b = Decimal(str(left)), Decimal(str(right))
    result = {"add": lambda: a + b, "subtract": lambda: a - b, "multiply": lambda: a * b, "divide": lambda: a / b}[
        node["op"]
    ]()
    if not result.is_finite():
        raise ValueError("non-finite result")
    return float(result)


def compute(fields, values, strict=True):
    result, visiting, done = dict(values), set(), set()

    def visit(code):
        if code in done:
            return
        if code in visiting:
            raise ValidationError({code: "وابستگی حلقوی در فرمول‌ها وجود دارد."})
        visiting.add(code)
        field = fields[code]
        if field["kind"] == "computed":
            node = field.get("config", {}).get("formula")
            for dependency in formula_fields(node):
                if dependency not in fields:
                    raise ValidationError({code: "فیلد مرجع فرمول وجود ندارد."})
                visit(dependency)
            try:
                result[code] = formula(node, result)
            except (ValueError, TypeError, InvalidOperation, ArithmeticError):
                if strict:
                    raise ValidationError({code: "محاسبه فرمول ممکن نیست؛ نوع ورودی یا تقسیم بر صفر را بررسی کنید."})
                result[code] = None
        visiting.remove(code)
        done.add(code)

    for code in fields:
        visit(code)
    return result


def validate_regex(pattern):
    """Reject backtracking-dangerous regex structure before accepting administrator input."""
    if not isinstance(pattern, str) or len(pattern) > 256:
        raise ValidationError("الگوی اعتبارسنجی باید حداکثر ۲۵۶ نویسه باشد.")
    try:
        from re import _parser, _constants

        tree = _parser.parse(pattern)

        def walk(nodes, repeated=False):
            for op, arg in nodes:
                if op in {_constants.GROUPREF, _constants.GROUPREF_EXISTS}:
                    raise ValueError()
                if op in {_constants.MAX_REPEAT, _constants.MIN_REPEAT, _constants.POSSESSIVE_REPEAT}:
                    if repeated:
                        raise ValueError()
                    walk(arg[2], True)
                elif op == _constants.SUBPATTERN:
                    walk(arg[3], repeated)
                elif op == _constants.BRANCH:
                    if repeated:
                        raise ValueError()
                    for branch in arg[1]:
                        walk(branch, repeated)
                elif op in {_constants.ASSERT, _constants.ASSERT_NOT}:
                    if repeated:
                        raise ValueError()
                    walk(arg[1], repeated)

        walk(tree)
    except (re.error, ValueError, OverflowError):
        raise ValidationError("الگوی نامعتبر یا دارای تکرار پیچیده است؛ از یک الگوی ساده‌تر استفاده کنید.")


def normalize(field, value):
    kind, config = field["kind"], field.get("config", {})
    if empty(value):
        return None
    error = "مقدار با نوع یا محدودیت این فیلد مطابقت ندارد."
    try:
        if kind in NUMBER_KINDS:
            if isinstance(value, bool):
                raise ValueError()
            number = Decimal(str(value))
            if not number.is_finite() or abs(number) > Decimal("1e30"):
                raise ValueError()
            if kind in {"integer", "rating"} and number != number.to_integral_value():
                raise ValueError()
            if kind == "percent" and not 0 <= number <= 100:
                raise ValueError()
            if kind == "rating" and not 0 <= number <= config.get("stars", 5):
                raise ValueError()
            if "min" in config and number < Decimal(str(config["min"])):
                raise ValueError()
            if "max" in config and number > Decimal(str(config["max"])):
                raise ValueError()
            # Money/decimal remain exact decimal strings in JSONB; typed query casts can index them.
            return int(number) if kind in {"integer", "rating"} else float(number) if kind == "percent" else str(number)
        if kind in {"boolean", "checkbox"}:
            if not isinstance(value, bool):
                raise ValueError()
            return value
        if kind == "date":
            return date.fromisoformat(value).isoformat()
        if kind == "datetime":
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError()
            return parsed.isoformat()
        if kind == "date_range":
            if not isinstance(value, dict) or set(value) != {"start", "end"}:
                raise ValueError()
            start, end = date.fromisoformat(value["start"]), date.fromisoformat(value["end"])
            if start > end:
                raise ValueError()
            return {"start": start.isoformat(), "end": end.isoformat()}
        multi = kind in MULTI_KINDS or kind in {"relation", "user", "unit", "role"} and config.get("multiple")
        if multi:
            if not isinstance(value, list) or len(value) > 100 or any(not isinstance(v, str) for v in value):
                raise ValueError()
            if len(value) != len(set(value)):
                raise ValueError()
            return value
        if not isinstance(value, str) or len(value) > (100000 if kind in {"long_text", "rich_text"} else 4096):
            raise ValueError()
        if len(value) < config.get("min_length", 0) or len(value) > config.get("max_length", 100000):
            raise ValueError()
        if config.get("regex"):
            validate_regex(config["regex"])
            if not re.fullmatch(config["regex"], value[:4096]):
                raise ValidationError(config.get("regex_message") or "مقدار با الگوی تعیین‌شده مطابقت ندارد.")
        if kind == "email":
            validate_email(value)
        if kind == "url":
            URLValidator(schemes=["http", "https"])(value)
        if kind == "phone" and not re.fullmatch(r"\+?[\d\s()\-]{5,30}", value):
            raise ValueError()
        if kind == "rich_text":
            from plane.utils.content_validator import validate_html_content

            valid, _, sanitized = validate_html_content(value)
            if not valid:
                raise ValueError()
            return sanitized if sanitized is not None else value
        return value
    except (ValueError, TypeError, InvalidOperation, DjangoValidationError, OverflowError):
        raise ValidationError(error)
