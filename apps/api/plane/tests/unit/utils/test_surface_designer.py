import pytest
from rest_framework.exceptions import ErrorDetail, ValidationError

from plane.app.services.surface_designer import new_field_data, persian_errors

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "payload,key",
    [
        ({"title": "   "}, "title"),
        ({"title": "فیلد", "kind": []}, "kind"),
        ({"title": "فیلد", "kind": "computed"}, "kind"),
        ({"title": "فیلد", "kind": "select", "options": ["فوری", " فوری "]}, "options"),
        ({"title": "فیلد", "kind": "select", "options": []}, "options"),
        ({"title": "فیلد", "placeholder": False}, "placeholder"),
    ],
)
def test_field_creation_has_specific_persian_errors(payload, key):
    with pytest.raises(ValidationError) as error:
        new_field_data(payload)
    assert key in error.value.detail
    response = persian_errors(error.value.detail, 400)
    assert response["errors"][0]["path"] == key
    assert any("\u0600" <= char <= "\u06ff" for char in response["detail"])


def test_input_is_normalized_without_changing_its_help_text():
    result = new_field_data({"title": " شماره قرارداد ", "kind": "short_text", "help_text": "شناسه روی قرارداد"})
    assert result["title"] == "شماره قرارداد"
    assert result["help_text"] == "شناسه روی قرارداد"


def test_nested_framework_errors_are_localized_without_leaking_english():
    result = persian_errors({"title": [ErrorDetail("This field is required.", code="required")]}, 400)
    assert result["detail"] == "این ورودی را تکمیل کنید."
    assert result["errors"] == [{"path": "title", "label": "نام فیلد", "message": "این ورودی را تکمیل کنید."}]
