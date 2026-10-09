import pytest
from django.template.loader import render_to_string


@pytest.mark.parametrize(
    "template_name",
    [
        "auth/magic_signin.html",
        "auth/forgot_password.html",
        "invitations/workspace_invitation.html",
        "invitations/project_invitation.html",
        "notifications/project_addition.html",
        "notifications/issue-updates.html",
        "notifications/webhook-deactivate.html",
        "exports/analytics.html",
        "user/user_activation.html",
        "user/user_deactivation.html",
        "user/email_updated.html",
    ],
)
def test_email_company_logo_is_public_and_uses_the_application_origin(settings, template_name):
    settings.WEB_URL = "https://crm.example.com/"
    html = render_to_string(f"emails/{template_name}", {})
    assert 'src="https://crm.example.com/branding/amard-logo.png"' in html
    assert "media.docs.plane.so/logo" not in html
