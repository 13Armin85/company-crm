"""Validated, permission-aware PostgreSQL queries shared by every CRM view/export.

Relations use correlated subqueries, never joins that duplicate base records. For a
multi-valued relation the display contains all values; sort/group/aggregate use its
minimum scalar value per base record. Filters use existential semantics (negative
operators mean no related value matches). User input never supplies SQL/ORM paths.
"""

from copy import deepcopy
from datetime import datetime, time
from decimal import Decimal
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.postgres.expressions import ArraySubquery
from django.db import models
from django.db.models import (
    Q,
    F,
    Value,
    OuterRef,
    Subquery,
    Exists,
    Case,
    When,
    Sum,
    Avg,
    Count,
    Min,
    Max,
)
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Cast, Coalesce, NullIf
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied

from plane.db.models import (
    EntityType,
    IssueAssignee,
    TicketRoutingDecision,
    Issue,
    LookupValue,
    State,
    User,
    OrganizationUnit,
    OrganizationRole,
    FileAsset,
)
from .entity_records import (
    record_queryset,
    require_action,
    ADAPTERS,
    json_value,
    edit_grants,
    field_edit_action,
)
from .entity_schema import schema_fields, role_ids, can_field
from .entity_rules import normalize, condition_fields, formula_fields
from .access_control import has_permission

NUMERIC = {"integer", "decimal", "money", "percent", "rating", "computed"}
TEXT = {"short_text", "long_text", "rich_text", "url", "email", "phone"}
MULTI = {"multi_select", "tags", "file"}
VIEWS = {"table", "kanban", "list", "calendar", "cards"}


class ToJSON(models.Func):
    function = "to_jsonb"
    output_field = models.JSONField()


class TypedNumeric(Cast):
    """PostgreSQL numeric without a lossy scale/precision cast on stored decimals."""

    def as_postgresql(self, compiler, connection, **extra_context):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"({sql})::numeric", params


class JSONContains(models.Func):
    template = "(%(expressions)s)"
    arg_joiner = " @> "
    output_field = models.BooleanField()


class RelationMatch(models.Func):
    output_field = models.BooleanField()

    def __init__(self, identifier, parent, multiple=False):
        self.multiple = multiple
        super().__init__(identifier, parent)

    def as_sql(self, compiler, connection, **extra_context):
        target, tp = compiler.compile(self.source_expressions[0])
        parent, pp = compiler.compile(self.source_expressions[1])
        if self.multiple:
            return (
                f"({target} = ANY(ARRAY(SELECT x::uuid FROM jsonb_array_elements_text("
                f"CASE WHEN jsonb_typeof({parent}) = 'array' THEN {parent} ELSE '[]'::jsonb END) x)))",
                [*tp, *pp, *pp],
            )
        return f"({target} = (({parent}) #>> '{{}}')::uuid)", [*tp, *pp]


class DateDays(models.Func):
    output_field = models.DecimalField(max_digits=38, decimal_places=12)

    def as_sql(self, compiler, connection, **extra_context):
        a, ap = compiler.compile(self.source_expressions[0])
        b, bp = compiler.compile(self.source_expressions[1])
        return f"(({a})::date - ({b})::date)", [*ap, *bp]


class ISODate(models.Func):
    """Immutable ISO date conversion, suitable for PostgreSQL expression indexes."""

    output_field = models.DateField()

    def as_sql(self, compiler, connection, **extra_context):
        sql, params = compiler.compile(self.source_expressions[0])
        return (
            f"make_date(substring({sql},1,4)::integer, substring({sql},6,2)::integer, substring({sql},9,2)::integer)",
            [*params, *params, *params],
        )


def output_type(kind):
    if kind in NUMERIC:
        return models.DecimalField(max_digits=38, decimal_places=12)
    if kind == "date":
        return models.DateField()
    if kind == "datetime":
        return models.DateTimeField()
    if kind in {"checkbox", "boolean", "$active"}:
        return models.BooleanField()
    return models.TextField()


def allowed_operators(field):
    kind = field["kind"]
    if kind == "file":
        return ["empty", "not_empty", "contains"]
    ops = ["eq", "ne", "in", "not_in", "empty", "not_empty"]
    if kind in TEXT | MULTI or field["config"].get("multiple"):
        ops += ["contains"]
    if kind in NUMERIC | {"date", "datetime"}:
        ops += ["gt", "gte", "lt", "lte"]
    return ops


def group_key(value):
    if isinstance(value, Decimal):
        text = format(value, "f")
        text = text.rstrip("0").rstrip(".") if "." in text else text
        return "number:" + ("0" if text in {"-0", ""} else text)
    return json.dumps(
        json_value(value), sort_keys=True, ensure_ascii=True, separators=(",", ":")
    )


def default_definition(entity, fields):
    columns = [{"field": entity.title_field, "width": 240, "pin": "right"}]
    columns += [
        {"field": code, "width": 170}
        for code, f in fields.items()
        if code != entity.title_field and f.get("table_visible")
    ][:7]
    return {
        "version": 1,
        "type": "table",
        "columns": columns,
        "sort": [],
        "filter": None,
        "group": None,
        "settings": {},
    }


class EntityQuery:
    def __init__(self, entity, user, request=None, subtype=None, depth=0, context=None):
        self.entity, self.user, self.request, self.subtype = (
            entity,
            user,
            request,
            subtype,
        )
        try:
            self.time_zone = ZoneInfo(user.user_timezone or "Asia/Tehran")
        except (ValueError, ZoneInfoNotFoundError):
            self.time_zone = ZoneInfo("Asia/Tehran")
        self.depth, self.context = depth, context if context is not None else {}
        require_action(entity, user, "view", request)
        self.grants = edit_grants(entity, user, request)
        self.can_edit = any(self.grants.values())
        key = (str(entity.id), str(subtype.id) if subtype else "")
        if key not in self.context:
            _, definitions = schema_fields(entity, subtype)
            roles = role_ids(user, entity.workspace)
            self.context[key] = {
                code: f
                for code, f in definitions.items()
                if f["is_active"]
                and can_field(f, roles)
                and not f["config"].get("hidden")
                and not f["config"].get("secret")
                and not f["binding"].get("stage")
                and (
                    not f["config"].get("relation_id")
                    or has_permission(
                        user, entity.workspace, "Relation.View", request=request
                    )
                )
            }
            for field in self.context[key].values():
                field["config"]["readonly"] = bool(
                    field["config"].get("readonly")
                    or field["config"].get("editable_after_create") is False
                    or not can_field(field, roles, edit=True)
                    or not self.grants[field_edit_action(entity, field)]
                    or field["kind"] == "computed"
                )
        self.fields = deepcopy(self.context[key])
        from .entity_lookups import lookup_allowed

        self.fields = {
            code: field
            for code, field in self.fields.items()
            if lookup_allowed(entity, user, field, request)
        }
        # A computed/conditional field cannot become a channel to a restricted dependency.
        while True:
            removed = []
            for code, field in self.fields.items():
                dependencies = (
                    formula_fields(field["config"]["formula"])
                    if field["config"].get("formula")
                    else set()
                )
                dependencies |= condition_fields(field["config"].get("visible_if"))
                if not dependencies.issubset(self.fields):
                    removed.append(code)
            if not removed:
                break
            for code in removed:
                self.fields.pop(code)
        self.rows = record_queryset(entity, user, request)
        if subtype:
            self.rows = self.rows.filter(subtype=subtype)
        self.scope_aliases = []
        if entity.adapter == "leave" and self.grants["edit"]:
            from .access_control import can_manage_absence

            targets = User.objects.filter(
                member_workspace__workspace=entity.workspace,
                member_workspace__is_active=True,
                member_workspace__deleted_at__isnull=True,
            ).distinct()
            allowed = [
                target.id
                for target in targets
                if can_manage_absence(
                    user, target, entity.workspace, "Absence.Edit", request=request
                )
            ]
            self.rows = self.rows.annotate(
                _edit_leave=Exists(
                    ADAPTERS["leave"].objects.filter(
                        id=OuterRef("source_id"), user_id__in=allowed
                    )
                )
            )
            self.scope_aliases.append("_edit_leave")
        if not self.grants["edit"] and entity.adapter in {"task", "ticket"}:
            assigned = (
                ADAPTERS["task"].objects.filter(id=OuterRef("source_id"), assignee=user)
                if entity.adapter == "task"
                else IssueAssignee.objects.filter(
                    issue_id=OuterRef("source_id"), assignee=user
                )
            )
            self.rows = self.rows.annotate(_edit_assigned=Exists(assigned))
            self.scope_aliases.append("_edit_assigned")
            if entity.adapter == "ticket" and self.grants["assign"]:
                from plane.db.models import Project, ProjectMember
                from .task_policy import is_workspace_administrator

                if is_workspace_administrator(user, entity.workspace):
                    manager = Value(True, output_field=models.BooleanField())
                else:
                    owned = (
                        Project.objects.filter(workspace=entity.workspace)
                        .filter(Q(created_by=user) | Q(project_lead=user))
                        .values("id")
                    )
                    memberships = ProjectMember.objects.filter(
                        workspace=entity.workspace,
                        member=user,
                        is_active=True,
                        project_id__in=owned,
                    ).values("project_id")
                    manager = Exists(
                        Issue.objects.filter(
                            id=OuterRef("source_id"), project_id__in=memberships
                        )
                    )
                self.rows = self.rows.annotate(_edit_manager=manager)
                self.scope_aliases.append("_edit_manager")
        self.aliases, self.paths, self.warnings = {}, {}, []

    def child(self, field):
        if self.depth >= 3:
            raise ValidationError("مسیر ارتباط حداکثر سه سطح دارد.")
        key = ("entity", field["relation_entity"])
        if key not in self.context:
            self.context[key] = EntityType.objects.get(
                workspace=self.entity.workspace,
                code=field["relation_entity"],
                parent__isnull=True,
            )
        return EntityQuery(
            self.context[key],
            self.user,
            self.request,
            depth=self.depth + 1,
            context=self.context,
        )

    def describe(self, path, capability=None):
        if not isinstance(path, str) or len(path) > 400 or len(path.split(".")) > 4:
            raise ValidationError(
                "مسیر ستون معتبر نیست؛ حداکثر سه سطح ارتباط مجاز است."
            )
        head, *tail = path.split(".", 1)
        field = self.fields.get(head)
        if not field:
            raise ValidationError(
                {"field": f"فیلد «{head}» غیرفعال، ناموجود یا خارج از دسترسی است."}
            )
        if capability and not field.get(capability):
            raise ValidationError(
                {"field": f"این فیلد برای عملیات {capability} مجاز نیست."}
            )
        if tail:
            if field["kind"] != "relation":
                raise ValidationError("ادامه مسیر فقط روی فیلد ارتباطی مجاز است.")
            result = self.child(field).describe(tail[0], capability)
            return {
                **result,
                "path": path,
                "title": field["title"] + " ← " + result["title"],
                "multiple_path": True,
            }
        return {**field, "path": path, "operators": allowed_operators(field)}

    def source_expression(self, field):
        kind, code = field["kind"], field["code"]
        source = field["binding"].get("source")
        if field["config"].get("relation_lookup"):
            lookup = field["config"]["relation_lookup"]
            head, tail = lookup["path"].split(".", 1)
            child = self.relation_query(head)
            final = child.scalar(tail)
            aggregation = lookup["aggregation"]
            if aggregation == "list":
                return ToJSON(ArraySubquery(child.rows.order_by("id").values(final)))
            if aggregation == "single":
                return Subquery(child.rows.order_by("id").values(final)[:1])
            function = {"count": Count, "sum": Sum, "avg": Avg, "min": Min, "max": Max}[
                aggregation
            ]
            rows = (
                child.rows.order_by()
                .annotate(_lookup_group=Value(1))
                .values("_lookup_group")
                .annotate(
                    _lookup_result=function("id" if aggregation == "count" else final)
                )
                .values("_lookup_result")
            )
            expression = Subquery(rows[:1])
            return (
                Coalesce(expression, Value(0)) if aggregation == "count" else expression
            )
        multiple = kind in MULTI or field["config"].get("multiple")
        if field["config"].get("formula"):
            return self.formula_expression(field["config"]["formula"])
        if source and self.entity.adapter:
            if self.entity.adapter == "user" and source == "role_ids":
                from plane.db.models import UserOrganizationRole

                return ToJSON(
                    ArraySubquery(
                        UserOrganizationRole.objects.filter(
                            workspace=self.entity.workspace,
                            user_id=OuterRef("source_id"),
                            is_active=True,
                            role__is_active=True,
                        )
                        .order_by("role_id")
                        .values("role_id")
                    )
                )
            if source == "assignee_ids":
                return ToJSON(
                    ArraySubquery(
                        IssueAssignee.objects.filter(issue_id=OuterRef("source_id"))
                        .order_by("assignee_id")
                        .values("assignee_id")
                    )
                )
            native = ADAPTERS[self.entity.adapter].objects.filter(
                id=OuterRef("source_id")
            )
            if source == "work_status" and self.entity.adapter == "ticket":
                from .unified_work import work_status_expression

                return Subquery(
                    native.annotate(_work_status=work_status_expression()).values(
                        "_work_status"
                    )[:1]
                )
            expression = Subquery(native.values(source)[:1])
            return Cast(expression, output_type(kind))
        if multiple or kind == "date_range":
            return KeyTransform(code, F("data"))
        if kind == "date":
            return ISODate(KeyTextTransform(code, F("data")))
        if kind in NUMERIC:
            return TypedNumeric(KeyTextTransform(code, F("data")), output_type(kind))
        return Cast(KeyTextTransform(code, F("data")), output_type(kind))

    def formula_expression(self, node):
        if "field" in node:
            code = node["field"]
            self.describe(code)
            return F(self.scalar(code))
        if "dynamic" in node:
            return Value(
                timezone.localdate(timezone=self.time_zone),
                output_field=models.DateField(),
            )
        if "value" in node:
            value = node["value"]
            if isinstance(value, str) and "-" in value:
                return Cast(Value(value), models.DateField())
            return Value(Decimal(str(value)), output_field=output_type("computed"))
        a, b = [self.formula_expression(n) for n in node["args"]]
        op = node["op"]
        if op == "date_diff":
            # PostgreSQL date - date is an integer day count.
            return DateDays(a, b)
        expression = {
            "add": lambda: a + b,
            "subtract": lambda: a - b,
            "multiply": lambda: a * b,
            "divide": lambda: a / NullIf(b, Value(0)),
        }[op]()
        return models.ExpressionWrapper(
            expression, output_field=output_type("computed")
        )

    def relation_query(self, head):
        field = self.fields[head]
        child = self.child(field)
        key = f"relation:{head}"
        if key not in self.aliases:
            alias = f"_ev{len(self.aliases)}"
            self.aliases[key] = alias
            expression = (
                ToJSON(self.source_expression(field))
                if field["binding"].get("source")
                else KeyTransform(head, F("data"))
            )
            if field["config"].get("visible_if"):
                expression = Case(
                    When(
                        self.predicate(field["config"]["visible_if"], visibility=True),
                        then=expression,
                    ),
                    default=Value(None),
                    output_field=models.JSONField(),
                )
            self.rows = self.rows.annotate(**{alias: expression})
        alias = self.aliases[key]
        identifier = F("source_id" if child.entity.adapter else "id")
        child.rows = child.rows.annotate(_relation_parent=OuterRef(alias)).filter(
            RelationMatch(
                identifier,
                F("_relation_parent"),
                field["config"].get("multiple", False),
            )
        )
        return child

    def scalar(self, path):
        if path in self.aliases:
            return self.aliases[path]
        self.describe(path)
        alias = f"_ev{len(self.aliases)}"
        self.aliases[path] = alias
        head, *tail = path.split(".", 1)
        field = self.fields[head]
        if tail:
            child = self.relation_query(head)
            final = child.scalar(tail[0])
            expression = Subquery(
                child.rows.order_by(F(final).asc(nulls_last=True), "id").values(final)[
                    :1
                ]
            )
        else:
            expression = self.source_expression(field)
            if field["kind"] == "relation":
                try:
                    child = self.relation_query(head)
                    child.rows = child.rows.annotate(
                        _public_id=Coalesce(
                            Cast(F("source_id"), models.TextField()),
                            Cast(F("id"), models.TextField()),
                        )
                    )
                    expression = (
                        ToJSON(
                            ArraySubquery(
                                child.rows.order_by("id").values("_public_id")
                            )
                        )
                        if field["config"].get("multiple")
                        else ToJSON(
                            Subquery(child.rows.order_by("id").values("_public_id")[:1])
                        )
                    )
                except PermissionDenied:
                    expression = Value(
                        [] if field["config"].get("multiple") else None,
                        output_field=models.JSONField(),
                    )
            rule = field["config"].get("visible_if")
            if rule:
                raw_alias = f"_raw{len(self.aliases)}"
                self.rows = self.rows.annotate(**{raw_alias: expression})
                self.aliases[path] = raw_alias
                out = (
                    models.JSONField()
                    if field["kind"] in MULTI | {"relation", "date_range"}
                    or field["config"].get("multiple")
                    else output_type(field["kind"])
                )
                expression = Case(
                    When(self.predicate(rule, visibility=True), then=F(raw_alias)),
                    default=Value(None),
                    output_field=out,
                )
                self.aliases[path] = alias
        self.rows = self.rows.annotate(**{alias: expression})
        return alias

    def display(self, path):
        head, *tail = path.split(".", 1)
        if not tail:
            return self.scalar(path)
        key = f"display:{path}"
        if key in self.aliases:
            return self.aliases[key]
        child = self.relation_query(head)
        final = child.display(tail[0])
        value = (
            Cast(F(final), models.TextField())
            if "." not in tail[0] and child.describe(tail[0])["kind"] in NUMERIC
            else F(final)
        )
        child.rows = child.rows.annotate(_json_display=ToJSON(value))
        alias = f"_ev{len(self.aliases)}"
        self.rows = self.rows.annotate(
            **{alias: ArraySubquery(child.rows.order_by("id").values("_json_display"))}
        )
        self.aliases[key] = alias
        return alias

    def normalize_filter(self, field, value):
        if field["kind"] == "computed" and value is not None:
            try:
                number = Decimal(str(value))
                if not number.is_finite():
                    raise ValueError()
                return number
            except (ValueError, ArithmeticError):
                raise ValidationError("مقدار شرط محاسباتی باید عدد معتبر باشد.")
        if isinstance(value, dict) and value.get("dynamic") in {
            "today",
            "current_user",
        }:
            if value["dynamic"] == "current_user":
                value = str(self.user.id)
            elif field["kind"] == "datetime":
                value = datetime.combine(
                    timezone.localdate(timezone=self.time_zone),
                    time.min,
                    tzinfo=self.time_zone,
                ).isoformat()
            else:
                value = timezone.localdate(timezone=self.time_zone).isoformat()
        config = {
            k: v
            for k, v in field["config"].items()
            if k not in {"min", "max", "min_length", "max_length", "regex", "required"}
        }
        return normalize({**field, "config": config}, value)

    def predicate(self, node, depth=0, visibility=False):
        if not node:
            return Q()
        if not isinstance(node, dict) or depth > 8:
            raise ValidationError("ساختار یا عمق فیلتر معتبر نیست.")
        op = node.get("op")
        if not isinstance(op, str):
            raise ValidationError("عملگر شرط باید متن معتبر باشد.")
        if depth == 0:
            self._predicate_nodes = 0
        self._predicate_nodes = getattr(self, "_predicate_nodes", 0) + 1
        if self._predicate_nodes > 200:
            raise ValidationError("حداکثر دویست شرط در یک فیلتر مجاز است.")
        if op in {"and", "or"}:
            rules = node.get("rules")
            if not isinstance(rules, list) or not rules or len(rules) > 50:
                raise ValidationError("گروه فیلتر باید یک تا پنجاه شرط داشته باشد.")
            result = self.predicate(rules[0], depth + 1, visibility)
            for rule in rules[1:]:
                next_rule = self.predicate(rule, depth + 1, visibility)
                result = result & next_rule if op == "and" else result | next_rule
            return result
        path = node.get("field")
        field = self.describe(path, None if visibility else "filterable")
        if op not in allowed_operators(field):
            raise ValidationError("عملگر با نوع فیلد سازگار نیست.")
        head, *tail = path.split(".", 1)
        if tail:
            child = self.relation_query(head)
            positive = {"ne": "eq", "not_in": "in", "empty": "not_empty"}.get(op, op)
            pred = child.predicate(
                {**node, "field": tail[0], "op": positive}, depth + 1, visibility
            )
            exists = Exists(child.rows.filter(pred))
            return Q(~exists if op in {"ne", "not_in", "empty"} else exists)
        alias = self.scalar(path)
        multiple = field["kind"] in MULTI or field["config"].get("multiple")
        raw = node.get("value")
        if op in {"empty", "not_empty"}:
            empty = Q(**{f"{alias}__isnull": True})
            if field["kind"] in TEXT:
                empty |= Q(**{alias: ""})
            if multiple:
                empty |= Q(**{alias: []})
            return empty if op == "empty" else ~empty
        if op in {"in", "not_in"}:
            if not isinstance(raw, list) or len(raw) > 200:
                raise ValidationError(
                    "مقدار این عملگر باید فهرستی با حداکثر دویست عضو باشد."
                )
            if multiple:
                value = [
                    self.normalize_filter(
                        {**field, "kind": "short_text", "config": {}}, item
                    )
                    for item in raw
                ]
                pred = Q(pk__in=[])
                for item in value:
                    pred |= Q(**{f"{alias}__contains": [item]})
            else:
                values = [self.normalize_filter(field, item) for item in raw]
                pred = Q(
                    **{f"{alias}__in": [value for value in values if value is not None]}
                )
                if None in values:
                    pred |= Q(**{f"{alias}__isnull": True})
            return ~pred if op == "not_in" else pred
        if op == "contains" and multiple:
            if field["kind"] == "file":
                if not isinstance(raw, str):
                    raise ValidationError("نام فایل باید متن باشد.")
                choices = (
                    FileAsset.objects.filter(
                        workspace=self.entity.workspace, attributes__name__icontains=raw
                    )
                    .annotate(_parent_file=OuterRef(alias))
                    .filter(
                        JSONContains(
                            F("_parent_file"), ToJSON(Cast(F("id"), models.TextField()))
                        )
                    )
                )
                pred = Q(Exists(choices))
            else:
                pred = Q(
                    **{f"{alias}__contains": raw if isinstance(raw, list) else [raw]}
                )
        else:
            if op == "contains" and field["kind"] in TEXT:
                if not isinstance(raw, str):
                    raise ValidationError("مقدار جستجوی متن معتبر نیست.")
                value = raw
            else:
                value = self.normalize_filter(field, raw)
            if value is None and op not in {"eq", "ne"}:
                raise ValidationError("برای این مقایسه مقدار غیرخالی لازم است.")
            lookup = {"eq": "exact", "ne": "exact", "contains": "icontains"}.get(op, op)
            pred = Q(**{f"{alias}__{lookup}": value})
        return ~pred if op == "ne" else pred

    def validate(self, spec, tolerant=False):
        if (
            not isinstance(spec, dict)
            or spec.get("version", 1) != 1
            or spec.get("type", "table") not in VIEWS
        ):
            raise ValidationError("نسخه یا نوع نما معتبر نیست.")
        if set(spec) - {
            "version",
            "type",
            "columns",
            "sort",
            "group",
            "filter",
            "settings",
            "subtype",
            "summary",
        }:
            raise ValidationError(
                "گزینه ناشناخته در تعریف نما وجود دارد؛ قواعد رسمی از بخش تنظیمات ظاهر مدیریت می‌شوند."
            )
        columns = spec.get("columns", [])
        if (
            not isinstance(columns, list)
            or (not columns and not tolerant)
            or len(columns) > 80
        ):
            raise ValidationError("نما باید یک تا هشتاد ستون داشته باشد.")
        result, seen = {**deepcopy(spec), "version": 1}, set()
        if "summary" in spec:
            summary = spec["summary"]
            if (
                not isinstance(summary, list)
                or len(summary) > 100
                or any(not isinstance(path, str) for path in summary)
            ):
                raise ValidationError("حداکثر صد ستون برای خلاصه مجاز است.")
            if not tolerant:
                for path in summary:
                    self.describe(path)
            result["summary"] = [path for path in summary if self.path_allowed(path)]
        for column in columns:
            if (
                not isinstance(column, dict)
                or column.get("field") in seen
                or column.get("pin", "") not in {"", "right", "left"}
            ):
                raise ValidationError("ستون تکراری یا تنظیم پین نامعتبر است.")
            seen.add(column.get("field"))
            if (
                not isinstance(column.get("width", 180), (int, float))
                or not 80 <= column.get("width", 180) <= 800
            ):
                raise ValidationError("عرض ستون باید بین ۸۰ و ۸۰۰ باشد.")
            try:
                self.describe(column.get("field"), "table_visible")
            except (ValidationError, PermissionDenied):
                if not tolerant:
                    raise
                self.warnings.append(
                    "ستون ناموجود، غیرفعال یا بدون دسترسی از نمایش کنار گذاشته شد."
                )
        result["columns"] = [
            c for c in columns if self.path_allowed(c["field"], "table_visible")
        ]
        if not result["columns"] and self.path_allowed(
            self.entity.title_field, "table_visible"
        ):
            result["columns"] = [{"field": self.entity.title_field, "width": 240}]
        sorts = spec.get("sort", [])
        if not isinstance(sorts, list) or len(sorts) > 8:
            raise ValidationError("حداکثر هشت مرتب‌سازی مجاز است.")
        for sort in sorts:
            if not isinstance(sort, dict):
                raise ValidationError("تنظیم مرتب‌سازی معتبر نیست.")
            self.describe(sort.get("field"))
            if sort.get("direction") not in {"asc", "desc"}:
                raise ValidationError("جهت مرتب‌سازی معتبر نیست.")
        result["sort"] = [
            sort for sort in sorts if self.path_allowed(sort.get("field"))
        ]
        if spec.get("group"):
            self.describe(spec["group"], "filterable")
        settings = spec.get("settings", {})
        if not isinstance(settings, dict) or set(settings) - {
            "kanban_field",
            "calendar_field",
            "calendar_start",
            "calendar_end",
            "kanban_columns",
        }:
            raise ValidationError("تنظیمات نما معتبر نیست.")
        for key, kinds in {
            "kanban_field": {"select"},
            "calendar_field": {"date", "datetime", "date_range"},
        }.items():
            if settings.get(key) and self.describe(settings[key])["kind"] not in kinds:
                raise ValidationError("فیلد محور نما با نوع نما سازگار نیست.")
        if settings.get("kanban_columns"):
            choices = settings["kanban_columns"]
            if (
                not isinstance(choices, list)
                or len(choices) > 200
                or not settings.get("kanban_field")
            ):
                raise ValidationError("ستون‌های انتخاب‌شده کانبان معتبر نیستند.")
            for value in choices:
                self.normalize_filter(self.describe(settings["kanban_field"]), value)
        if spec.get("filter"):
            self.predicate(spec["filter"])
        return result

    def path_allowed(self, path, capability=None):
        try:
            self.describe(path, capability)
            return True
        except (ValidationError, PermissionDenied):
            return False

    def prepare(self, spec, search="", system=""):
        if not isinstance(search, str):
            raise ValidationError("عبارت جستجو باید متن باشد.")
        self.spec = self.validate(spec, tolerant=True)
        spec = self.spec
        if spec.get("filter"):
            predicate = self.predicate(spec["filter"])
            self.rows = self.rows.filter(predicate)
        settings = spec.get("settings", {})
        if (
            spec.get("type") == "calendar"
            and settings.get("calendar_field")
            and settings.get("calendar_start")
            and settings.get("calendar_end")
        ):
            from datetime import date, timedelta

            try:
                start, end = (
                    date.fromisoformat(settings["calendar_start"]),
                    date.fromisoformat(settings["calendar_end"]),
                )
                if start > end or (end - start).days > 400:
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValidationError("بازه تقویم معتبر نیست.")
            path = settings["calendar_field"]
            field, alias = self.describe(path), self.scalar(path)
            if field["kind"] == "date_range":
                self.rows = self.rows.annotate(
                    _calendar_start=Cast(
                        KeyTextTransform("start", F(alias)), models.DateField()
                    ),
                    _calendar_end=Cast(
                        KeyTextTransform("end", F(alias)), models.DateField()
                    ),
                ).filter(_calendar_start__lte=end, _calendar_end__gte=start)
            elif field["kind"] == "datetime":
                tz = self.time_zone
                self.rows = self.rows.filter(
                    **{
                        f"{alias}__gte": datetime.combine(start, time.min, tzinfo=tz),
                        f"{alias}__lt": datetime.combine(
                            end + timedelta(days=1), time.min, tzinfo=tz
                        ),
                    }
                )
            else:
                self.rows = self.rows.filter(
                    **{f"{alias}__gte": start, f"{alias}__lte": end}
                )
        if search:
            predicate = self.search_predicate(search[:200])
            self.rows = self.rows.filter(predicate)
        if system:
            self.system_filter(system)
        return self

    def search_predicate(self, text):
        canonical = text.translate(
            str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
        )
        result = Q(pk__in=[])
        for code, field in self.fields.items():
            if not field["searchable"]:
                continue
            alias = self.scalar(code)
            search_alias = f"_search{len(self.aliases)}"
            self.rows = self.rows.annotate(
                **{search_alias: Cast(F(alias), models.TextField())}
            )
            self.aliases[f"search:{code}"] = search_alias
            result |= Q(**{f"{search_alias}__icontains": text}) | Q(
                **{f"{search_alias}__icontains": canonical}
            )
            choices = None
            if field.get("lookup"):
                choices = LookupValue.objects.filter(
                    category__workspace=self.entity.workspace,
                    category__code=field["lookup"],
                    title__icontains=text,
                )
                key = (
                    F("code")
                    if field["config"].get("lookup_codes")
                    else Cast(F("id"), models.TextField())
                )
            elif field["config"].get("provider") == "project_states":
                choices = State.objects.filter(
                    workspace=self.entity.workspace, name__icontains=text
                )
                key = Cast(F("id"), models.TextField())
            elif field["kind"] in {"user", "unit", "role"}:
                model = {
                    "user": User,
                    "unit": OrganizationUnit,
                    "role": OrganizationRole,
                }[field["kind"]]
                scope = (
                    {"member_workspace__workspace": self.entity.workspace}
                    if field["kind"] == "user"
                    else {"workspace": self.entity.workspace}
                )
                name = {"user": "display_name", "unit": "title", "role": "name"}[
                    field["kind"]
                ]
                choices = model.objects.filter(**scope, **{f"{name}__icontains": text})
                key = Cast(F("id"), models.TextField())
            elif field["kind"] == "file":
                choices = FileAsset.objects.filter(
                    workspace=self.entity.workspace, attributes__name__icontains=text
                )
                key = Cast(F("id"), models.TextField())
            elif field["kind"] == "relation":
                try:
                    child = self.relation_query(code)
                    title = child.fields.get(child.entity.title_field)
                    if title and title["searchable"]:
                        target_alias = child.scalar(child.entity.title_field)
                        child.rows = child.rows.annotate(
                            _search_title=Cast(F(target_alias), models.TextField())
                        )
                        result |= Q(
                            Exists(child.rows.filter(_search_title__icontains=text))
                        )
                except PermissionDenied:
                    pass
            elif field["kind"] in {"boolean", "checkbox"} and text in {"بله", "خیر"}:
                result |= Q(**{alias: text == "بله"})
            if choices is not None:
                choices = choices.annotate(
                    _search_parent=ToJSON(OuterRef(alias))
                ).filter(JSONContains(F("_search_parent"), ToJSON(key)))
                result |= Q(Exists(choices))
        return result

    def system_filter(self, code):
        sources = {f["binding"].get("source"): key for key, f in self.fields.items()}
        if code == "mine":
            self.rows = self.rows.filter(created_by=self.user)
        elif code == "referred":
            if self.entity.adapter != "ticket":
                self.rows = self.rows.none()
            else:
                # Actual routing decisions and referral records, not merely current assignee.
                from plane.db.models import IssueActivity

                routed = TicketRoutingDecision.objects.filter(
                    assigned_user=self.user, issue__workspace=self.entity.workspace
                ).values("issue_id")
                referrals = IssueActivity.objects.filter(
                    workspace=self.entity.workspace,
                    field="assignees",
                    new_identifier=str(self.user.id),
                ).values("issue_id")
                self.rows = self.rows.filter(
                    Q(source_id__in=routed) | Q(source_id__in=referrals)
                )
        elif code == "unassigned":
            key = sources.get("assignee_ids") or sources.get("assignee_id")
            if key:
                predicate = self.predicate({"field": key, "op": "empty"})
                self.rows = self.rows.filter(predicate)
            else:
                self.rows = self.rows.none()
        elif code == "overdue":
            key = sources.get("target_date")
            if key:
                predicate = self.predicate(
                    {"field": key, "op": "lt", "value": {"dynamic": "today"}}
                )
                self.rows = self.rows.filter(predicate)
            else:
                self.rows = self.rows.none()
            completed = sources.get("completed_at")
            if completed:
                predicate = self.predicate({"field": completed, "op": "empty"})
                self.rows = self.rows.filter(predicate)
            if self.entity.adapter == "ticket":
                self.rows = self.rows.exclude(
                    source_id__in=Issue.objects.filter(
                        workspace=self.entity.workspace,
                        state__group__in=["completed", "cancelled"],
                    ).values("id")
                )
        else:
            raise ValidationError("نمای سیستمی معتبر نیست.")

    def ordered(self):
        ordering = []
        group = self.spec.get("group")
        if group:
            alias = self.scalar(group)
            direction = next(
                (
                    s["direction"]
                    for s in self.spec.get("sort", [])
                    if s["field"] == group
                ),
                "asc",
            )
            ordering.append(
                F(alias).desc(nulls_last=True)
                if direction == "desc"
                else F(alias).asc(nulls_last=True)
            )
        for sort in self.spec.get("sort", []):
            if sort["field"] == group:
                continue
            alias = self.scalar(sort["field"])
            ordering.append(
                F(alias).desc(nulls_last=True)
                if sort["direction"] == "desc"
                else F(alias).asc(nulls_last=True)
            )
        return self.rows.order_by(*(ordering or ["-created_at"]), "id")

    def projection(self):
        paths = {c["field"] for c in self.spec["columns"]}
        if self.entity.title_field in self.fields:
            paths.add(self.entity.title_field)
        self.group_alias = (
            self.scalar(self.spec["group"]) if self.spec.get("group") else None
        )
        if self.spec.get("group"):
            paths.add(self.spec["group"])
        for key in ("kanban_field", "calendar_field"):
            if self.spec.get("settings", {}).get(key):
                paths.add(self.spec["settings"][key])
        # Rules only evaluate visible dependencies; their values are not added to exported columns.
        self.rules, self.rule_aliases = [], []
        for rule in self.entity.view_settings.get("rules", []):
            deps = condition_fields(rule.get("when"))
            if all(self.path_allowed(path) for path in deps) and (
                rule.get("target") == "row" or self.path_allowed(rule.get("field"))
            ):
                alias = f"_rule{len(self.rules)}"
                predicate = self.predicate(rule["when"], visibility=True)
                self.rows = self.rows.annotate(
                    **{
                        alias: Case(
                            When(predicate, then=Value(True)),
                            default=Value(False),
                            output_field=models.BooleanField(),
                        )
                    }
                )
                self.rules.append({**rule, "match_alias": alias})
                self.rule_aliases.append(alias)
        return {path: self.display(path) for path in paths}

    def value_aliases(self, projection):
        return (
            set(projection.values())
            | set(self.rule_aliases)
            | set(self.scope_aliases)
            | ({self.group_alias} if self.group_alias else set())
        )

    def statistics(self):
        numeric = [
            c["field"]
            for c in self.spec["columns"]
            if self.describe(c["field"])["kind"] in NUMERIC
        ]
        aliases = {path: self.scalar(path) for path in numeric}
        measures = {}
        for i, (path, alias) in enumerate(aliases.items()):
            measures[f"s{i}"] = Sum(alias)
            measures[f"a{i}"] = Avg(alias)
        totals = self.rows.aggregate(**measures) if measures else {}
        summary = {
            path: {
                "sum": json_value(totals[f"s{i}"]),
                "avg": json_value(totals[f"a{i}"]),
            }
            for i, path in enumerate(aliases)
        }
        groups = []
        if self.spec.get("group"):
            alias = self.scalar(self.spec["group"])
            grouped = (
                self.rows.order_by()
                .values(alias)
                .annotate(count=Count("id"), **measures)
                .order_by(alias)
            )
            for row in grouped.iterator(chunk_size=1000):
                groups.append(
                    {
                        "value": json_value(row[alias]),
                        "key": group_key(row[alias]),
                        "count": row["count"],
                        "totals": {
                            path: {
                                "sum": json_value(row[f"s{i}"]),
                                "avg": json_value(row[f"a{i}"]),
                            }
                            for i, path in enumerate(aliases)
                        },
                    }
                )
        return summary, groups

    def payload(self, row, projection):
        values = {path: json_value(row[alias]) for path, alias in projection.items()}
        styles = {"row": {}, "cells": {}, "badges": {}}
        for rule in sorted(self.rules, key=lambda r: r.get("priority", 0)):
            if row[rule["match_alias"]]:
                target = rule.get("target", "row")
                dest = (
                    styles["row"]
                    if target == "row"
                    else styles["cells" if target == "cell" else "badges"].setdefault(
                        rule.get("field"), {}
                    )
                )
                dest.update(rule["style"])
        identifier = str(row["source_id"] or row["id"])
        actions = dict(self.grants)
        if not actions["edit"] and self.entity.adapter in {"task", "ticket"}:
            actions["status"] = actions["status"] and bool(row.get("_edit_assigned"))
            actions["assign"] = actions["assign"] and bool(
                row.get("_edit_assigned") or row.get("_edit_manager")
            )
        if self.entity.adapter == "leave":
            actions["edit"] = actions["edit"] and bool(row.get("_edit_leave"))
        editable = [
            code
            for code, field in self.fields.items()
            if not field["config"].get("readonly")
            and actions[field_edit_action(self.entity, field)]
        ]
        return {
            "id": identifier,
            "number": row["number"],
            "title": values.get(self.entity.title_field) or "رکورد",
            "values": values,
            "revision": row["revision"],
            "is_active": row["is_active"],
            "can_edit": bool(editable),
            "editable_fields": editable,
            "styles": styles,
            "group_key": group_key(row[self.group_alias]) if self.group_alias else None,
        }

    def execute(self, page=1, page_size=50):
        projection = self.projection()
        totals, groups = self.statistics()
        count = self.rows.count()
        ordered = self.ordered()
        rows = ordered.values(
            "id",
            "source_id",
            "number",
            "revision",
            "is_active",
            *self.value_aliases(projection),
        )[(page - 1) * page_size : page * page_size]
        result = [self.payload(row, projection) for row in rows]
        return {
            "results": result,
            "count": count,
            "page": page,
            "page_size": page_size,
            "totals": totals,
            "groups": groups,
            "warnings": self.warnings,
            "definition": self.spec,
            "schema_version": 1,
            "presentation": {
                "rules": [
                    {key: value for key, value in rule.items() if key != "match_alias"}
                    for rule in self.rules
                ]
            },
            "time_zone": str(self.time_zone),
        }
