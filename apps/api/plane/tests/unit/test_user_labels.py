from types import SimpleNamespace

from plane.app.services.user_labels import user_label


def test_full_name_precedes_generated_identity():
    user = SimpleNamespace(first_name=" علی ", last_name=" رضایی ", display_name="124798", username="c5f9a72d")
    assert user_label(user) == "علی رضایی"


def test_existing_display_name_is_preserved_when_full_name_is_missing():
    assert user_label(SimpleNamespace(display_name="مریم احمدی", username="124798")) == "مریم احمدی"


def test_missing_profile_uses_readable_available_identity():
    assert user_label(SimpleNamespace(username="support")) == "support"
    assert user_label(SimpleNamespace(email="support@example.test")) == "support@example.test"
    assert user_label(SimpleNamespace()) == "کاربر بدون نام"


def test_generated_numbers_and_uuid_are_not_used_as_user_labels():
    user = SimpleNamespace(
        display_name="۱۲۳۴۵۶", username="12345678-1234-1234-1234-123456789012", email="support@example.test"
    )
    assert user_label(user) == "support@example.test"
