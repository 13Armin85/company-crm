"""Form settings must affect the original write API, including direct clients."""

from copy import deepcopy
from uuid import uuid4

import pytest

from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import (
    FieldDefinition,
    OrganizationRole,
    SurfaceConfiguration,
    SurfaceValues,
    EntityEvent,
    User,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


@pytest.fixture
def surface(workspace, create_user, session_client):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    return workspace, create_user, session_client


def path(workspace, code="roles", suffix=""):
    return f"/api/workspaces/{workspace.slug}/engine/surfaces/{code}/{suffix}"


def publish(surface, code="roles", **changes):
    workspace, _, client = surface
    response = client.get(path(workspace, code))
    assert response.status_code == 200, response.data
    definition = deepcopy(response.data["definition"])
    definition.update(changes)
    response = client.put(
        path(workspace, code),
        {"revision": response.data["revision"], "definition": definition},
        format="json",
    )
    assert response.status_code == 200, response.data
    return response.data


def role_url(workspace, identifier=""):
    return f"/api/workspaces/{workspace.slug}/organization/roles/{str(identifier) + '/' if identifier else ''}"


def field(surface, **kwargs):
    return FieldDefinition.objects.create(
        workspace=surface[0],
        code="contract-score",
        title="امتیاز قرارداد",
        kind="integer",
        **kwargs,
    )


def test_all_native_pages_have_a_backend_configuration(surface):
    workspace, _, client = surface
    # The catalog lives at surfaces/, without an empty code segment.
    response = client.get(f"/api/workspaces/{workspace.slug}/engine/surfaces/")
    assert response.status_code == 200, response.data
    project_work = next(row for row in response.data["results"] if row["code"] == "ticket")
    assert project_work["title"] == "کارهای پروژه"
    assert {row["code"] for row in response.data["results"]} >= {
        "ticket",
        "task",
        "project",
        "leave",
        "users",
        "roles",
        "units",
        "routing",
        "cycles",
        "profile",
        "security",
        "notifications",
        "workspace",
        "password",
        "exceptions",
        "delegates",
        "role-permissions",
        "appearance",
    }
    assert SurfaceConfiguration.objects.count() == 0  # Reads never initialize records.


def test_configuration_requires_publish_permission_and_rejects_stale_revisions(surface):
    workspace, _, client = surface
    first = publish(surface)
    response = client.put(
        path(workspace),
        {"revision": 0, "definition": first["definition"]},
        format="json",
    )
    assert response.status_code == 409
    assert (
        SurfaceConfiguration.objects.get(workspace=workspace, code="roles").revision
        == 1
    )
    outsider = User.objects.create(
        email="outsider-surface@example.com", username="outsider-surface"
    )
    client.force_authenticate(outsider)
    assert client.get(path(workspace)).status_code in {403, 404}
    assert client.put(
        path(workspace),
        {"revision": 1, "definition": first["definition"]},
        format="json",
    ).status_code in {403, 404}


def test_required_typed_field_is_enforced_on_the_original_role_endpoint(surface):
    workspace, _, client = surface
    extra = field(surface, config={"min": 0, "max": 10})
    publish(
        surface,
        fields=[{"field": extra.code, "required": True}],
        columns=[f"field:{extra.code}", "native:نام نقش"],
    )
    for values in ({}, {extra.code: "wrong"}, {extra.code: 11}):
        response = client.post(
            role_url(workspace),
            {"name": "قرارداد", "custom_values": values},
            format="json",
        )
        assert response.status_code == 400, response.data
    assert not OrganizationRole.objects.filter(
        workspace=workspace, name="قرارداد"
    ).exists()
    response = client.post(
        role_url(workspace),
        {"name": "قرارداد", "custom_values": {extra.code: 7}},
        format="json",
    )
    assert response.status_code == 201, response.data
    record_id = response.data["id"]
    assert SurfaceValues.objects.get(
        workspace=workspace, code="roles", object_id=record_id
    ).values == {extra.code: 7}
    response = client.get(path(workspace, suffix=f"values/?ids={record_id}"))
    assert response.status_code == 200, response.data
    assert response.data["values"][str(record_id)][extra.code] == 7
    assert (
        client.patch(
            role_url(workspace, record_id),
            {"description": "فقط مشخصات اصلی"},
            format="json",
        ).status_code
        == 200
    )
    assert (
        SurfaceValues.objects.get(object_id=record_id, code="roles").values[extra.code]
        == 7
    )


def test_required_can_be_removed_without_changing_the_field_library(surface):
    workspace, _, client = surface
    extra = field(surface, config={"required": True})
    publish(surface, fields=[{"field": extra.code, "required": False}])
    response = client.post(
        role_url(workspace), {"name": "اختیاری", "custom_values": {}}, format="json"
    )
    assert response.status_code == 201, response.data
    extra.refresh_from_db()
    assert extra.config["required"] is True


def test_native_optional_input_can_be_required_then_removed(surface):
    workspace, _, client = surface
    old_role = OrganizationRole.objects.create(workspace=workspace, name="نقش قدیمی")
    publish(surface, native={"description": {"required": True}})
    response = client.post(role_url(workspace), {"name": "توضیح لازم"}, format="json")
    assert response.status_code == 400
    response = client.patch(
        role_url(workspace, old_role.id), {"name": "نام عوض‌شده"}, format="json"
    )
    assert response.status_code == 400
    publish(surface, native={"description": {"hidden": True, "required": False}})
    response = client.post(
        role_url(workspace),
        {"name": "توضیح مخفی", "description": "نباید اعمال شود"},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert OrganizationRole.objects.get(id=response.data["id"]).description == ""


def test_unknown_or_hidden_custom_values_cannot_be_injected(surface):
    workspace, _, client = surface
    extra = field(surface)
    publish(surface, fields=[{"field": extra.code, "hidden": True}])
    for values, expected in (({"unknown": 1}, 400), ({extra.code: 3}, 403)):
        response = client.post(
            role_url(workspace),
            {"name": "تزریق", "custom_values": values},
            format="json",
        )
        assert response.status_code == expected, response.data
    assert not OrganizationRole.objects.filter(
        name="تزریق", workspace=workspace
    ).exists()


def test_configuration_cannot_attach_foreign_fields_or_remove_system_inputs(surface):
    workspace, actor, client = surface
    other = Workspace.objects.create(
        name="شرکت دیگر", slug="foreign-surface", owner=actor
    )
    foreign = FieldDefinition.objects.create(
        workspace=other, code="foreign", title="خارجی", kind="short_text"
    )
    current = client.get(path(workspace)).data
    for patch in (
        {"fields": [{"field": foreign.code}]},
        {"native": {"name": {"hidden": True}}},
        {"native": {"name": {"required": False}}},
    ):
        response = client.put(
            path(workspace),
            {"revision": 0, "definition": {**current["definition"], **patch}},
            format="json",
        )
        assert response.status_code == 400, response.data
    assert not SurfaceConfiguration.objects.filter(workspace=workspace).exists()


def test_failed_native_mutation_does_not_commit_custom_values(surface):
    workspace, _, client = surface
    extra = field(surface)
    publish(surface, fields=[{"field": extra.code}])
    response = client.post(
        role_url(workspace),
        {"name": "", "custom_values": {extra.code: 4}},
        format="json",
    )
    assert response.status_code == 400
    assert not SurfaceValues.objects.filter(workspace=workspace).exists()
    assert not EntityEvent.objects.filter(
        workspace=workspace, event_type="surface.values.updated"
    ).exists()


def test_removing_field_preserves_history_and_removes_it_from_values_and_columns(
    surface,
):
    workspace, _, client = surface
    extra = field(surface)
    publish(surface, fields=[{"field": extra.code}], columns=[f"field:{extra.code}"])
    response = client.post(
        role_url(workspace),
        {"name": "سابقه", "custom_values": {extra.code: 8}},
        format="json",
    )
    assert response.status_code == 201, response.data
    identifier = response.data["id"]
    publish(surface, fields=[], columns=["native:نام نقش"])
    assert (
        SurfaceValues.objects.get(object_id=identifier, code="roles").values[extra.code]
        == 8
    )
    response = client.get(path(workspace, suffix=f"values/?ids={identifier}"))
    assert response.data["values"][str(identifier)] == {}


def test_personal_form_values_are_scoped_to_the_authenticated_user(surface):
    workspace, actor, client = surface
    extra = field(surface)
    publish(surface, code="profile", fields=[{"field": extra.code, "required": True}])
    response = client.patch(
        "/api/users/me/",
        {"display_name": "نام جدید", "custom_values": {extra.code: 5}},
        format="json",
        HTTP_X_CRM_WORKSPACE=workspace.slug,
    )
    assert response.status_code == 200, response.data
    assert (
        SurfaceValues.objects.get(
            workspace=workspace, code="profile", object_id=actor.id
        ).values[extra.code]
        == 5
    )
    other = User.objects.create(
        email="other-surface@example.com", username="other-surface"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
    SurfaceValues.objects.create(
        workspace=workspace, code="profile", object_id=other.id, values={extra.code: 99}
    )
    response = client.get(
        path(workspace, "profile", f"values/?ids={actor.id},{other.id}")
    )
    assert set(response.data["values"]) == {str(actor.id)}


@pytest.mark.parametrize(
    "columns", [[], ["native:نام نقش", "native:نام نقش"], ["field:unattached"]]
)
def test_invalid_columns_are_rejected(surface, columns):
    workspace, _, client = surface
    initial = client.get(path(workspace)).data
    response = client.put(
        path(workspace),
        {"revision": 0, "definition": {**initial["definition"], "columns": columns}},
        format="json",
    )
    assert response.status_code == 400, response.data


def test_invalid_ids_are_client_errors(surface):
    workspace, _, client = surface
    assert client.get(path(workspace, suffix="values/?ids=bad-id")).status_code == 400
    assert (
        client.get(
            path(
                workspace,
                suffix="values/?ids=" + ",".join(str(uuid4()) for _ in range(101)),
            )
        ).status_code
        == 400
    )


def test_export_import_includes_native_form_and_column_settings(surface):
    from plane.app.services.entity_config import export_config, import_config

    workspace, actor, _ = surface
    extra = field(surface)
    published = publish(
        surface,
        fields=[{"field": extra.code, "required": True}],
        columns=[f"field:{extra.code}", "native:نام نقش"],
    )
    other = Workspace.objects.create(
        name="مقصد فرم‌ها", slug="surface-import", owner=actor
    )
    initialize_engine(other)
    config = export_config(workspace)
    assert config["surfaces"][0]["definition"] == published["definition"]
    result = import_config(other, actor, config)
    assert result["surfaces"] == 1
    assert (
        SurfaceConfiguration.objects.get(workspace=other, code="roles").definition
        == published["definition"]
    )


@pytest.mark.parametrize(
    "code",
    [
        "units",
        "routing",
        "cycles",
        "users",
        "delegates",
        "role-permissions",
        "exceptions",
        "password",
        "notifications",
        "appearance",
        "workspace",
        "security",
    ],
)
def test_extra_values_are_saved_by_each_native_form_endpoint(surface, code):
    from plane.db.models import (
        OrganizationUnit,
        Project,
        ProjectMember,
        OrganizationPermission,
        Profile,
    )

    workspace, actor, client = surface
    extra = field(surface)
    publish(surface, code=code, fields=[{"field": extra.code, "required": True}])
    body, method, expected = {}, "post", 201
    headers = {}
    identifier = None
    root = f"/api/workspaces/{workspace.slug}"
    if code == "units":
        url, body = f"{root}/organization/units/", {"title": "واحد فرم سفارشی"}
    elif code in {"routing", "delegates"}:
        unit = OrganizationUnit.objects.create(workspace=workspace, title="واحد ارجاع")
        if code == "routing":
            role = OrganizationRole.objects.filter(
                workspace=workspace, is_active=True
            ).first()
            url, body = f"{root}/organization/routing-rules/", {
                "name": "ارجاع سفارشی",
                "unit_id": str(unit.id),
                "required_role_id": str(role.id),
            }
        else:
            url, body, method, expected, identifier = (
                f"{root}/organization/units/{unit.id}/delegates/",
                {"user_ids": []},
                "put",
                200,
                unit.id,
            )
    elif code == "cycles":
        project = Project.objects.create(
            workspace=workspace, name="پروژه چرخه", identifier="CYCS"
        )
        ProjectMember.objects.create(
            workspace=workspace, project=project, member=actor, role=20
        )
        url, body = f"{root}/projects/{project.id}/cycles/", {
            "name": "چرخه سفارشی",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
        }
    elif code == "users":
        url, body = f"{root}/members/", {
            "email": "native-surface@example.com",
            "username": "native-surface",
            "display_name": "کاربر سفارشی",
            "password": "V7!mQ2#rZ9$pL4@x",
        }
    elif code == "role-permissions":
        role = OrganizationRole.objects.create(
            workspace=workspace, name="نقش مجوز سفارشی"
        )
        url, body, method, expected, identifier = (
            f"{root}/organization/roles/{role.id}/",
            {"permission_ids": []},
            "patch",
            200,
            role.id,
        )
        headers["HTTP_X_CRM_SURFACE"] = code
    elif code == "exceptions":
        permission = OrganizationPermission.objects.get(
            workspace=workspace, code="Issue.View"
        )
        url, body = f"{root}/organization/users/{actor.id}/exceptions/", {
            "permission": str(permission.id),
            "effect": "ALLOW",
        }
    elif code == "password":
        target = User.objects.create(
            email="surface-reset@example.com", username="surface-reset"
        )
        WorkspaceMember.objects.create(workspace=workspace, member=target, role=15)
        url, body, expected, identifier = (
            f"{root}/organization/users/{target.id}/password/",
            {
                "new_password": "V7!mQ2#rZ9$pL4@x",
                "confirm_password": "V7!mQ2#rZ9$pL4@x",
            },
            200,
            target.id,
        )
    elif code in {"notifications", "appearance", "security"}:
        method, expected, identifier = "patch", 200, actor.id
        headers["HTTP_X_CRM_WORKSPACE"] = workspace.slug
        if code == "notifications":
            url, body = "/api/users/me/notification-preferences/", {
                "property_change": False
            }
        elif code == "appearance":
            Profile.objects.get_or_create(user=actor)
            url, body = "/api/users/me/profile/", {"theme": {"theme": "light"}}
        else:
            url, body, method = (
                "/auth/change-password/",
                {"old_password": "test-password", "new_password": "V7!mQ2#rZ9$pL4@x"},
                "post",
            )
    else:
        url, body, method, expected, identifier = (
            f"{root}/",
            {"name": "شرکت با فرم سفارشی"},
            "patch",
            200,
            workspace.id,
        )
    response = getattr(client, method)(
        url, {**body, "custom_values": {extra.code: 9}}, format="json", **headers
    )
    assert response.status_code == expected, response.data
    if code == "users":
        identifier = User.objects.get(email=body["email"]).id
    identifier = identifier or response.data["id"]
    assert (
        SurfaceValues.objects.get(
            workspace=workspace, code=code, object_id=identifier
        ).values[extra.code]
        == 9
    )


def test_personal_required_fields_cannot_be_bypassed_by_omitting_workspace_header(
    surface,
):
    workspace, actor, client = surface
    extra = field(surface)
    publish(surface, code="profile", fields=[{"field": extra.code, "required": True}])
    rejected = client.patch(
        "/api/users/me/", {"display_name": "بدون اطلاعات الزامی"}, format="json"
    )
    assert rejected.status_code == 400, rejected.data
    accepted = client.patch(
        "/api/users/me/",
        {"display_name": "اطلاعات کامل", "custom_values": {extra.code: 9}},
        format="json",
    )
    assert accepted.status_code == 200, accepted.data
    assert (
        SurfaceValues.objects.get(
            workspace=workspace, code="profile", object_id=actor.id
        ).values[extra.code]
        == 9
    )


def test_permission_form_header_cannot_bypass_role_information_rules(surface):
    workspace, _, client = surface
    role = OrganizationRole.objects.create(
        workspace=workspace, name="نقش محافظت‌شده", description="توضیح موجود"
    )
    publish(surface, native={"description": {"required": True}})
    response = client.patch(
        role_url(workspace, role.id),
        {"description": ""},
        format="json",
        HTTP_X_CRM_SURFACE="role-permissions",
    )
    assert response.status_code == 400, response.data
    role.refresh_from_db()
    assert role.description == "توضیح موجود"


def test_required_appearance_fields_do_not_block_workspace_navigation(surface):
    from plane.db.models import Profile

    workspace, actor, client = surface
    Profile.objects.get_or_create(user=actor)
    extra = field(surface)
    publish(
        surface, code="appearance", fields=[{"field": extra.code, "required": True}]
    )
    response = client.patch(
        "/api/users/me/profile/",
        {"last_workspace_id": str(workspace.id)},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert not SurfaceValues.objects.filter(
        workspace=workspace, code="appearance"
    ).exists()


def test_table_tabs_keep_independent_columns_and_can_be_removed(surface):
    extra = field(surface)
    saved = publish(
        surface,
        fields=[{"field": extra.code}],
        table_tabs=[
            {"id": "scores", "title": "امتیازها", "columns": [f"field:{extra.code}"]},
            {"id": "names", "title": "نام‌ها", "columns": ["native:نام نقش"]},
        ],
    )
    assert len(saved["definition"]["table_tabs"]) == 2
    assert saved["definition"]["table_tabs"][0]["columns"] == [f"field:{extra.code}"]
    assert publish(surface, table_tabs=[])["definition"]["table_tabs"] == []


@pytest.mark.parametrize(
    "tabs",
    [
        [{"id": "x", "title": "", "columns": ["native:نام نقش"]}],
        [{"id": "x", "title": "تب", "columns": []}],
        [{"id": "x", "title": "تب", "columns": ["field:foreign-field"]}],
        [{"id": "x", "title": "تب", "columns": ["native:نام نقش"]}] * 2,
        "not-a-list",
    ],
)
def test_invalid_table_tabs_are_rejected_without_publishing(surface, tabs):
    workspace, _, client = surface
    schema = client.get(path(workspace)).data
    schema["definition"]["table_tabs"] = tabs
    response = client.put(
        path(workspace),
        {"revision": schema["revision"], "definition": schema["definition"]},
        format="json",
    )
    assert response.status_code == 400, response.data
    assert not SurfaceConfiguration.objects.filter(workspace=workspace).exists()


def test_simple_field_creation_generates_choice_options_without_library_setup(surface):
    from plane.db.models import LookupValue

    workspace, _, client = surface
    response = client.post(
        path(workspace, suffix="fields/"),
        {
            "title": "سطح پیگیری",
            "kind": "select",
            "options": ["عادی", "فوری"],
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    assert response.data["lookup"]
    assert set(
        LookupValue.objects.filter(category_id=response.data["lookup"]).values_list(
            "title", flat=True
        )
    ) == {"عادی", "فوری"}


def test_simple_form_and_columns_publish_together_and_roll_back_on_invalid_columns(
    surface,
):
    from plane.db.models import FormLayout, FormVersion, EntityType

    workspace, _, client = surface
    schema = client.get(path(workspace, "project")).data
    extra = field(surface)
    layout = deepcopy(schema["form"]["layout"])
    layout["sections"][0]["bindings"].append(
        {"field": extra.code, "title": "امتیاز پروژه", "required": True}
    )
    schema["definition"]["columns"].append(f"engine:{extra.code}")
    body = {
        "revision": schema["revision"],
        "definition": schema["definition"],
        "form": {"revision": schema["form"]["revision"], "layout": layout},
    }
    accepted = client.put(path(workspace, "project"), body, format="json")
    assert accepted.status_code == 200, accepted.data
    assert accepted.data["form"]["layout"] == layout
    root = EntityType.objects.get(
        workspace=workspace, code="project", parent__isnull=True
    )
    before = FormLayout.objects.get(entity=root).revision
    versions = FormVersion.objects.filter(layout__entity=root).count()
    invalid = {
        "revision": accepted.data["revision"],
        "definition": {**accepted.data["definition"], "columns": ["bad-column"]},
        "form": accepted.data["form"],
    }
    response = client.put(path(workspace, "project"), invalid, format="json")
    assert response.status_code == 400, response.data
    assert FormLayout.objects.get(entity=root).revision == before
    assert FormVersion.objects.filter(layout__entity=root).count() == versions


@pytest.mark.parametrize("with_asset", [False, True])
def test_avatar_removal_clears_legacy_and_uploaded_images_idempotently(
    surface, with_asset
):
    from plane.db.models import FileAsset

    _, actor, client = surface
    actor.avatar = "https://example.com/old-avatar.png"
    if with_asset:
        asset = FileAsset.objects.create(
            user=actor, asset="avatar.png", entity_type="USER_AVATAR", is_uploaded=True
        )
        actor.avatar_asset = asset
    actor.save()
    for _ in range(2):
        response = client.delete("/api/users/me/avatar/")
        assert response.status_code == 204, getattr(response, "data", None)
    actor.refresh_from_db()
    assert actor.avatar == "" and actor.avatar_asset_id is None
    if with_asset:
        asset.refresh_from_db()
        assert asset.is_deleted and asset.deleted_at


def test_avatar_removal_cannot_clear_another_users_picture(surface):
    _, _, client = surface
    other = User.objects.create(
        email="other-avatar@example.com",
        username="avatar-other",
        avatar="https://example.com/other.png",
    )
    assert (
        client.delete(
            "/api/users/me/avatar/", {"user_id": str(other.id)}, format="json"
        ).status_code
        == 204
    )
    other.refresh_from_db()
    assert other.avatar == "https://example.com/other.png"
