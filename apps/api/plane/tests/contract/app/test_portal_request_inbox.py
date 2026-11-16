import pytest

from plane.app.services import portal_requests
from plane.db.models import Issue, IssueAssignee, SurfaceConfiguration
from plane.tests.contract.app.test_ticket_seven_portal import org, two, person, staff_client, submit, PORTAL

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def url(org):
    return f"/api/workspaces/{org['workspace'].slug}/portal/requests/"


def test_internal_inbox_lists_both_customers_with_paging_search_and_stage(org, two, monkeypatch):
    first = submit(two["alice"], subject="چاپگر مشتری الف")
    second = submit(two["bob"], subject="اتصال مشتری ب")
    assert first.status_code == second.status_code == 201
    Issue.objects.filter(id=second.data["id"]).update(portal_stage="awaiting_customer")
    monkeypatch.setattr(portal_requests, "PAGE_SIZE", 1)
    client = staff_client(org["agent"])
    result = client.get(url(org))
    assert result.status_code == 200, result.data
    assert result.data["count"] == 2 and result.data["pages"] == 2
    assert result.data["counts"]["all"] == 2 and result.data["counts"]["pending"] == 1
    assert result.data["results"][0]["customer"]["title"] == "شرکت ب"
    next_page = client.get(url(org), {"page": 2})
    assert next_page.data["results"][0]["id"] == first.data["id"]
    assert client.get(url(org), {"q": first.data["number"]}).data["count"] == 1
    assert client.get(url(org), {"stage": "awaiting_customer"}).data["results"][0]["id"] == second.data["id"]
    assert client.get(url(org), {"stage": "made_up"}).status_code == 400
    assert client.get(url(org), {"page": "wrong"}).status_code == 400
    assert "password" not in str(result.data) and "messages" not in result.data["results"][0]


def test_inbox_never_widens_ticket_visibility_or_accepts_customer_session(org, two):
    first = submit(two["alice"])
    second = submit(two["bob"])
    viewer = person(org["workspace"], "inbox-viewer", ["Portal.Reply"])
    IssueAssignee.objects.create(workspace=org["workspace"], issue_id=first.data["id"], assignee=viewer)
    client = staff_client(viewer)
    result = client.get(url(org))
    assert result.status_code == 200, result.data
    assert [row["id"] for row in result.data["results"]] == [first.data["id"]]
    assert result.data["counts"]["all"] == 1
    assert client.get(f"/api/workspaces/{org['workspace'].slug}/tickets/{second.data['id']}/portal/").status_code == 404
    assert staff_client(org["plain"]).get(url(org)).status_code == 403
    assert two["alice"].get(url(org)).status_code in (401, 403)


def test_portal_profile_exposes_only_customer_form_presentation(org, two):
    SurfaceConfiguration.objects.create(
        workspace=org["workspace"],
        code="portal-customer-request",
        definition={
            "native": {
                "subject": {"title": "عنوان درخواست شما", "placeholder": "موضوع را کوتاه بنویسید", "hidden": False},
                "internal_secret": {"title": "نباید نمایش داده شود"},
            },
            "fields": [{"field": "private"}],
        },
    )
    response = two["alice"].get(f"{PORTAL}session/")
    assert response.status_code == 200
    fields = response.data["account"]["request_form"]
    assert set(fields) == {"subject", "description"}
    assert fields["subject"]["title"] == "عنوان درخواست شما"
    assert set(fields["subject"]) == {"title", "placeholder"}
