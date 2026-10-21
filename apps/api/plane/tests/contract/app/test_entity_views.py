"""Ticket 5B behavioral/security contracts against PostgreSQL, never client arrays."""

from io import BytesIO
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.core.files.storage import FileSystemStorage
from openpyxl import load_workbook

from plane.db.models import (
    EntityRecord,
    EntityViewExport,
    FileAsset,
    FieldDefinition,
    UserOrganizationRole,
    OrganizationRole,
    User,
    WorkspaceMember,
    OrganizationUnit,
    OrganizationUnitMember,
    UserPermissionException,
    OrganizationPermission,
    LookupCategory,
    LookupValue,
    EntityType,
    FormLayout,
    FormVersion,
    IssueView,
    UserFavorite,
)
from plane.app.services.entity_view_export import (
    build_entity_export,
    verify_export_access,
    jalali,
    export_cell,
    update_fingerprint,
)
from plane.tests.contract.app.test_entity_engine import make_entity, create_record, endpoint
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import sync_permission_catalog

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


@pytest.fixture(name="engine")
def engine_fixture(workspace, create_user, session_client):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    return workspace, create_user, session_client


def spec(*columns, **settings):
    return {
        "version": 1,
        "type": "table",
        "columns": [{"field": c, "width": 180} for c in columns],
        "sort": [],
        **settings,
    }


def query(engine, entity, definition, **data):
    workspace, _, client = engine
    return client.post(
        endpoint(workspace, f"entities/{entity.code}/query/"), {"definition": definition, **data}, format="json"
    )


def test_server_nested_filter_sort_pagination_and_global_aggregates(engine):
    entity, _ = make_entity(
        engine,
        [{"code": "amount", "kind": "money", "title": "مبلغ"}, {"code": "flag", "kind": "boolean", "title": "پرچم"}],
    )
    for i in range(6):
        create_record(engine, entity, {"title": f"record {i}", "amount": str(i * 10), "flag": i % 2 == 0})
    definition = spec(
        "title",
        "amount",
        "flag",
        filter={
            "op": "and",
            "rules": [
                {"field": "amount", "op": "gte", "value": "10"},
                {
                    "op": "or",
                    "rules": [
                        {"field": "flag", "op": "eq", "value": False},
                        {"field": "amount", "op": "eq", "value": "20"},
                    ],
                },
            ],
        },
        sort=[{"field": "amount", "direction": "desc"}, {"field": "title", "direction": "asc"}],
        group="flag",
    )
    response = query(engine, entity, definition, page_size=2)
    assert response.status_code == 200, response.data
    assert response.data["count"] == 4
    assert [float(r["values"]["amount"]) for r in response.data["results"]] == [50, 30]
    assert float(response.data["totals"]["amount"]["sum"]) == 110
    assert sorted(g["count"] for g in response.data["groups"]) == [1, 3]
    second = query(engine, entity, definition, page=2, page_size=2)
    assert not {r["id"] for r in response.data["results"]}.intersection(r["id"] for r in second.data["results"])


def test_multi_stage_relations_do_not_duplicate_totals(engine):
    company, _ = make_entity(engine, [{"code": "score", "kind": "integer", "title": "امتیاز"}], code="company_test")
    a = create_record(engine, company, {"title": "الف", "score": 5})
    b = create_record(engine, company, {"title": "ب", "score": 10})
    customer, _ = make_entity(
        engine,
        [
            {
                "code": "companies",
                "kind": "relation",
                "title": "شرکت",
                "relation_entity": company,
                "config": {"multiple": True},
            }
        ],
        code="customer_test",
    )
    c = create_record(engine, customer, {"title": "مشتری", "companies": [a["id"], b["id"]]})
    ticket, _ = make_entity(
        engine,
        [
            {"code": "customer", "kind": "relation", "title": "مشتری", "relation_entity": customer},
            {"code": "cost", "kind": "integer", "title": "هزینه"},
        ],
        code="case_test",
    )
    create_record(engine, ticket, {"title": "case", "customer": c["id"], "cost": 100})
    ticket.view_settings = {
        "rules": [
            {
                "when": {"field": "customer.companies.score", "op": "gt", "value": 7},
                "target": "row",
                "priority": 1,
                "style": {"background": "#ffeedd"},
            }
        ]
    }
    ticket.save()
    response = query(
        engine,
        ticket,
        spec(
            "title",
            "cost",
            "customer.companies.score",
            filter={"field": "customer.companies.score", "op": "gt", "value": 7},
        ),
    )
    assert response.status_code == 200, response.data
    assert response.data["count"] == 1
    assert float(response.data["totals"]["cost"]["sum"]) == 100
    assert float(response.data["totals"]["customer.companies.score"]["sum"]) == 5
    assert response.data["results"][0]["styles"]["row"]["background"] == "#ffeedd"


@pytest.mark.parametrize("operator,value", [("gt", "a"), ("arbitrary_sql", "x")])
def test_invalid_operators_and_types_rejected(engine, operator, value):
    entity, _ = make_entity(engine)
    response = query(engine, entity, spec("title", filter={"field": "title", "op": operator, "value": value}))
    assert response.status_code == 400


def test_saved_views_revisions_and_official_presentation(engine):
    workspace, user, client = engine
    entity, _ = make_entity(engine, [{"code": "cost", "kind": "integer", "title": "هزینه"}])
    create_record(engine, entity, {"title": "case", "cost": 100})
    base = endpoint(workspace, f"entities/{entity.code}/")
    response = client.post(
        base + "views/", {"name": "شخصی", "visibility": "personal", "definition": spec("title", "cost")}, format="json"
    )
    assert response.status_code == 201, response.data
    view = response.data
    assert (
        client.patch(base + f"views/{view['id']}/", {"name": "قدیمی", "revision": 0}, format="json").status_code == 409
    )
    assert (
        client.patch(
            base + f"views/{view['id']}/", {"name": "تازه", "revision": view["revision"]}, format="json"
        ).status_code
        == 200
    )
    response = client.put(
        base + "presentation/",
        {
            "rules": [
                {
                    "when": {"field": "cost", "op": "gt", "value": 50},
                    "priority": 1,
                    "target": "row",
                    "style": {"background": "#ffeedd", "icon": "warning"},
                }
            ]
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    for kind in ["table", "kanban", "list", "calendar", "cards"]:
        result = query(engine, entity, spec("title", "cost", type=kind))
        assert result.status_code == 200, result.data
        assert result.data["results"][0]["styles"]["row"]["background"] == "#ffeedd"


def test_bulk_preserves_validation_and_reports_each_record(engine):
    workspace, _, client = engine
    entity, _ = make_entity(engine, [{"code": "cost", "kind": "integer", "title": "هزینه", "config": {"min": 0}}])
    first = create_record(engine, entity, {"title": "a", "cost": 1})
    response = client.post(
        endpoint(workspace, f"entities/{entity.code}/bulk/"),
        {"ids": [first["id"], "00000000-0000-0000-0000-000000000001"], "operation": "update", "values": {"cost": -1}},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["success_count"] == 0
    assert EntityRecord.objects.get(id=first["id"]).data["cost"] == 1


@pytest.mark.parametrize("format", ["xlsx", "csv"])
def test_real_export_all_filtered_rows_and_download_access(engine, monkeypatch, tmp_path, format):
    workspace, user, client = engine
    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))
    entity, _ = make_entity(engine, [{"code": "due", "kind": "date", "title": "تاریخ"}])
    record = create_record(engine, entity, {"title": "=1+1", "due": "2026-10-19"})
    monkeypatch.setattr(build_entity_export, "delay", lambda identifier: None)
    response = client.post(
        endpoint(workspace, f"entities/{entity.code}/exports/"),
        {"format": format, "definition": spec("title", "due")},
        format="json",
    )
    assert response.status_code == 202, response.data
    build_entity_export.run(response.data["id"])
    job = EntityViewExport.objects.select_related("user", "workspace", "entity__workspace", "asset").get(
        id=response.data["id"]
    )
    assert job.status == "ready", job.error
    verify_export_access(job)
    denial = UserPermissionException.objects.create(
        workspace=workspace,
        user=user,
        permission=OrganizationPermission.objects.get(workspace=workspace, code="Export.Data"),
        effect="DENY",
    )
    # The existing access policy intentionally gives built-in admins full access.
    # Exercise revocation after that role is removed, as for a normal export owner.
    admin_roles = UserOrganizationRole.objects.filter(workspace=workspace, user=user, role__system_key="admin")
    admin_roles.update(is_active=False)
    with pytest.raises(Exception, match="مجوز"):
        verify_export_access(job)
    admin_roles.update(is_active=True)
    denial.delete()
    content = job.asset.asset.read()
    if format == "xlsx":
        rows = list(load_workbook(BytesIO(content)).active.values)
        assert rows[1] == ("'=1+1", "1405/07/27")
    else:
        assert "1405/07/27" in content.decode("utf-8-sig")
        assert "'=1+1" in content.decode("utf-8-sig")
    EntityRecord.objects.filter(id=record["id"]).update(data={"title": "changed", "due": "2026-10-19"})
    with pytest.raises(Exception, match="داده یا دسترسی"):
        verify_export_access(job)


def test_jalali_calendar_boundaries():
    assert jalali("2026-10-19") == "1405/07/27"
    assert jalali("2024-03-20") == "1403/01/01"


def test_export_money_preserves_decimal_precision_before_spreadsheet_encoding():
    import csv
    import hashlib
    from io import StringIO

    query = SimpleNamespace(describe=lambda path: {"kind": "money"})
    raw = "123456789012345678901234567890.25"
    value = export_cell(query, "amount", raw, {})
    assert value == Decimal(raw)
    output = StringIO()
    csv.writer(output).writerow([value])
    assert output.getvalue().strip() == raw
    digest = hashlib.sha256()
    update_fingerprint(digest, {"id": "row", "values": {"amount": raw}}, [value])
    assert digest.hexdigest()


def test_private_views_are_private_even_from_another_admin_and_sharing_does_not_grant_data(engine):
    workspace, owner, client = engine
    entity, _ = make_entity(engine)
    create_record(engine, entity, {"title": "owner only"})
    base = endpoint(workspace, f"entities/{entity.code}/")
    private = client.post(base + "views/", {"name": "private", "definition": spec("title")}, format="json").data
    other = User.objects.create_user(
        email="view-other@example.com", username="view-other", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=20)
    client.force_authenticate(user=other)
    views = client.get(base + "views/")
    assert private["id"] not in [v["id"] for v in views.data["results"]]
    audit = client.get(endpoint(workspace, "events/"))
    assert all(event["metadata"].get("definition_id") != private["id"] for event in audit.data["results"])
    assert client.post(base + "query/", {"view_id": private["id"]}, format="json").status_code == 403
    assert (
        client.patch(
            base + f"views/{private['id']}/", {"name": "stolen", "revision": private["revision"]}, format="json"
        ).status_code
        == 403
    )
    client.force_authenticate(user=owner)
    # A normal member receives the view, but no additional record privileges.
    WorkspaceMember.objects.filter(workspace=workspace, member=other).update(role=15)
    UserOrganizationRole.objects.filter(workspace=workspace, user=other).delete()
    member = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    UserOrganizationRole.objects.create(workspace=workspace, user=other, role=member)
    shared = client.post(
        base + "views/",
        {
            "name": "shared",
            "visibility": "shared",
            "definition": spec("title"),
            "recipients": {"users": [str(other.id)]},
        },
        format="json",
    )
    assert shared.status_code == 201, shared.data
    client.force_authenticate(user=other)
    response = client.post(base + "query/", {"view_id": shared.data["id"]}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["count"] == 0
    assert client.put(base + "presentation/", {"rules": []}, format="json").status_code == 403
    assert (
        client.post(base + "exports/", {"format": "csv", "definition": spec("title")}, format="json").status_code == 403
    )


def test_legacy_favorites_never_expose_engine_views_and_keep_legacy_views_working(engine):
    workspace, owner, client = engine
    entity, _ = make_entity(engine)
    base = endpoint(workspace, f"entities/{entity.code}/")
    private = client.post(base + "views/", {"name": "secret title", "definition": spec("title")}, format="json").data
    project = create_record(engine, workspace.entity_types.get(code="project"), {"title": "Favorite project"})
    other = User.objects.create_user(
        email="favorite-other@example.com", username="favorite-other", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=20)
    client.force_authenticate(user=other)
    favorites_url = f"/api/workspaces/{workspace.slug}/user-favorites/"
    response = client.post(favorites_url, {"entity_type": "view", "entity_identifier": private["id"]}, format="json")
    assert response.status_code == 400, response.data
    # An old favorite row or POST's existing-row shortcut must not leak details.
    favorite = UserFavorite.objects.create(
        workspace=workspace, user=other, entity_type="view", entity_identifier=private["id"]
    )
    listed = client.get(favorites_url)
    assert listed.status_code == 200, listed.data
    assert next(row for row in listed.data if row["id"] == str(favorite.id))["entity_data"] is None
    existing = client.post(favorites_url, {"entity_type": "view", "entity_identifier": private["id"]}, format="json")
    assert existing.status_code == 200 and existing.data["entity_data"] is None
    project_url = f"/api/workspaces/{workspace.slug}/projects/{project['id']}/user-favorite-views/"
    assert client.post(project_url, {"view": private["id"]}, format="json").status_code == 404
    legacy = IssueView.objects.create(workspace=workspace, owned_by=owner, name="legacy view")
    response = client.post(favorites_url, {"entity_type": "view", "entity_identifier": str(legacy.id)}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["entity_data"]["name"] == "legacy view"


def test_hidden_fields_cannot_leak_via_query_rules_summary_or_export(engine):
    workspace, owner, client = engine
    role = OrganizationRole.objects.create(workspace=workspace, name="مالی نما")
    UserOrganizationRole.objects.create(workspace=workspace, user=owner, role=role)
    entity, _ = make_entity(
        engine,
        [
            {
                "code": "secret",
                "kind": "money",
                "title": "محرمانه",
                "binding": {"view_roles": [str(role.id)], "edit_roles": [str(role.id)]},
            }
        ],
    )
    record = create_record(engine, entity, {"title": "record", "secret": "100"})
    entity.view_settings = {
        "rules": [
            {
                "when": {"field": "secret", "op": "gt", "value": 50},
                "target": "row",
                "priority": 1,
                "style": {"color": "#ff0000"},
            }
        ],
        "summary": [{"field": "secret"}, {"field": "title"}],
    }
    entity.save()
    base = endpoint(workspace, f"entities/{entity.code}/")
    secret_view = client.post(
        base + "views/",
        {
            "name": "restricted",
            "definition": spec("title", "secret", filter={"field": "secret", "op": "gt", "value": 50}),
        },
        format="json",
    )
    assert secret_view.status_code == 201, secret_view.data
    UserOrganizationRole.objects.filter(workspace=workspace, user=owner, role=role).delete()
    base = endpoint(workspace, f"entities/{entity.code}/")
    result = query(engine, entity, spec("title"))
    assert result.status_code == 200, result.data
    assert result.data["results"][0]["styles"] == {"row": {}, "cells": {}, "badges": {}}
    listed = client.get(base + "views/")
    assert "secret" not in str(listed.data["results"][0]["definition"])
    updated = client.put(base + "presentation/", {"rules": []}, format="json")
    assert updated.status_code == 200, updated.data
    assert updated.data["rules"] == []
    entity.refresh_from_db()
    assert len(entity.view_settings["rules"]) == 1
    audit = client.get(endpoint(workspace, "events/"))
    assert audit.status_code == 200, audit.data
    for event in audit.data["results"]:
        if event["type"].startswith("view."):
            assert "secret" not in str([event["before"], event["after"]])
    for definition in [
        spec("title", filter={"field": "secret", "op": "gt", "value": 0}),
        spec("title", sort=[{"field": "secret", "direction": "asc"}]),
        spec("title", group="secret"),
    ]:
        assert query(engine, entity, definition).status_code in {400, 403}
    summary = client.get(base + f"records/{record['id']}/summary/")
    assert [f["field"] for f in summary.data["fields"]] == ["title"]
    assert client.post(
        base + "exports/", {"format": "csv", "definition": spec("secret")}, format="json"
    ).status_code in {400, 403}


def test_calendar_ranges_and_live_today_formula_are_server_side(engine):
    entity, _ = make_entity(
        engine,
        [
            {"code": "day", "kind": "date", "title": "تاریخ"},
            {"code": "window", "kind": "date_range", "title": "بازه"},
            {
                "code": "days_left",
                "kind": "computed",
                "title": "روز",
                "config": {"formula": {"op": "date_diff", "args": [{"field": "day"}, {"dynamic": "today"}]}},
            },
        ],
    )
    create_record(
        engine,
        entity,
        {"title": "October", "day": "2026-10-19", "window": {"start": "2026-09-30", "end": "2026-10-04"}},
    )
    create_record(
        engine,
        entity,
        {"title": "November", "day": "2026-11-19", "window": {"start": "2026-11-01", "end": "2026-11-04"}},
    )
    for axis in ["day", "window"]:
        response = query(
            engine,
            entity,
            spec(
                "title",
                "day",
                "days_left",
                type="calendar",
                settings={"calendar_field": axis, "calendar_start": "2026-10-01", "calendar_end": "2026-10-31"},
            ),
        )
        assert response.status_code == 200, response.data
        assert response.data["count"] == 1
        assert response.data["results"][0]["values"]["days_left"] is not None


def test_nullable_membership_exact_large_money_and_localized_search(engine):
    entity, _ = make_entity(
        engine,
        [{"code": "value", "kind": "money", "title": "مبلغ"}, {"code": "flag", "kind": "boolean", "title": "گزینه"}],
    )
    create_record(engine, entity, {"title": "alpha", "value": "123456789012345678901234567890", "flag": False})
    create_record(engine, entity, {"title": "beta", "value": "2000.25", "flag": None})
    result = query(
        engine, entity, spec("title", "value", "flag", filter={"field": "flag", "op": "in", "value": [False, None]})
    )
    assert result.status_code == 200, result.data
    assert result.data["count"] == 2
    assert any(r["values"]["value"] == "123456789012345678901234567890" for r in result.data["results"])
    result = query(engine, entity, spec("title", "value"), search="۲۰۰۰")
    assert result.status_code == 200, result.data
    assert result.data["count"] == 1
    assert result.data["results"][0]["title"] == "beta"
    result = query(engine, entity, spec("title", filter={"field": "value", "op": "gt", "value": None}))
    assert result.status_code == 400


def test_native_member_can_change_own_status_without_obtaining_general_edit_permission(engine):
    workspace, owner, client = engine
    receiver = User.objects.create_user(
        email="view-receiver@example.com", username="view-receiver", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=receiver, role=15)
    entity = workspace.entity_types.get(code="task")
    task = create_record(
        engine, entity, {"title": "assigned", "assignee": str(receiver.id), "task_status": "todo", "priority": "medium"}
    )
    client.force_authenticate(user=receiver)
    base = endpoint(workspace, "entities/task/")
    schema = client.get(base + f"schema/?record={task['id']}").data
    fields = {f["code"]: f for f in schema["fields"]}
    assert fields["title"]["config"]["readonly"] is True
    assert fields["task_status"]["config"]["readonly"] is False
    listed = query(engine, entity, spec("title", "task_status"))
    assert listed.status_code == 200, listed.data
    assert listed.data["results"][0]["can_edit"] is True
    assert "title" not in listed.data["results"][0]["editable_fields"]
    changed = client.patch(
        base + f"records/{task['id']}/",
        {"revision": task["revision"], "values": {"task_status": "in_progress"}},
        format="json",
    )
    assert changed.status_code == 200, changed.data
    assert (
        client.patch(
            base + f"records/{task['id']}/",
            {"revision": changed.data["revision"], "values": {"title": "forbidden"}},
            format="json",
        ).status_code
        == 403
    )


def test_deactivated_column_warns_and_sensitive_filter_is_never_silently_removed(engine):
    entity, _ = make_entity(engine, [{"code": "old_field", "kind": "integer", "title": "قدیمی"}])
    create_record(engine, entity, {"title": "a", "old_field": 10})
    FieldDefinition.objects.filter(workspace=engine[0], code="old_field").update(is_active=False)
    response = query(engine, entity, spec("title", "old_field"))
    assert response.status_code == 200, response.data
    assert response.data["warnings"]
    assert "old_field" not in response.data["results"][0]["values"]
    assert (
        query(engine, entity, spec("title", filter={"field": "old_field", "op": "eq", "value": 10})).status_code == 400
    )


def test_role_unit_sharing_default_precedence_copy_and_foreign_bulk_scope(engine):
    workspace, owner, client = engine
    entity, _ = make_entity(engine)
    owner_record = create_record(engine, entity, {"title": "owner only"})
    first_role = OrganizationRole.objects.create(workspace=workspace, name="role-one")
    second_role = OrganizationRole.objects.create(workspace=workspace, name="role-two")
    reader = User.objects.create_user(
        email="role-reader@example.com", username="role-reader", password="SafePassword!2026"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=reader, role=15)
    for role in [first_role, second_role]:
        UserOrganizationRole.objects.create(workspace=workspace, user=reader, role=role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="support")
    OrganizationUnitMember.objects.create(unit=unit, user=reader)
    base = endpoint(workspace, f"entities/{entity.code}/")
    official = []
    for role in [first_role, second_role]:
        saved = client.post(
            base + "views/",
            {"name": role.name, "visibility": "official", "definition": spec("title"), "default_roles": [str(role.id)]},
            format="json",
        )
        assert saved.status_code == 201, saved.data
        official.append(saved.data)
    shared = []
    for recipients in [{"units": [str(unit.id)]}, {"roles": [str(first_role.id)]}]:
        saved = client.post(
            base + "views/",
            {"name": "shared", "visibility": "shared", "definition": spec("title"), "recipients": recipients},
            format="json",
        )
        assert saved.status_code == 201, saved.data
        shared.append(saved.data["id"])
    client.force_authenticate(user=reader)
    listed = client.get(base + "views/").data
    assert set(shared).issubset({v["id"] for v in listed["results"]})
    expected = min(official, key=lambda view: view["default_roles"][0])
    assert listed["default_id"] == expected["id"]
    copied = client.post(
        base + "views/", {"copy_from": shared[0], "name": "my copy", "visibility": "personal"}, format="json"
    )
    assert copied.status_code == 201, copied.data
    assert copied.data["definition"]["columns"][0]["field"] == "title"
    renamed = client.patch(
        base + f"views/{copied.data['id']}/", {"name": "renamed", "revision": copied.data["revision"]}, format="json"
    )
    assert renamed.status_code == 200, renamed.data
    assert client.delete(base + f"views/{copied.data['id']}/").status_code == 204
    denied = client.post(base + "bulk/", {"ids": [owner_record["id"]], "operation": "delete"}, format="json")
    assert denied.status_code == 200, denied.data
    assert denied.data["success_count"] == 0
    assert EntityRecord.objects.filter(id=owner_record["id"]).exists()
    # Revoking both the unit membership and role removes each shared recipient path.
    OrganizationUnitMember.objects.filter(unit=unit, user=reader).delete()
    UserOrganizationRole.objects.filter(role=first_role, user=reader).delete()
    assert not set(shared).intersection(v["id"] for v in client.get(base + "views/").data["results"])


def test_four_system_views_use_real_referral_history_and_native_scope(engine):
    from plane.db.models import Issue, State, IssueActivity

    workspace, owner, client = engine
    project = create_record(engine, workspace.entity_types.get(code="project"), {"title": "System view project"})
    entity = workspace.entity_types.get(code="ticket")
    assigned = create_record(
        engine,
        entity,
        {"title": "assigned", "project": project["id"], "ticket_assignees": [str(owner.id)], "due_date": "2020-01-01"},
    )
    unassigned = create_record(
        engine, entity, {"title": "unassigned", "project": project["id"], "due_date": "2020-01-01"}
    )
    done = create_record(engine, entity, {"title": "done", "project": project["id"], "due_date": "2020-01-01"})
    Issue.objects.filter(id=done["id"]).update(
        state=State.objects.filter(project_id=project["id"], group="completed").first()
    )
    # A historical referral remains relevant after the record becomes unassigned.
    IssueActivity.objects.create(
        workspace=workspace,
        project_id=project["id"],
        issue_id=unassigned["id"],
        actor=owner,
        field="assignees",
        new_identifier=owner.id,
    )
    base = endpoint(workspace, "entities/ticket/")
    listed = client.get(base + "views/").data
    assert len(listed["system"]) == 4
    expected = {
        "mine": {assigned["id"], unassigned["id"], done["id"]},
        "referred": {unassigned["id"]},
        "overdue": {assigned["id"], unassigned["id"]},
        "unassigned": {unassigned["id"], done["id"]},
    }
    for name, identifiers in expected.items():
        response = client.post(
            base + "query/", {"view_id": f"system:{name}", "definition": spec("title")}, format="json"
        )
        assert response.status_code == 200, response.data
        assert {row["id"] for row in response.data["results"]} == identifiers


def test_lookup_titles_search_and_all_rule_targets_have_consistent_priority(engine):
    workspace, _, client = engine
    category = LookupCategory.objects.create(workspace=workspace, code="view-phase", title="مرحله")
    option = LookupValue.objects.create(category=category, code="open", title="آماده بررسی", color="#112233")
    entity, _ = make_entity(engine, [{"code": "phase", "title": "مرحله", "kind": "select", "lookup": category}])
    create_record(engine, entity, {"title": "case", "phase": str(option.id)})
    found = query(engine, entity, spec("title", "phase"), search="آماده")
    assert found.status_code == 200, found.data
    assert found.data["count"] == 1
    assert found.data["labels"]["phase"][str(option.id)]["color"] == "#112233"
    rules = [
        {
            "target": target,
            "field": "phase",
            "priority": priority,
            "when": {"field": "phase", "op": "eq", "value": str(option.id)},
            "style": {"color": color, "icon": "flag"},
        }
        for target in ["row", "cell", "badge"]
        for priority, color in [(9, "#667788"), (1, "#aabbcc")]
    ]
    response = client.put(endpoint(workspace, f"entities/{entity.code}/presentation/"), {"rules": rules}, format="json")
    assert response.status_code == 200, response.data
    for kind in ["table", "kanban", "calendar", "cards", "list"]:
        result = query(engine, entity, spec("title", "phase", type=kind))
        assert result.status_code == 200, result.data
        styles = result.data["results"][0]["styles"]
        assert (
            styles["row"]["color"]
            == styles["cells"]["phase"]["color"]
            == styles["badges"]["phase"]["color"]
            == "#667788"
        )


def test_summary_order_and_subtype_fields_respect_role_setting_and_field_acl(engine):
    workspace, owner, client = engine
    entity, root = make_entity(engine, [{"code": "shared_amount", "kind": "money", "title": "مبلغ"}])
    subtype = EntityType.objects.create(workspace=workspace, parent=entity, code="summary-special", title="ویژه")
    FieldDefinition.objects.create(workspace=workspace, code="special_note", title="یادداشت ویژه", kind="short_text")
    layout = {"tabs": [], "sections": [{"id": "sub", "columns": 1, "bindings": [{"field": "special_note"}]}]}
    form = FormLayout.objects.create(entity=subtype, draft=layout)
    form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
    form.save()
    record = create_record(
        engine, entity, {"title": "special", "shared_amount": "10", "special_note": "specific"}, subtype=subtype.code
    )
    admin = OrganizationRole.objects.get(workspace=workspace, system_key="admin")
    base = endpoint(workspace, f"entities/{entity.code}/")
    response = client.put(
        base + "presentation/",
        {
            "summary": [
                {"field": "special_note", "subtype": subtype.code, "roles": [str(admin.id)]},
                {"field": "shared_amount"},
                {"field": "title"},
            ]
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    result = client.get(base + f"records/{record['id']}/summary/")
    assert [item["field"] for item in result.data["fields"]] == ["special_note", "shared_amount", "title"]
    assert result.data["fields"][0]["value"] == "specific"
    UserOrganizationRole.objects.filter(workspace=workspace, user=owner, role=admin).update(is_active=False)
    member = OrganizationRole.objects.get(workspace=workspace, system_key="member")
    UserOrganizationRole.objects.create(workspace=workspace, user=owner, role=member)
    result = client.get(base + f"records/{record['id']}/summary/")
    assert result.status_code == 200, result.data
    assert [item["field"] for item in result.data["fields"]] == ["shared_amount", "title"]
