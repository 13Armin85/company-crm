"""Disabling a unit disables its subtree; unused field codes can be renamed safely."""

import pytest

from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import EntityType, FieldDefinition, FormLayout, FormVersion, OrganizationUnit, SurfaceConfiguration
from plane.app.services.entity_numbering import add_number_to_surface_tables
from plane.app.services.surface_config import configuration

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def unit_url(workspace, unit):
    return f"/api/workspaces/{workspace.slug}/organization/units/{unit.id}/"


def test_disabling_a_unit_disables_all_descendants(session_client, workspace):
    root = OrganizationUnit.objects.create(workspace=workspace, title="مدیریت")
    child = OrganizationUnit.objects.create(workspace=workspace, title="فروش", parent=root)
    grandchild = OrganizationUnit.objects.create(workspace=workspace, title="فروش شمال", parent=child)
    sibling = OrganizationUnit.objects.create(workspace=workspace, title="مالی")

    response = session_client.patch(unit_url(workspace, root), {"is_active": False}, format="json")
    assert response.status_code == 200, response.data

    for unit in (root, child, grandchild):
        unit.refresh_from_db()
        assert unit.is_active is False
    sibling.refresh_from_db()
    assert sibling.is_active is True


def test_child_cannot_be_enabled_under_a_disabled_parent(session_client, workspace):
    root = OrganizationUnit.objects.create(workspace=workspace, title="مدیریت", is_active=False)
    child = OrganizationUnit.objects.create(workspace=workspace, title="فروش", parent=root, is_active=False)

    response = session_client.patch(unit_url(workspace, child), {"is_active": True}, format="json")
    assert response.status_code == 400
    child.refresh_from_db()
    assert child.is_active is False

    assert session_client.patch(unit_url(workspace, root), {"is_active": True}, format="json").status_code == 200
    assert session_client.patch(unit_url(workspace, child), {"is_active": True}, format="json").status_code == 200


@pytest.fixture
def engine(workspace):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    return workspace


def field_url(workspace, field):
    return f"/api/workspaces/{workspace.slug}/engine/definitions/fields/{field.id}/"


def test_unused_field_code_rename_updates_layouts(session_client, engine):
    workspace = engine
    entity = EntityType.objects.create(workspace=workspace, code="sample", title="نمونه")
    field = FieldDefinition.objects.create(workspace=workspace, code="old_phone", title="تلفن", kind="short_text")
    layout = {
        "tabs": [],
        "sections": [{"id": "main", "columns": 2, "bindings": [{"field": "title"}, {"field": "old_phone"}]}],
    }
    form = FormLayout.objects.create(entity=entity, draft=layout)
    form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
    form.save()

    response = session_client.patch(field_url(workspace, field), {"code": "customer_phone"}, format="json")
    assert response.status_code == 200, response.data

    field.refresh_from_db()
    form.refresh_from_db()
    assert field.code == "customer_phone"
    assert [b["field"] for b in form.draft["sections"][0]["bindings"]] == ["title", "customer_phone"]
    assert [b["field"] for b in form.published.schema["sections"][0]["bindings"]] == ["title", "customer_phone"]


def test_field_code_rename_rejects_duplicates_and_used_fields(session_client, engine):
    workspace = engine
    field = FieldDefinition.objects.create(workspace=workspace, code="first_code", title="اول", kind="short_text")
    FieldDefinition.objects.create(workspace=workspace, code="taken_code", title="دوم", kind="short_text")

    assert session_client.patch(field_url(workspace, field), {"code": "taken_code"}, format="json").status_code == 400

    field.used_at = field.created_at
    field.save(update_fields=["used_at"])
    assert session_client.patch(field_url(workspace, field), {"code": "fresh_code"}, format="json").status_code == 400
    field.refresh_from_db()
    assert field.code == "first_code"


def numbering_url(workspace, code):
    return f"/api/workspaces/{workspace.slug}/engine/entities/{code}/numbering-rules/"


def test_numbering_can_use_an_existing_empty_text_column(session_client, engine):
    workspace = engine
    entity = EntityType.objects.create(workspace=workspace, code="contract", title="قرارداد")
    FieldDefinition.objects.create(workspace=workspace, code="contract_no", title="شماره قرارداد", kind="short_text")
    FieldDefinition.objects.create(workspace=workspace, code="amount_due", title="مبلغ", kind="integer")
    layout = {
        "tabs": [],
        "sections": [{"id": "main", "columns": 1, "bindings": [{"field": "contract_no"}, {"field": "amount_due"}]}],
    }
    form = FormLayout.objects.create(entity=entity, draft=layout)
    form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
    form.save()
    settings = {"prefix": "C-", "start": 1, "padding": 3, "shared_sequence": True, "subtype_prefixes": {}}

    candidates = session_client.get(numbering_url(workspace, "contract"))
    assert candidates.status_code == 200, candidates.data
    assert candidates.data["candidates"] == [{"code": "contract_no", "title": "شماره قرارداد"}]

    rejected = session_client.post(
        numbering_url(workspace, "contract"), {"field": "amount_due", "title": "مبلغ", **settings}, format="json"
    )
    assert rejected.status_code == 400

    response = session_client.post(
        numbering_url(workspace, "contract"),
        {"field": "contract_no", "title": "شماره قرارداد", **settings},
        format="json",
    )
    assert response.status_code == 201, response.data
    form.refresh_from_db()
    codes = [b["field"] for s in form.published.schema["sections"] for b in s["bindings"]]
    assert codes.count("contract_no") == 1
    assert FieldDefinition.objects.get(workspace=workspace, code="contract_no").config["auto_number"] is True
    assert session_client.get(numbering_url(workspace, "contract")).data["candidates"] == []


def test_numbering_column_appears_in_native_table_tabs(engine):
    workspace = engine
    entity = EntityType.objects.get(workspace=workspace, code="ticket")
    _, definition = configuration(workspace, "ticket")
    definition["table_tabs"] = [
        {"id": "active", "title": "فعال", "columns": ["native:عنوان کار"]},
        {"id": "closed", "title": "بسته", "columns": ["native:عنوان کار"]},
    ]
    SurfaceConfiguration.objects.update_or_create(
        workspace=workspace, code="ticket", defaults={"definition": definition}
    )

    add_number_to_surface_tables(entity, "contract_no")

    row = SurfaceConfiguration.objects.get(workspace=workspace, code="ticket")
    assert row.definition["columns"].count("engine:contract_no") == 1
    assert all(tab["columns"].count("engine:contract_no") == 1 for tab in row.definition["table_tabs"])
    add_number_to_surface_tables(entity, "contract_no")
    row.refresh_from_db()
    assert row.definition["columns"].count("engine:contract_no") == 1
