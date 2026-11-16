from copy import deepcopy

import pytest

from plane.app.services.report_sources import SOURCES, catalog
from plane.tests.contract.app.test_surface_configuration import surface, path, publish

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def test_saved_native_labels_placeholders_and_visibility_survive_reload(surface):
    workspace, _, client = surface
    saved = publish(
        surface,
        "leave-requests",
        native={
            "reason": {
                "title": "توضیح درخواست",
                "placeholder": "علت مرخصی را توضیح دهید",
                "help_text": "حداکثر دو هزار نویسه",
                "hidden": True,
            }
        },
    )
    read = client.get(path(workspace, "leave-requests"))
    assert read.status_code == 200
    field = next(field for field in read.data["native_fields"] if field["code"] == "reason")
    assert field["title"] == "توضیح درخواست" and field["hidden"] is True
    assert field["placeholder"] == "علت مرخصی را توضیح دهید"
    assert "دلیل مرخصی (اختیاری)" in field["aliases"]
    assert read.data["revision"] == saved["revision"]


@pytest.mark.parametrize(
    "patch",
    [
        {"start_date": {"hidden": True}},
        {"reason": {"required": True}},
        {"reason": {"title": " "}},
        {"unknown": {"title": "ورودی"}},
    ],
)
def test_page_design_cannot_break_business_requirements(surface, patch):
    workspace, _, client = surface
    current = client.get(path(workspace, "leave-requests")).data
    definition = {**current["definition"], "native": patch}
    result = client.put(
        path(workspace, "leave-requests"), {"revision": current["revision"], "definition": definition}, format="json"
    )
    assert result.status_code == 400, result.data
    assert client.get(path(workspace, "leave-requests")).data["revision"] == current["revision"]


def test_report_designer_changes_base_report_defaults_without_mutating_registry(surface):
    workspace, actor, _ = surface
    source = SOURCES["daily_report_items"]
    before = deepcopy(source.default)
    fields = [source.fields[-1], source.fields[0]]
    publish(surface, f"report-{source.code}", columns=[f"native:{field.label}" for field in fields])
    result = next(item for item in catalog(actor, workspace) if item["code"] == source.code)
    assert result["default"]["columns"] == [field.key for field in fields]
    assert source.default == before


def test_presentation_form_cannot_offer_unsaved_custom_fields(surface):
    workspace, _, client = surface
    result = client.post(
        path(workspace, "leave-requests", "fields/"), {"title": "فیلد گمشده", "kind": "short_text"}, format="json"
    )
    assert result.status_code == 400
    assert not client.get(path(workspace, "leave-requests")).data["designer"]["can_create_field"]
