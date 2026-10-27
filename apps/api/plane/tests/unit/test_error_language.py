import pytest
from plane.app.services.error_language import persian_errors


def test_persian_errors_and_field_structure_are_preserved():
    assert persian_errors({"error": "این کار به شما واگذار نشده است."}, 403) == {
        "error": "این کار به شما واگذار نشده است."
    }
    assert persian_errors({"assignee_id": ["ورودی نامعتبر است."]}) == {"assignee_id": ["ورودی نامعتبر است."]}
    assert persian_errors({"error": "This username is already in use."}) == {
        "error": "این نام کاربری قبلاً انتخاب شده است"
    }


@pytest.mark.parametrize("message", ["This email is already in use.", "user with this email already exists."])
def test_duplicate_email_has_the_requested_message(message):
    assert persian_errors({"email": [message]}) == {"email": ["این ایمیل ثبت شده است"]}


def test_unknown_errors_are_localized_but_machine_codes_are_preserved():
    result = persian_errors({"error_code": "INVALID_INPUT", "detail": {"name": ["Unexpected validation error"]}})
    assert result["error_code"] == "INVALID_INPUT"
    assert not result["detail"]["name"][0].isascii()
    assert persian_errors({"detail": "Internal failure"}, 500) == {"detail": "مشکلی در سرور پیش آمد؛ دوباره تلاش کنید."}


def test_structured_form_errors_preserve_the_input_path():
    error = {"detail": "نام فیلد را وارد کنید.", "errors": [{"path": "title", "label": "نام فیلد", "message": "نام فیلد را وارد کنید."}]}
    assert persian_errors(error) == error


def test_duplicate_record_links_and_rule_codes_are_data_not_translatable_messages():
    error = {"duplicates": [{"message": "این مقدار قبلاً ثبت شده است", "record_url": "/entities/customer/123", "fields": ["national_id"], "rule": "123"}], "choices": ["resolve", "new_only"]}
    assert persian_errors(error) == error


def test_structured_substitute_data_is_not_translated_in_conflict_responses():
    error = {
        "warning": "این فرد غایب است؛ پیش از ارجاع تأیید کنید.",
        "substitute": {"id": "5c5540f2-1e79-4890-a487-ab14d843a6d6", "name": "T7 worker"},
    }
    assert persian_errors(error, 409) == error


def test_only_failed_responses_are_translated():
    from rest_framework.response import Response
    from rest_framework.test import APIRequestFactory
    from rest_framework.views import APIView
    from plane.app.views.base import PersianErrorMixin

    class ExampleView(PersianErrorMixin, APIView):
        authentication_classes = []
        permission_classes = []

        def get(self, request):
            return Response({"name": "English project name"})

        def post(self, request):
            return Response({"email": ["This field must be unique."]}, status=400)

    factory = APIRequestFactory()
    assert ExampleView.as_view()(factory.get("/")).data == {"name": "English project name"}
    assert ExampleView.as_view()(factory.post("/")).data == {"email": ["این ایمیل ثبت شده است"]}
