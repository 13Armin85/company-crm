"""Ticket 6's new behavior, including API bypasses and concurrency."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.db import transaction
from rest_framework.test import APIClient

from plane.db.models import (
    EntityRecord,
    FieldDefinition,
    EntityType,
    EntityEvent,
    EntityNumberValue,
    EntityViewPreference,
    FormVersion,
    UserOrganizationRole,
    OrganizationRole,
)
from plane.tests.contract.app.test_entity_engine import (
    make_entity,
    create_record,
    endpoint,
    engine,
)
from plane.tests.contract.app.test_entity_views import spec, query
from plane.app.services.entity_uniqueness import canonical

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def post(engine, path, data, expected=201):
    workspace, _, client = engine
    response = client.post(endpoint(workspace, path), data, format="json")
    assert response.status_code == expected, response.data
    return response.data


def numbering(engine, entity, **changes):
    settings = {
        "field": "ticket_number",
        "title": "شماره تیکت",
        "prefix": "TT",
        "start": 1921,
        "padding": 0,
        **changes,
    }
    preview = post(
        engine,
        f"entities/{entity.code}/numbering-rules/",
        {**settings, "action": "preview"},
        200,
    )
    return post(
        engine,
        f"entities/{entity.code}/numbering-rules/",
        {**settings, "confirmation_token": preview["confirmation_token"]},
    )


def relation(engine, left, right, **changes):
    return post(
        engine,
        "relations/",
        {
            "left_entity": left.code,
            "right_entity": right.code,
            "left_title": "رکوردهای سمت اول",
            "right_title": "رکوردهای سمت دوم",
            "kind": "one_to_many",
            **changes,
        },
    )


@pytest.mark.parametrize(
    "a,b",
    [
        ("  AbC  ", "abc"),
        ("علي كاظمي", "علی کاظمی"),
        ("۱۲٣۴", "1234"),
        ("A   B", "a b"),
    ],
)
def test_uniqueness_normalizes_all_required_forms(engine, a, b):
    entity, _ = make_entity(
        engine, [{"code": "national_id", "title": "کد ملی", "kind": "short_text"}]
    )
    post(
        engine,
        "entities/sample/unique-rules/",
        {"title": "کد ملی", "fields": ["national_id"]},
    )
    first = create_record(engine, entity, {"title": "اول", "national_id": a})
    response = post(
        engine,
        "entities/sample/records/",
        {"values": {"title": "دوم", "national_id": b}},
        400,
    )
    assert response["duplicates"][0]["record_url"].endswith(first["id"])


def test_independent_and_composite_groups_and_empty_values(engine):
    entity, _ = make_entity(
        engine,
        [
            {"code": "customer_key", "title": "مشتری", "kind": "short_text"},
            {"code": "contract_key", "title": "قرارداد", "kind": "short_text"},
        ],
    )
    post(
        engine,
        "entities/sample/unique-rules/",
        {"fields": ["customer_key", "contract_key"]},
    )
    for customer, contract in [
        ("a", "1"),
        ("a", "2"),
        ("b", "1"),
        (None, "1"),
        (None, "1"),
    ]:
        create_record(
            engine,
            entity,
            {"title": "تست", "customer_key": customer, "contract_key": contract},
        )
    create_record(
        engine,
        entity,
        {"title": "تکراری", "customer_key": "a", "contract_key": "1"},
        400,
    )


def test_warn_allows_creation_and_inactive_match_is_labelled(engine):
    entity, _ = make_entity(engine)
    rule = post(
        engine, "entities/sample/unique-rules/", {"fields": ["title"], "mode": "warn"}
    )
    first = create_record(engine, entity, {"title": "تکرار"})
    EntityRecord.objects.filter(id=first["id"]).update(is_active=False)
    second = create_record(engine, entity, {"title": "تکرار"})
    assert second["warnings"][0]["inactive"]


def test_preexisting_duplicates_require_an_explicit_choice(engine):
    entity, _ = make_entity(engine)
    for _ in range(2):
        create_record(engine, entity, {"title": "تکراری"})
    response = post(engine, "entities/sample/unique-rules/", {"fields": ["title"]}, 409)
    assert response["duplicates"][0]["count"] == 2
    assert response["choices"] == ["resolve", "new_only"]
    post(
        engine,
        "entities/sample/unique-rules/",
        {"fields": ["title"], "existing_policy": "new_only"},
    )
    create_record(engine, entity, {"title": "تکراری"}, 400)


def test_numbering_sequence_padding_delete_and_prefix_changes(engine):
    workspace, actor, client = engine
    entity, _ = make_entity(engine)
    rule = numbering(engine, entity, padding=6)
    records = [create_record(engine, entity, {"title": str(i)}) for i in range(3)]
    assert [record["values"]["ticket_number"] for record in records] == [
        "TT001921",
        "TT001922",
        "TT001923",
    ]
    assert (
        client.delete(
            endpoint(workspace, f"entities/sample/records/{records[1]['id']}/")
        ).status_code
        == 204
    )
    response = client.patch(
        endpoint(workspace, f"entities/sample/numbering-rules/{rule['id']}/"),
        {"prefix": "SP"},
        format="json",
    )
    assert response.status_code == 200, response.data
    last = create_record(engine, entity, {"title": "چهارم"})
    assert last["values"]["ticket_number"] == "SP001924"
    original = client.get(
        endpoint(workspace, f"entities/sample/records/{records[0]['id']}/")
    )
    assert original.data["values"]["ticket_number"] == "TT001921"
    response = client.patch(
        endpoint(workspace, f"entities/sample/numbering-rules/{rule['id']}/"),
        {"start": 1900},
        format="json",
    )
    assert response.status_code == 400
    response = client.patch(
        endpoint(workspace, f"entities/sample/records/{last['id']}/"),
        {"revision": last["revision"], "values": {"ticket_number": "X"}},
        format="json",
    )
    assert response.status_code == 403


def test_multiple_numbered_columns_and_confirmed_backfill(engine):
    entity, _ = make_entity(engine)
    old = [create_record(engine, entity, {"title": str(i)}) for i in range(2)]
    settings = {"field": "serial", "title": "شماره", "prefix": "TT", "start": 1921}
    post(engine, "entities/sample/numbering-rules/", settings, 400)
    numbering(engine, entity, field="serial")
    numbering(engine, entity, field="reference", prefix="REF", start=10)
    rows = list(EntityRecord.objects.filter(entity=entity).order_by("created_at"))
    assert [row.data["serial"] for row in rows] == ["TT1921", "TT1922"]
    assert [row.data["reference"] for row in rows] == ["REF10", "REF11"]
    result = query(
        engine,
        entity,
        spec(
            "title", "serial", filter={"field": "serial", "op": "eq", "value": "TT1922"}
        ),
    )
    assert result.status_code == 200, result.data
    assert result.data["count"] == 1


def test_backfill_token_cannot_be_reused_after_data_or_settings_change(engine):
    entity, _ = make_entity(engine)
    create_record(engine, entity, {"title": "قبل"})
    settings = {"field": "serial", "title": "شماره", "prefix": "TT", "start": 1921}
    preview = post(
        engine,
        "entities/sample/numbering-rules/",
        {**settings, "action": "preview"},
        200,
    )
    create_record(engine, entity, {"title": "بعد"})
    post(
        engine,
        "entities/sample/numbering-rules/",
        {**settings, "confirmation_token": preview["confirmation_token"]},
        400,
    )
    assert not FieldDefinition.objects.filter(
        workspace=engine[0], code="serial"
    ).exists()


def test_hidden_from_form_preserves_query_export_and_summary_but_blocks_writes(engine):
    workspace, _, client = engine
    entity, _ = make_entity(
        engine,
        [
            {
                "code": "amount",
                "title": "مبلغ",
                "kind": "money",
                "config": {"required": True},
            }
        ],
    )
    old = create_record(engine, entity, {"title": "قدیمی", "amount": "120"})
    field = FieldDefinition.objects.get(workspace=workspace, code="amount")
    response = client.patch(
        endpoint(workspace, f"definitions/fields/{field.id}/"),
        {"hidden_from_form": True},
        format="json",
    )
    assert response.status_code == 200, response.data
    schema = client.get(endpoint(workspace, "entities/sample/schema/"))
    assert "amount" not in {field["code"] for field in schema.data["fields"]}
    create_record(engine, entity, {"title": "جدید"})
    create_record(engine, entity, {"title": "API", "amount": "10"}, 403)
    result = query(engine, entity, spec("title", "amount"))
    assert result.status_code == 200, result.data
    assert (
        next(row for row in result.data["results"] if row["id"] == old["id"])["values"][
            "amount"
        ]
        == "120"
    )
    entity.view_settings = {"summary": [{"field": "amount"}]}
    entity.save()
    summary = client.get(
        endpoint(workspace, f"entities/sample/records/{old['id']}/summary/")
    )
    assert summary.status_code == 200, summary.data
    assert summary.data["fields"][0]["config"]["readonly"]
    response = client.delete(endpoint(workspace, f"definitions/fields/{field.id}/"))
    assert response.status_code == 400
    assert "1" in str(response.data)


def test_personal_default_is_server_owned_and_official_stays_independent(engine):
    workspace, actor, client = engine
    entity, _ = make_entity(engine)
    official = post(
        engine,
        "entities/sample/views/",
        {"name": "رسمی", "visibility": "official", "definition": spec("title")},
    )
    personal = post(
        engine,
        "entities/sample/views/",
        {"name": "من", "definition": spec("title"), "visibility": "personal"},
    )
    response = client.patch(
        endpoint(workspace, f"entities/sample/views/{personal['id']}/"),
        {"is_default": True},
        format="json",
    )
    assert response.status_code == 200, response.data
    other_browser = APIClient()
    other_browser.force_authenticate(user=actor)
    listing = other_browser.get(endpoint(workspace, "entities/sample/views/"))
    assert listing.data["default_id"] == personal["id"]
    assert EntityViewPreference.objects.get(entity=entity, user=actor).default_view_id
    client.delete(endpoint(workspace, f"entities/sample/views/{personal['id']}/"))
    listing = other_browser.get(endpoint(workspace, "entities/sample/views/"))
    assert listing.status_code == 200


def test_personal_view_limit_enforced_by_api(engine):
    workspace, _, client = engine
    entity, _ = make_entity(engine)
    response = client.put(
        endpoint(workspace, "settings/"), {"personal_view_limit": 1}, format="json"
    )
    assert response.status_code == 200, response.data
    post(engine, "entities/sample/views/", {"name": "من", "definition": spec("title")})
    post(
        engine,
        "entities/sample/views/",
        {"name": "دوم", "definition": spec("title")},
        400,
    )


@pytest.mark.parametrize(
    "kind", ["one_to_one", "one_to_many", "many_to_one", "many_to_many"]
)
def test_relation_is_bidirectional_and_backend_enforces_cardinality(engine, kind):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(engine, left, right, kind=kind)
    target = create_record(engine, right, {"title": "مقصد"})
    value = [target["id"]] if kind in {"one_to_many", "many_to_many"} else target["id"]
    first = create_record(engine, left, {"title": "اول", rule["left_field"]: value})
    reverse = client.get(endpoint(workspace, f"entities/right/records/{target['id']}/"))
    assert first["id"] in str(reverse.data["values"][rule["right_field"]])
    if kind in {"one_to_one", "one_to_many"}:
        create_record(engine, left, {"title": "دوم", rule["left_field"]: value}, 400)
    else:
        create_record(engine, left, {"title": "دوم", rule["left_field"]: value})


def test_saved_view_losing_filtered_field_fails_closed_without_breaking_the_table(
    engine,
):
    workspace, actor, client = engine
    role = OrganizationRole.objects.create(workspace=workspace, name="دسترسی موقت مبلغ")
    grant = UserOrganizationRole.objects.create(
        workspace=workspace, user=actor, role=role
    )
    entity, _ = make_entity(
        engine,
        [
            {
                "code": "amount",
                "title": "مبلغ",
                "kind": "money",
                "binding": {"view_roles": [str(role.id)]},
            }
        ],
    )
    create_record(engine, entity, {"title": "محرمانه", "amount": "100"})
    view = post(
        engine,
        "entities/sample/views/",
        {
            "name": "جدول مبلغ",
            "definition": spec(
                "title",
                "amount",
                filter={"field": "amount", "op": "gt", "value": "10"},
                sort=[{"field": "amount", "direction": "asc"}],
            ),
        },
    )
    grant.delete()
    saved = client.get(endpoint(workspace, "entities/sample/views/"))
    visible = next(item for item in saved.data["results"] if item["id"] == view["id"])
    result = client.post(
        endpoint(workspace, "entities/sample/query/"),
        {"view_id": view["id"], "definition": visible["definition"]},
        format="json",
    )
    assert result.status_code == 200, result.data
    assert result.data["count"] == 0 and result.data["warnings"]
    assert [column["field"] for column in result.data["definition"]["columns"]] == ["title"]
    assert query(engine, entity, spec("title", sort=[{"field": "amount", "direction": "asc"}])).status_code == 400


def test_related_selector_attaches_multiple_targets_atomically(engine):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(engine, left, right, kind="many_to_many")
    source = create_record(engine, left, {"title": "مبدأ"})
    targets = [
        create_record(engine, right, {"title": title}) for title in ["اول", "دوم"]
    ]
    path = endpoint(
        workspace, f"entities/left/records/{source['id']}/related/{rule['left_field']}/"
    )
    invalid = client.post(
        path,
        {
            "revision": source["revision"],
            "action": "attach",
            "targets": [targets[0]["id"], str(uuid4())],
        },
        format="json",
    )
    assert invalid.status_code == 400, invalid.data
    assert not left.outgoing_relations.get(id=rule["id"]).links.exists()
    attached = client.post(
        path,
        {
            "revision": source["revision"],
            "action": "attach",
            "targets": [target["id"] for target in targets],
        },
        format="json",
    )
    assert attached.status_code == 200, attached.data
    assert set(attached.data["values"][rule["left_field"]]) == {
        target["id"] for target in targets
    }
    assert client.get(path).data["count"] == 2


def test_relation_delete_block_cannot_be_bypassed_with_confirm(engine):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(engine, left, right)
    target = create_record(engine, right, {"title": "مقصد"})
    first = create_record(
        engine, left, {"title": "اول", rule["left_field"]: [target["id"]]}
    )
    response = client.delete(
        endpoint(
            workspace, f"entities/right/records/{target['id']}/?confirm_relations=true"
        )
    )
    assert response.status_code == 400, response.data
    response = client.patch(
        endpoint(workspace, f"relations/{rule['id']}/"),
        {"on_delete": "detach"},
        format="json",
    )
    assert response.status_code == 200, response.data
    response = client.delete(
        endpoint(
            workspace, f"entities/right/records/{target['id']}/?confirm_relations=true"
        )
    )
    assert response.status_code == 204, response.data
    left_record = client.get(
        endpoint(workspace, f"entities/left/records/{first['id']}/")
    )
    assert left_record.data["values"][rule["left_field"]] == []


def test_lookup_uses_live_related_values_and_aggregations(engine):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(
        engine, [{"code": "amount", "title": "مبلغ", "kind": "money"}], code="right"
    )
    rule = relation(engine, left, right, kind="many_to_many")
    targets = [
        create_record(engine, right, {"title": str(i), "amount": str(i)})
        for i in [10, 20]
    ]
    first = create_record(
        engine,
        left,
        {"title": "اول", rule["left_field"]: [record["id"] for record in targets]},
    )
    count = post(
        engine,
        "entities/left/lookup-columns/",
        {
            "title": "تعداد",
            "path": rule["left_field"] + ".amount",
            "aggregation": "count",
        },
    )
    total = post(
        engine,
        "entities/left/lookup-columns/",
        {"title": "جمع", "path": rule["left_field"] + ".amount", "aggregation": "sum"},
    )
    result = query(engine, left, spec("title", count["field"], total["field"]))
    assert result.status_code == 200, result.data
    assert float(result.data["results"][0]["values"][total["field"]]) == 30
    assert result.data["results"][0]["values"][count["field"]] == 2
    response = client.patch(
        endpoint(workspace, f"entities/right/records/{targets[0]['id']}/"),
        {
            "revision": EntityRecord.objects.get(id=targets[0]["id"]).revision,
            "values": {"amount": "30"},
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    result = query(engine, left, spec("title", total["field"]))
    assert float(result.data["results"][0]["values"][total["field"]]) == 50


def test_form_designer_excludes_fixed_pages_and_core_field_is_locked(engine):
    workspace, _, client = engine
    result = client.get(endpoint(workspace, "surfaces/"))
    assert result.status_code == 200, result.data
    assert not {
        "profile",
        "security",
        "notifications",
        "workspace",
        "password",
        "appearance",
    }.intersection(row["code"] for row in result.data["results"])
    response = client.put(
        endpoint(workspace, "surfaces/profile/"),
        {"revision": 0, "definition": {}},
        format="json",
    )
    assert response.status_code == 400, response.data
    users = client.get(endpoint(workspace, "surfaces/users/"))
    for code in ["username", "password", "email", "role_ids"]:
        assert next(
            field for field in users.data["native_fields"] if field["code"] == code
        )["locked"]


def test_user_and_unit_are_real_native_entities_and_never_return_passwords(engine):
    workspace, actor, client = engine
    role = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    user_entity = EntityType.objects.get(workspace=workspace, code="user")
    numbering(engine, user_entity, field="employee_number", prefix="EM", start=50)
    created = create_record(
        engine,
        user_entity,
        {
            "user_name": "همکار",
            "user_username": "ticket6.user",
            "user_email": "ticket6@example.test",
            "user_password": "Complex!T6newPass2026",
            "user_roles": [str(role.id)],
        },
    )
    assert "user_password" not in created["values"]
    assert (
        EntityRecord.objects.get(entity=user_entity, source_id=actor.id).data[
            "employee_number"
        ]
        == "EM50"
    )
    assert created["values"]["employee_number"] == "EM51"
    from plane.db.models import User

    user = User.objects.get(id=created["id"])
    assert user.check_password("Complex!T6newPass2026")
    result = query(engine, user_entity, spec("user_name", "user_email", "user_roles"))
    assert result.status_code == 200, result.data
    assert created["id"] in [row["id"] for row in result.data["results"]]
    assert not EntityEvent.objects.filter(
        workspace=workspace, after__icontains="Complex!T6newPass2026"
    ).exists()
    unit_entity = EntityType.objects.get(workspace=workspace, code="unit")
    unit = create_record(engine, unit_entity, {"unit_title": "واحد تست"})
    rule = relation(engine, user_entity, unit_entity, kind="many_to_one")
    current = client.get(
        endpoint(workspace, f"entities/user/records/{created['id']}/")
    ).data
    response = client.patch(
        endpoint(workspace, f"entities/user/records/{created['id']}/"),
        {"revision": current["revision"], "values": {rule["left_field"]: unit["id"]}},
        format="json",
    )
    assert response.status_code == 200, response.data


def test_deleting_empty_bound_field_detaches_without_changing_old_versions(engine):
    workspace, _, client = engine
    entity, form = make_entity(
        engine, [{"code": "unused", "title": "خالی", "kind": "short_text"}]
    )
    first_version = form.published_id
    create_record(engine, entity, {"title": "بدون مقدار"})
    field = FieldDefinition.objects.get(workspace=workspace, code="unused")
    usage = client.get(endpoint(workspace, f"definitions/fields/{field.id}/usage/"))
    assert usage.status_code == 200, usage.data
    assert usage.data["can_delete"]
    response = client.delete(endpoint(workspace, f"definitions/fields/{field.id}/"))
    assert response.status_code == 204, response.data
    form.refresh_from_db()
    assert form.published_id != first_version
    assert "unused" in str(FormVersion.objects.get(id=first_version).schema)
    assert "unused" not in str(form.published.schema)


def test_original_members_api_uses_uniqueness_hidden_fields_and_numbering(engine):
    from plane.db.models import User

    workspace, actor, client = engine
    entity = EntityType.objects.get(workspace=workspace, code="user")
    numbering(engine, entity, field="employee_number", prefix="EM", start=101)
    post(engine, "entities/user/unique-rules/", {"fields": ["user_name"]})
    path = f"/api/workspaces/{workspace.slug}/members/"
    first = client.post(
        path,
        {
            "email": "native-first@example.test",
            "username": "native.first",
            "display_name": "Example Person",
            "password": "Strong!T6members2026",
            "role": 15,
        },
        format="json",
    )
    assert first.status_code == 201, first.data
    user_id = first.data["member"]["id"]
    assert (
        EntityRecord.objects.get(entity=entity, source_id=user_id).data[
            "employee_number"
        ]
        == "EM102"
    )
    duplicate = client.post(
        path,
        {
            "email": "native-second@example.test",
            "username": "native.second",
            "display_name": " example   person ",
            "password": "Strong!T6members2026",
            "role": 15,
        },
        format="json",
    )
    assert duplicate.status_code == 400, duplicate.data
    assert duplicate.data["duplicates"][0]["record_url"].endswith(str(user_id))
    assert not User.objects.filter(email="native-second@example.test").exists()
    existing = User.objects.create_user(
        email="native-existing@example.test",
        username="native.existing",
        password="Strong!Existing2026",
        display_name="Existing Person",
    )
    invited = client.post(path, {"email": existing.email, "role": 15}, format="json")
    assert invited.status_code == 201, invited.data
    assert existing.check_password("Strong!Existing2026")
    field = FieldDefinition.objects.create(
        workspace=workspace,
        code="legacy_user",
        title="قدیمی",
        kind="short_text",
        hidden_from_form=True,
    )
    from plane.app.services.entity_relations import attach_field

    attach_field(entity, field, actor)
    hidden = client.post(
        path,
        {
            "email": "native-hidden@example.test",
            "username": "native.hidden",
            "display_name": "Hidden Person",
            "password": "Strong!T6members2026",
            "role": 15,
            "custom_fields": {"legacy_user": "forbidden"},
        },
        format="json",
    )
    assert hidden.status_code == 403, hidden.data
    assert not User.objects.filter(email="native-hidden@example.test").exists()


def test_excel_import_reports_duplicates_ignores_hidden_and_assigns_numbers(engine):
    from io import BytesIO
    from openpyxl import Workbook
    from django.core.files.uploadedfile import SimpleUploadedFile

    workspace, _, client = engine
    entity, _ = make_entity(
        engine,
        [
            {
                "code": "legacy",
                "title": "قدیمی",
                "kind": "short_text",
                "hidden_from_form": True,
            }
        ],
    )
    post(engine, "entities/sample/unique-rules/", {"fields": ["title"]})
    numbering(engine, entity)
    book = Workbook()
    book.active.append(["title", "legacy"])
    book.active.append(["اول", "نادیده"])
    book.active.append(["اول", "نادیده"])
    book.active.append(["دوم", "نادیده"])
    output = BytesIO()
    book.save(output)
    response = client.post(
        endpoint(workspace, "entities/sample/import/"),
        {
            "file": SimpleUploadedFile(
                "data.xlsx",
                output.getvalue(),
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        format="multipart",
    )
    assert response.status_code == 200, response.data
    assert response.data["success_count"] == 2 and response.data["rejected_count"] == 1
    assert response.data["results"][1]["error"]["duplicates"][0]["record_url"]
    assert all(row["warnings"] for row in response.data["results"])
    records = list(EntityRecord.objects.filter(entity=entity).order_by("created_at"))
    assert [row.data["ticket_number"] for row in records] == ["TT1921", "TT1922"]
    assert all(not row.data.get("legacy") for row in records)


@pytest.mark.django_db(transaction=True)
def test_numbered_column_is_unique_across_ten_concurrent_requests(engine):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import connections
    from plane.db.models import User

    workspace, actor, _ = engine
    entity, _ = make_entity(engine)
    numbering(engine, entity)
    start = Barrier(2)

    def create_batch(batch):
        try:
            client = APIClient()
            client.force_authenticate(user=User.objects.get(id=actor.id))
            start.wait(timeout=30)
            numbers = []
            for index in range(5):
                response = client.post(
                    endpoint(workspace, "entities/sample/records/"),
                    {"values": {"title": f"{batch}-{index}"}},
                    format="json",
                )
                assert response.status_code == 201, response.data
                numbers.append(response.data["values"]["ticket_number"])
            return numbers
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_batch, [0, 1]))
    numbers = [number for batch in results for number in batch]
    assert len(numbers) == len(set(numbers)) == 10
    assert set(numbers) == {f"TT{number}" for number in range(1921, 1931)}
