"""Ticket 7 — customer portal and correspondence (section 4, phase 4 of the ticket).

File name: ``test_ticket_seven.py`` already holds the dashboard suite of an earlier
"ticket 7" numbering, so this suite lives next to it as ``test_ticket_seven_portal.py``.
"""

import importlib
import io
import json
import threading
import zipfile
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, migrations
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.services import portal_access, portal_notify, portal_settings, quotes
from plane.app.services.entity_schema import initialize_engine
from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityRelation,
    EntityRelationLink,
    EntityType,
    FieldDefinition,
    FileAsset,
    FormLayout,
    FormVersion,
    Issue,
    IssueComment,
    LookupCategory,
    LookupValue,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    PortalAccount,
    PortalAuditLog,
    PortalSession,
    RolePermission,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    User,
    UserOrganizationRole,
    WorkspaceMember,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

PORTAL = "/api/portal/v1/"
PASSWORD = "Customer-Pass!2026"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
PDF = b"%PDF-1.4\n" + b"0" * 128
STAFF = [
    "Issue.View",
    "Issue.ViewAll",
    "Issue.Create",
    "Issue.Edit",
    "Issue.Status.Edit",
    "Issue.Assign",
    "Routing.View",
    "Routing.Route",
    "Portal.Account.Manage",
    "Portal.Settings.Manage",
    "Portal.Request.Triage",
    "Portal.Reply",
    "Quote.Manage",
    "Portal.Feedback.View",
]


@pytest.fixture(autouse=True)
def clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def private_storage(monkeypatch, tmp_path):
    from django.core.files.storage import FileSystemStorage

    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))


def person(workspace, name, codes=STAFF):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    user.display_name = f"کارمند {name}"
    user.save(update_fields=["display_name"])
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{name}")
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


def staff_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def entity(workspace, code, title):
    row = EntityType.objects.create(workspace=workspace, code=code, title=title, numbering={"prefix": code[0].upper()})
    layout = {"tabs": [], "sections": [{"id": "main", "title": "اصلی", "columns": 1, "bindings": [{"field": "title"}]}]}
    form = FormLayout.objects.create(entity=row, draft=layout)
    form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
    form.save()
    return row


def relation(workspace, left, right, name):
    lf = FieldDefinition.objects.create(workspace=workspace, code=f"{name}_l", title=name, kind="relation")
    rf = FieldDefinition.objects.create(workspace=workspace, code=f"{name}_r", title=name, kind="relation")
    return EntityRelation.objects.create(
        left_entity=left, right_entity=right, left_field=lf, right_field=rf, kind="one_to_many"
    )


@pytest.fixture
def org(workspace, create_user):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    agent = person(workspace, "agent")
    plain = person(workspace, "plain", ["Issue.View", "Issue.ViewAll", "Issue.Edit"])
    customer = entity(workspace, "customer", "مشتری")
    contact = entity(workspace, "contact", "مخاطب")
    ticket = EntityType.objects.get(workspace=workspace, code="ticket", parent__isnull=True)
    ticket_rel = relation(workspace, customer, ticket, "cust_ticket")
    contact_rel = relation(workspace, customer, contact, "cust_contact")
    a = EntityRecord.objects.create(entity=customer, workspace=workspace, number="C-1", data={"title": "شرکت الف"})
    b = EntityRecord.objects.create(entity=customer, workspace=workspace, number="C-2", data={"title": "شرکت ب"})
    a_contact = EntityRecord.objects.create(
        entity=contact, workspace=workspace, number="K-1", data={"title": "خانم الف"}
    )
    EntityRelationLink.objects.create(relation=contact_rel, left_id=a.id, right_id=a_contact.id)
    return {
        "workspace": workspace,
        "agent": agent,
        "plain": plain,
        "customer_a": a,
        "customer_b": b,
        "contact_a": a_contact,
        "ticket_relation": ticket_rel,
    }


def make_account(org, username, customer, contact=None):
    client = staff_client(org["agent"])
    response = client.post(
        f"/api/workspaces/{org['workspace'].slug}/portal/accounts/",
        {
            "username": username,
            "display_name": f"مشتری {username}",
            "customer_record_id": str(customer.id),
            "contact_record_id": str(contact.id) if contact else None,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    token = response.data["setup"]["path"].split("token=")[1]
    setup = APIClient().post(f"{PORTAL}auth/setup/", {"token": token, "password": PASSWORD}, format="json")
    assert setup.status_code == 200, setup.data
    return PortalAccount.objects.get(username=username)


def login(username, password=PASSWORD):
    client = APIClient()
    response = client.post(f"{PORTAL}auth/login/", {"username": username, "password": password}, format="json")
    assert response.status_code == 200, response.data
    client.credentials(HTTP_X_PORTAL_CSRF=response.data["csrf_token"])
    return client


@pytest.fixture
def two(org):
    make_account(org, "alice", org["customer_a"], org["contact_a"])
    make_account(org, "bob", org["customer_b"])
    return {"alice": login("alice"), "bob": login("bob")}


def submit(client, subject="خرابی چاپگر", description="چاپگر طبقهٔ دوم کاغذ گیر می‌کند.", files=None):
    data = {"subject": subject, "description": description}
    if files:
        data["files"] = files
    return client.post(f"{PORTAL}requests/", data, format="multipart")


def upload(name, content):
    return SimpleUploadedFile(name, content, content_type="application/octet-stream")


def staff_url(org, issue_id, suffix=""):
    return f"/api/workspaces/{org['workspace'].slug}/tickets/{issue_id}/{suffix}"


# ---------------------------------------------------------------- 13. additive migration


def test_migration_is_additive_and_creates_no_parallel_tables():
    module = importlib.import_module("plane.db.migrations.0162_customer_portal")
    kinds = {type(op) for op in module.Migration.operations}
    assert kinds <= {migrations.CreateModel, migrations.AddField, migrations.AlterField, migrations.AddConstraint}
    created = {op.name for op in module.Migration.operations if isinstance(op, migrations.CreateModel)}
    assert created == {"PortalAccount", "PortalSession", "PortalAuditLog"}
    for op in module.Migration.operations:
        if isinstance(op, migrations.AlterField):
            assert op.field.null, op.name
        if isinstance(op, migrations.AddField) and op.model_name in {"issue", "issuecomment"}:
            assert op.field.null or op.field.has_default(), op.name
    tables = set(connection.introspection.table_names())
    portalish = {
        t
        for t in tables
        if any(w in t for w in ("portal", "quote", "invoice", "payment", "feedback", "ticket_message"))
    }
    assert portalish == {"crm_portal_accounts", "crm_portal_sessions", "crm_portal_audit_logs"}


# ---------------------------------------------------------------- 7.1 identity / 2. internal isolation


def test_portal_account_is_never_a_user_member_or_role(org):
    users, members, roles = User.objects.count(), WorkspaceMember.objects.count(), UserOrganizationRole.objects.count()
    account = make_account(org, "carol", org["customer_a"])
    assert (User.objects.count(), WorkspaceMember.objects.count(), UserOrganizationRole.objects.count()) == (
        users,
        members,
        roles,
    )
    assert account.password.startswith("pbkdf2_") or "$" in account.password
    events = EntityEvent.objects.filter(record_id=org["customer_a"].id, event_type__startswith="portal.account")
    assert {e.event_type for e in events} >= {"portal.account_created", "portal.account_link_issued"}
    assert "token" not in json.dumps([e.metadata for e in events])


def test_portal_session_is_refused_by_internal_endpoints_and_vice_versa(org, two):
    alice = two["alice"]
    created = submit(alice)
    assert created.status_code == 201, created.data
    slug = org["workspace"].slug
    for url in (
        staff_url(org, created.data["id"], "core/"),
        staff_url(org, created.data["id"], "portal/"),
        f"/api/workspaces/{slug}/portal/accounts/",
        "/api/users/me/",
        f"/api/workspaces/{slug}/engine/entities/ticket/records/",
    ):
        assert alice.get(url).status_code in (401, 403), url
    internal = APIClient()
    internal.force_login(org["agent"])  # a real internal session cookie, not a forced DRF user
    assert internal.get(f"/api/workspaces/{slug}/tickets/{created.data['id']}/core/").status_code == 200
    assert internal.get(f"{PORTAL}requests/").status_code == 401
    assert internal.get(f"{PORTAL}session/").status_code == 401


def test_contact_must_belong_to_the_customer(org):
    response = staff_client(org["agent"]).post(
        f"/api/workspaces/{org['workspace'].slug}/portal/accounts/",
        {
            "username": "mixed",
            "display_name": "x",
            "customer_record_id": str(org["customer_b"].id),
            "contact_record_id": str(org["contact_a"].id),
        },
        format="json",
    )
    assert response.status_code == 400
    denied = staff_client(org["plain"]).get(f"/api/workspaces/{org['workspace'].slug}/portal/accounts/")
    assert denied.status_code == 403


# ---------------------------------------------------------------- 3. submission


def test_submission_is_a_native_portal_ticket_routed_by_the_existing_service(org, two):
    category = LookupCategory.objects.create(workspace=org["workspace"], code="ticket-source", title="منبع")
    LookupValue.objects.create(category=category, code="portal", title="پورتال")
    FieldDefinition.objects.create(
        workspace=org["workspace"], code="support_source", title="منبع", kind="select", lookup=category
    )
    response = submit(two["alice"], files=[upload("photo.png", PNG)])
    assert response.status_code == 201, response.data
    issue = Issue.objects.get(id=response.data["id"])
    account = PortalAccount.objects.get(username="alice")
    assert issue.portal_account == account and issue.created_by_id is None and issue.portal_stage == "pending"
    record = EntityRecord.objects.get(source_id=issue.id)
    assert record.number and record.data["support_source"] == "portal"
    assert response.data["number"] == record.number
    assert EntityRelationLink.objects.filter(
        relation=org["ticket_relation"], left_id=org["customer_a"].id, right_id=issue.id
    ).exists()
    assert EntityEvent.objects.filter(record_id=issue.id, event_type="portal.request_submitted").exists()
    decision = TicketRoutingDecision.objects.get(issue=issue)
    assert decision.outcome == "queued"
    assert TicketRoleQueueEntry.objects.filter(issue=issue, status="open").exists()
    opening = IssueComment.objects.get(issue=issue)
    assert opening.access == "EXTERNAL" and opening.portal_account == account and opening.actor_id is None
    assert FileAsset.objects.filter(comment=opening, entity_type="CRM_PORTAL_ATTACHMENT").count() == 1
    assert response.data["status"]["title"] == "ثبت‌شده"


def test_submission_validates_subject_and_description(org, two):
    assert submit(two["alice"], subject="").status_code == 400
    assert submit(two["alice"], description="کوتاه").status_code == 400
    assert submit(two["alice"], subject="x" * 201).status_code == 400


# ---------------------------------------------------------------- 1. IDOR


def test_customer_b_gets_404_for_every_resource_of_customer_a(org, two):
    alice, bob = two["alice"], two["bob"]
    created = submit(alice, files=[upload("a.pdf", PDF)])
    issue_id = created.data["id"]
    file_id = created.data["messages"][0]["files"][0]["id"]
    staff = staff_client(org["agent"])
    assert (
        staff.post(
            staff_url(org, issue_id, "quotes/"),
            {"amount": 1000, "items": "قطعه", "valid_until": (timezone.localdate() + timedelta(days=5)).isoformat()},
            format="json",
        ).status_code
        == 201
    )
    quote_id = quotes.versions(Issue.objects.get(id=issue_id)).first().id
    staff.post(f"/api/workspaces/{org['workspace'].slug}/quotes/{quote_id}/send/")
    number = created.data["number"]
    probes = [
        ("get", f"{PORTAL}requests/{issue_id}/"),
        ("patch", f"{PORTAL}requests/{issue_id}/"),
        ("delete", f"{PORTAL}requests/{issue_id}/"),
        ("post", f"{PORTAL}requests/{issue_id}/"),
        ("post", f"{PORTAL}requests/{issue_id}/messages/"),
        ("get", f"{PORTAL}requests/{issue_id}/messages/"),
        ("post", f"{PORTAL}requests/{issue_id}/feedback/"),
        ("patch", f"{PORTAL}requests/{issue_id}/feedback/"),
        ("get", f"{PORTAL}files/{file_id}/"),
        ("delete", f"{PORTAL}files/{file_id}/"),
        ("post", f"{PORTAL}quotes/{quote_id}/decision/"),
        ("get", f"{PORTAL}requests/by-number/{number}/"),
    ]
    for method, url in probes:
        response = getattr(bob, method)(url, {"text": "سلام", "rating": 5, "decision": "approved"}, format="json")
        assert response.status_code == 404, (method, url, response.status_code)
        assert issue_id not in json.dumps(getattr(response, "data", None) or {}, default=str)
    # Injected customer ids are ignored: the scope comes from the session only.
    listing = bob.get(f"{PORTAL}requests/", {"customer_id": str(org["customer_a"].id)})
    assert listing.status_code == 200 and listing.data["count"] == 0
    own = submit(bob)
    forged = bob.post(
        f"{PORTAL}requests/",
        {
            "subject": "جعل",
            "description": "تلاش برای ثبت به نام دیگری",
            "customer_id": str(org["customer_a"].id),
            "customer_record_id": str(org["customer_a"].id),
            "portal_account": str(PortalAccount.objects.get(username="alice").id),
        },
        format="multipart",
    )
    assert forged.status_code == 201
    forged_issue = Issue.objects.get(id=forged.data["id"])
    assert forged_issue.portal_account.username == "bob"
    assert own.status_code == 201
    assert alice.get(f"{PORTAL}requests/").data["count"] == 1
    # Decision on a foreign quote changed nothing.
    assert not EntityEvent.objects.filter(record_id=quote_id, event_type="quote.decided").exists()


def test_two_accounts_of_the_same_customer_share_the_customer_scope(org, two):
    make_account(org, "alice2", org["customer_a"])
    created = submit(two["alice"])
    colleague = login("alice2")
    assert colleague.get(f"{PORTAL}requests/{created.data['id']}/").status_code == 200


# ---------------------------------------------------------------- 4. correspondence and internal notes


def test_internal_notes_and_their_files_never_reach_any_portal_response(org, two):
    alice = two["alice"]
    created = submit(alice)
    issue_id = created.data["id"]
    staff = staff_client(org["agent"])
    secret = "یادداشت-محرمانه-۴۲"
    note = staff.post(
        staff_url(org, issue_id, "portal/messages/"),
        {"text": secret, "files": [upload("internal-plan.pdf", PDF)]},
        format="multipart",
    )
    assert note.status_code == 201, note.data
    internal = IssueComment.objects.get(issue_id=issue_id, comment_stripped__contains=secret)
    assert internal.access == "INTERNAL"  # the composer's default
    internal_file = FileAsset.objects.get(comment=internal)
    reply = staff.post(
        staff_url(org, issue_id, "portal/messages/"), {"text": "پاسخ تیم", "access": "EXTERNAL"}, format="multipart"
    )
    assert reply.status_code == 201
    bodies = [
        alice.get(f"{PORTAL}requests/").content,
        alice.get(f"{PORTAL}requests/{issue_id}/").content,
        alice.get(f"{PORTAL}requests/by-number/{created.data['number']}/").content,
        alice.get(f"{PORTAL}session/").content,
        alice.get(f"{PORTAL}settings/").content,
    ]
    for raw in bodies:
        text = raw.decode("utf-8")
        assert secret not in text and str(internal.id) not in text
        assert "internal-plan" not in text and str(internal_file.id) not in text
        assert "INTERNAL" not in text and org["agent"].email not in text
    detail = alice.get(f"{PORTAL}requests/{issue_id}/").data
    assert [m["text"] for m in detail["messages"]] == ["چاپگر طبقهٔ دوم کاغذ گیر می‌کند.", "پاسخ تیم"]
    assert detail["messages"][1]["author"] == {"kind": "staff", "name": "تیم پشتیبانی"}
    assert alice.get(f"{PORTAL}files/{internal_file.id}/").status_code == 404
    # The team sees both, marked.
    summary = staff.get(staff_url(org, issue_id, "portal/")).data
    assert {m["access"] for m in summary["messages"]} == {"INTERNAL", "EXTERNAL"}
    # Customer reply notifies the team through the existing notifications.
    before = Notification.objects.filter(sender="crm:portal:customer_message").count()
    assert (
        alice.post(f"{PORTAL}requests/{issue_id}/messages/", {"text": "ممنون"}, format="multipart").status_code == 201
    )
    assert Notification.objects.filter(sender="crm:portal:customer_message").count() > before


def test_staff_name_mode_and_unread_badge(org, two):
    alice = two["alice"]
    issue_id = submit(alice).data["id"]
    portal_settings.save(org["workspace"], org["agent"], {"staff_name": "display_name"})
    staff_client(org["agent"]).post(
        staff_url(org, issue_id, "portal/messages/"), {"text": "سلام", "access": "EXTERNAL"}, format="multipart"
    )
    listing = alice.get(f"{PORTAL}requests/").data
    assert listing["unread"] == 1 and listing["results"][0]["unread"] is True
    detail = alice.get(f"{PORTAL}requests/{issue_id}/").data
    assert detail["messages"][-1]["author"]["name"] == "کارمند agent"
    assert alice.get(f"{PORTAL}requests/").data["unread"] == 0


def test_customer_text_is_stored_as_plain_text(org, two):
    response = submit(two["alice"], description="<script>alert(1)</script> لطفاً بررسی کنید")
    comment = IssueComment.objects.get(issue_id=response.data["id"])
    assert "<script>" not in comment.comment_html and "&lt;script&gt;" in comment.comment_html
    assert response.data["messages"][0]["text"].startswith("<script>")  # shown as text, never markup


def test_external_reply_only_on_portal_tickets_and_with_permission(org, two):
    issue = Issue(workspace=org["workspace"], name="داخلی")
    issue.save(created_by_id=org["agent"].id)
    staff = staff_client(org["agent"])
    assert (
        staff.post(
            staff_url(org, issue.id, "portal/messages/"), {"text": "x", "access": "EXTERNAL"}, format="multipart"
        ).status_code
        == 400
    )
    assert (
        staff.post(staff_url(org, issue.id, "portal/messages/"), {"text": "یادداشت"}, format="multipart").status_code
        == 201
    )
    portal_issue = submit(two["alice"]).data["id"]
    plain = staff_client(org["plain"])
    assert (
        plain.post(
            staff_url(org, portal_issue, "portal/messages/"), {"text": "x", "access": "EXTERNAL"}, format="multipart"
        ).status_code
        == 403
    )


# ---------------------------------------------------------------- 5. files


@pytest.mark.parametrize(
    "name, content",
    [
        ("tool.exe", b"MZ" + b"0" * 64),  # extension not allowed
        ("fake.pdf", PNG),  # PNG bytes named .pdf
        ("noextension", PDF),
        ("page.png", b"<html><script>x</script></html>"),  # text pretending to be an image
    ],
)
def test_bad_files_are_refused(org, two, name, content):
    response = submit(two["alice"], files=[upload(name, content)])
    assert response.status_code == 400, (name, response.data)
    assert not Issue.objects.filter(portal_account__username="alice").exists()


def test_path_names_never_survive(org, two):
    """Django's multipart parser already reduces "../evil.pdf" to its base name; the stored name
    has no path. The portal's own check refuses any name that still carries one (defence in depth)."""
    from plane.app.services import portal_files
    from rest_framework.exceptions import ValidationError

    for name in ("../evil.pdf", "..\\evil.pdf", "a/b.pdf", "x\x00.pdf", "..", ".pdf"):
        with pytest.raises(ValidationError):
            portal_files.safe_name(name)
    response = submit(two["alice"], files=[upload("../../evil.pdf", PDF)])
    assert response.status_code == 201, response.data
    stored = FileAsset.objects.get(issue_id=response.data["id"])
    assert stored.attributes["name"] == "evil.pdf" and ".." not in stored.asset.name


def test_size_count_and_docx_content(org, two):
    portal_settings.save(
        org["workspace"],
        org["agent"],
        {"files": {"max_count": 2, "max_size": 2048, "extensions": ["pdf", "docx", "png"]}},
    )
    assert submit(two["alice"], files=[upload("big.pdf", b"%PDF-" + b"0" * 4096)]).status_code == 400
    assert submit(two["alice"], files=[upload(f"{i}.pdf", PDF) for i in range(3)]).status_code == 400
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", "<w:document/>")
    ok = submit(two["alice"], files=[upload("نامه.docx", buffer.getvalue())])
    assert ok.status_code == 201, ok.data
    file_id = ok.data["messages"][0]["files"][0]["id"]
    download = two["alice"].get(f"{PORTAL}files/{file_id}/")
    assert download.status_code == 200 and download["X-Content-Type-Options"] == "nosniff"
    assert b"".join(download.streaming_content) == buffer.getvalue()
    assert two["bob"].get(f"{PORTAL}files/{file_id}/").status_code == 404


# ---------------------------------------------------------------- 6. customer-visible status


def test_status_comes_only_from_the_allowed_list(org, two):
    issue_id = submit(two["alice"]).data["id"]
    issue = Issue.objects.get(id=issue_id)
    LookupValue.objects.filter(
        category__workspace=org["workspace"], category__code="task-status", code="blocked"
    ).update(title="مسدود-داخلی-محرمانه")
    issue.portal_stage = "accepted"
    issue.status = "blocked"
    issue.save()
    config = {**portal_settings.DEFAULTS, "status_map": {"category:todo": "reviewing", "category:done": "done"}}
    portal_settings.save(org["workspace"], org["agent"], config)
    detail = two["alice"].get(f"{PORTAL}requests/{issue_id}/")
    assert detail.data["status"] == {"code": "reviewing", "title": "در حال بررسی"}
    assert "مسدود-داخلی-محرمانه" not in detail.content.decode() and "blocked" not in detail.content.decode()
    url = f"/api/workspaces/{org['workspace'].slug}/portal/settings/"
    bad = staff_client(org["agent"]).put(
        url, {**config, "status_map": {"category:todo": "secret_label"}}, format="json"
    )
    assert bad.status_code == 400
    assert staff_client(org["plain"]).put(url, config, format="json").status_code == 403
    assert EntityEvent.objects.filter(event_type="portal.settings_changed").count() == 1
    mapped = staff_client(org["agent"]).put(
        url, {**config, "status_map": {"status:blocked": "in_progress"}}, format="json"
    )
    assert mapped.status_code == 200, mapped.data
    assert two["alice"].get(f"{PORTAL}requests/{issue_id}/").data["status"]["code"] == "in_progress"


# ---------------------------------------------------------------- triage


def test_triage_approve_reject_and_need_info(org, two):
    alice = two["alice"]
    staff = staff_client(org["agent"])
    first = submit(alice).data["id"]
    assert (
        staff_client(org["plain"])
        .post(staff_url(org, first, "portal/triage/"), {"action": "approve"}, format="json")
        .status_code
        == 403
    )
    approved = staff.post(staff_url(org, first, "portal/triage/"), {"action": "approve"}, format="json")
    assert approved.status_code == 200, approved.data
    assert Issue.objects.get(id=first).portal_stage == "accepted"
    assert (
        staff.post(
            staff_url(org, first, "portal/triage/"), {"action": "reject", "message": "x"}, format="json"
        ).status_code
        == 400
    )

    second = submit(alice).data["id"]
    assert staff.post(staff_url(org, second, "portal/triage/"), {"action": "reject"}, format="json").status_code == 400
    staff.post(
        staff_url(org, second, "portal/triage/"), {"action": "reject", "message": "خارج از قرارداد"}, format="json"
    )
    detail = alice.get(f"{PORTAL}requests/{second}/").data
    assert detail["status"]["title"] == "ردشده" and detail["messages"][-1]["text"] == "خارج از قرارداد"
    assert detail["can_message"] is False and detail["can_feedback"] is False
    assert alice.post(f"{PORTAL}requests/{second}/messages/", {"text": "چرا؟"}, format="multipart").status_code == 400

    third = submit(alice).data["id"]
    staff.post(
        staff_url(org, third, "portal/triage/"), {"action": "need_info", "message": "شمارهٔ سریال؟"}, format="json"
    )
    assert alice.get(f"{PORTAL}requests/{third}/").data["status"]["title"] == "در انتظار پاسخ شما"
    assert alice.post(f"{PORTAL}requests/{third}/messages/", {"text": "SN-1234"}, format="multipart").status_code == 201
    assert Issue.objects.get(id=third).portal_stage == "pending"
    kinds = set(EntityEvent.objects.filter(record_id=third).values_list("event_type", flat=True))
    assert {"portal.info_requested", "portal.info_provided", "portal.customer_message"} <= kinds


def test_portal_preset_is_a_filter_on_the_existing_work_list(org, two):
    from plane.app.services import ticket_core

    submit(two["alice"])
    rows = Issue.objects.filter(workspace=org["workspace"])
    assert ticket_core.preset_filter(rows, "portal", org["agent"]).count() == 1
    assert ticket_core.preset_counts(rows, org["agent"])["portal"] == 1


# ---------------------------------------------------------------- 7. quotes


def _quote(org, issue_id, amount=5_000_000, items="تعویض قطعه"):
    staff = staff_client(org["agent"])
    response = staff.post(
        staff_url(org, issue_id, "quotes/"),
        {"amount": amount, "items": items, "valid_until": (timezone.localdate() + timedelta(days=10)).isoformat()},
        format="json",
    )
    assert response.status_code == 201, response.data
    row = quotes.versions(Issue.objects.get(id=issue_id)).first()
    return row


def test_quote_lifecycle_versions_and_single_decision(org, two):
    alice = two["alice"]
    issue_id = submit(alice).data["id"]
    tables = set(connection.introspection.table_names())
    assert (
        staff_client(org["plain"]).post(staff_url(org, issue_id, "quotes/"), {"amount": 1}, format="json").status_code
        == 403
    )
    draft = _quote(org, issue_id)
    assert alice.get(f"{PORTAL}requests/{issue_id}/").data["quotes"] == []  # drafts are internal
    assert (
        alice.post(f"{PORTAL}quotes/{draft.id}/decision/", {"decision": "approved"}, format="json").status_code == 404
    )
    slug = org["workspace"].slug
    staff = staff_client(org["agent"])
    assert (
        staff.patch(f"/api/workspaces/{slug}/quotes/{draft.id}/", {"amount": 6_000_000}, format="json").status_code
        == 200
    )
    assert staff.post(f"/api/workspaces/{slug}/quotes/{draft.id}/send/").status_code == 200
    assert staff.patch(f"/api/workspaces/{slug}/quotes/{draft.id}/", {"amount": 1}, format="json").status_code == 400
    shown = alice.get(f"{PORTAL}requests/{issue_id}/").data["quotes"]
    assert shown[0]["amount"] == "6000000" and shown[0]["can_decide"] is True
    assert (
        alice.post(
            f"{PORTAL}quotes/{draft.id}/decision/", {"decision": "revision_requested"}, format="json"
        ).status_code
        == 400
    )
    revision = alice.post(
        f"{PORTAL}quotes/{draft.id}/decision/",
        {"decision": "revision_requested", "comment": "مبلغ زیاد است"},
        format="json",
    )
    assert revision.status_code == 201, revision.data
    again = alice.post(f"{PORTAL}quotes/{draft.id}/decision/", {"decision": "approved"}, format="json")
    assert again.status_code == 409
    event = EntityEvent.objects.get(record_id=draft.id, event_type="quote.decided")
    account = PortalAccount.objects.get(username="alice")
    assert event.metadata["account_id"] == str(account.id) and event.metadata["comment"] == "مبلغ زیاد است"
    assert event.metadata["decided_at"]
    second = _quote(org, issue_id, amount=4_500_000)
    assert second.data["quote_version"] == 2 and second.data["quote_items"] == "تعویض قطعه"
    staff.post(f"/api/workspaces/{slug}/quotes/{second.id}/send/")
    assert (
        alice.post(f"{PORTAL}quotes/{second.id}/decision/", {"decision": "approved"}, format="json").status_code == 201
    )
    assert (
        staff.post(
            staff_url(org, issue_id, "quotes/"),
            {"amount": 1, "items": "x", "valid_until": timezone.localdate().isoformat()},
            format="json",
        ).status_code
        == 400
    )
    ticket_events = set(EntityEvent.objects.filter(record_id=issue_id).values_list("event_type", flat=True))
    assert {"quote.created", "quote.sent", "quote.revision_requested", "quote.approved"} <= ticket_events
    # Financial boundary: no new table, no receiver on the extension point.
    assert set(connection.introspection.table_names()) == tables
    assert quotes.quote_approved.receivers == []
    # The engine refuses direct writes on quote records (the version lock lives in the service).
    entity = EntityType.objects.get(workspace=org["workspace"], code="quote")
    engine = staff.post(f"/api/workspaces/{slug}/engine/entities/{entity.code}/records/", {"values": {}}, format="json")
    assert engine.status_code == 403


@pytest.mark.django_db(transaction=True)
def test_concurrent_decisions_record_only_one(workspace, create_user):
    initialize_engine(workspace)
    sync_permission_catalog(workspace)
    data = {"workspace": workspace, "agent": person(workspace, "agent2")}
    customer = entity(workspace, "customer", "مشتری")
    record = EntityRecord.objects.create(entity=customer, workspace=workspace, number="C-9", data={"title": "x"})
    account, _ = portal_access.create_account(
        workspace, data["agent"], {"username": "race", "display_name": "race", "customer_record_id": str(record.id)}
    )
    account.password = "x"
    account.save()
    issue = Issue(workspace=workspace, name="r", portal_account=account, portal_stage="accepted")
    issue.save()
    row = quotes.create(
        workspace,
        data["agent"],
        issue.id,
        {"amount": 10, "items": "x", "valid_until": (timezone.localdate() + timedelta(days=1)).isoformat()},
    )
    quotes.send(workspace, data["agent"], row.id)
    barrier, results = threading.Barrier(2), []

    def decide(choice):
        from django.db import connections

        barrier.wait()
        try:
            quotes.decide(PortalAccount.objects.get(id=account.id), row.id, {"decision": choice})
            results.append("ok")
        except Exception as exc:  # noqa: BLE001
            results.append(type(exc).__name__)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=decide, args=(c,)) for c in ("approved", "rejected")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["Conflict", "ok"], results
    assert EntityEvent.objects.filter(record_id=row.id, event_type="quote.decided").count() == 1


# ---------------------------------------------------------------- 8. feedback


def test_feedback_only_after_done_once_with_edit_window(org, two):
    alice = two["alice"]
    issue_id = submit(alice).data["id"]
    url = f"{PORTAL}requests/{issue_id}/feedback/"
    assert alice.post(url, {"rating": 5}, format="json").status_code == 400
    issue = Issue.objects.get(id=issue_id)
    issue.status = "done"
    issue.save()
    for bad in (0, 6, "5", True, None):
        assert alice.post(url, {"rating": bad}, format="json").status_code == 400, bad
    first = alice.post(url, {"rating": 4, "comment": "خوب"}, format="json")
    assert first.status_code == 201 and first.data["rating"] == 4
    edit = alice.patch(url, {"rating": 5}, format="json")
    assert edit.status_code == 201 and edit.data["rating"] == 5 and edit.data["edited"] is True
    assert EntityEvent.objects.filter(record_id=issue_id, event_type="portal.feedback").count() == 1
    assert EntityEvent.objects.filter(record_id=issue_id, event_type="portal.feedback_edited").count() == 1
    assert EntityRecord.objects.get(source_id=issue_id).data["portal_rating"] == 5
    # Reopening keeps the feedback; the team sees it in the ticket panel.
    issue.refresh_from_db()
    issue.status = "in_progress"
    issue.save()
    summary = staff_client(org["agent"]).get(staff_url(org, issue_id, "portal/")).data
    assert summary["feedback"]["rating"] == 5
    assert staff_client(org["plain"]).get(staff_url(org, issue_id, "portal/")).data["feedback"] is None
    issue.status = "done"
    issue.save()
    EntityEvent.objects.filter(record_id=issue_id, event_type="portal.feedback").update(
        created_at=timezone.now() - timedelta(hours=80)
    )
    assert alice.post(url, {"rating": 1}, format="json").status_code == 403


# ---------------------------------------------------------------- 9. contact resolution


def test_contact_resolution_with_and_without_informing_the_customer(org, two):
    alice = two["alice"]
    staff = staff_client(org["agent"])
    quiet = submit(alice).data["id"]
    body = {"channel": "phone", "contact_name": "خانم الف", "summary": "راهنمایی تلفنی", "resolved": True}
    assert staff.post(staff_url(org, quiet, "contact/"), body, format="json").status_code == 201
    detail = alice.get(f"{PORTAL}requests/{quiet}/").data
    assert len(detail["messages"]) == 1 and detail["status"]["code"] == "done"
    told = submit(alice).data["id"]
    response = staff.post(staff_url(org, told, "contact/"), {**body, "notify_customer": True}, format="json")
    assert response.status_code == 201 and response.data["contact"]["notified_customer"] is True
    messages = alice.get(f"{PORTAL}requests/{told}/").data["messages"]
    assert messages[-1]["kind"] == "contact" and "راهنمایی تلفنی" in messages[-1]["text"]
    plain_issue = submit(alice).data["id"]
    denied = staff_client(org["plain"]).post(
        staff_url(org, plain_issue, "contact/"), {**body, "notify_customer": True}, format="json"
    )
    assert denied.status_code == 403


# ---------------------------------------------------------------- 10. throttle, session, lockout, CSRF


@override_settings(PORTAL_THROTTLE_RATES={"portal_message": "2/minute"})
def test_message_throttle_answers_429_in_persian(org, two):
    issue_id = submit(two["alice"]).data["id"]
    url = f"{PORTAL}requests/{issue_id}/messages/"
    codes = [two["alice"].post(url, {"text": f"پیام {i}"}, format="multipart").status_code for i in range(3)]
    assert codes == [201, 201, 429]
    response = two["alice"].post(url, {"text": "x"}, format="multipart")
    assert response.data["code"] == "throttled" and "تعداد درخواست‌ها زیاد است" in response.data["error"]


@override_settings(PORTAL_THROTTLE_RATES={"portal_login_user": "3/minute"})
def test_login_throttle_by_username(org):
    make_account(org, "dave", org["customer_a"])
    codes = [
        APIClient().post(f"{PORTAL}auth/login/", {"username": "dave", "password": "wrong"}, format="json").status_code
        for _ in range(4)
    ]
    assert codes[-1] == 429


def test_lockout_after_failed_logins(org):
    make_account(org, "erin", org["customer_a"])
    for _ in range(5):
        assert (
            APIClient().post(f"{PORTAL}auth/login/", {"username": "erin", "password": "bad"}, format="json").status_code
            == 400
        )
    locked = APIClient().post(f"{PORTAL}auth/login/", {"username": "erin", "password": PASSWORD}, format="json")
    assert locked.status_code == 403 and "قفل" in locked.data["error"]
    assert EntityEvent.objects.filter(event_type="portal.account_locked").exists()
    unknown = APIClient().post(f"{PORTAL}auth/login/", {"username": "nobody", "password": "bad"}, format="json")
    assert unknown.status_code == 400 and unknown.data["error"] == portal_access.GENERIC_LOGIN_ERROR


def test_idle_absolute_logout_deactivation_and_password_change_end_sessions(org, two):
    alice = two["alice"]
    session = PortalSession.objects.filter(account__username="alice", revoked_at__isnull=True).get()
    PortalSession.objects.filter(id=session.id).update(last_seen_at=timezone.now() - timedelta(minutes=31))
    expired = alice.get(f"{PORTAL}requests/")
    assert expired.status_code == 401 and expired.data["code"] == "session_expired"

    fresh = login("alice")
    PortalSession.objects.filter(account__username="alice", revoked_at__isnull=True).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert fresh.get(f"{PORTAL}requests/").status_code == 401

    again = login("alice")
    assert again.post(f"{PORTAL}auth/logout/").status_code == 204
    assert again.get(f"{PORTAL}requests/").status_code == 401

    live = login("alice")
    account = PortalAccount.objects.get(username="alice")
    staff = staff_client(org["agent"])
    slug = org["workspace"].slug
    assert (
        staff.patch(
            f"/api/workspaces/{slug}/portal/accounts/{account.id}/", {"is_active": False}, format="json"
        ).status_code
        == 200
    )
    assert live.get(f"{PORTAL}requests/").status_code == 401
    assert (
        APIClient().post(f"{PORTAL}auth/login/", {"username": "alice", "password": PASSWORD}, format="json").status_code
        == 400
    )
    staff.patch(f"/api/workspaces/{slug}/portal/accounts/{account.id}/", {"is_active": True}, format="json")
    current = login("alice")
    link = staff.post(f"/api/workspaces/{slug}/portal/accounts/{account.id}/link/").data["setup"]["path"]
    assert (
        APIClient()
        .post(
            f"{PORTAL}auth/setup/", {"token": link.split("token=")[1], "password": "Another-Pass!2026"}, format="json"
        )
        .status_code
        == 200
    )
    assert current.get(f"{PORTAL}requests/").status_code == 401
    login("alice", "Another-Pass!2026")


def test_cookie_flags_and_csrf(org):
    make_account(org, "frank", org["customer_a"])
    client = APIClient()
    response = client.post(f"{PORTAL}auth/login/", {"username": "frank", "password": PASSWORD}, format="json")
    cookie = response.cookies["portal-session"]
    assert cookie["httponly"] and cookie["samesite"] == "Strict" and cookie["path"] == "/api/portal/"
    assert submit(client).status_code == 403  # no CSRF header
    client.credentials(HTTP_X_PORTAL_CSRF="forged")
    denied = submit(client)
    assert denied.status_code == 403 and denied.data["code"] == "csrf_failed"
    client.credentials(HTTP_X_PORTAL_CSRF=response.data["csrf_token"])
    assert submit(client).status_code == 201
    # A reload (or another tab) gets the same session-bound token; another session's token never works.
    assert client.get(f"{PORTAL}session/").data["csrf_token"] == response.data["csrf_token"]
    other = APIClient().post(f"{PORTAL}auth/login/", {"username": "frank", "password": PASSWORD}, format="json")
    client.credentials(HTTP_X_PORTAL_CSRF=other.data["csrf_token"])
    assert submit(client).status_code == 403


# ---------------------------------------------------------------- 11. audit


def test_every_portal_call_is_audited_without_secrets(org, two):
    before = PortalAuditLog.objects.count()
    alice = two["alice"]
    created = submit(alice, files=[upload("a.pdf", PDF)])
    alice.get(f"{PORTAL}requests/{created.data['id']}/")
    two["bob"].get(f"{PORTAL}requests/{created.data['id']}/")
    APIClient().post(f"{PORTAL}auth/login/", {"username": "alice", "password": "wrong-secret-xyz"}, format="json")
    rows = list(PortalAuditLog.objects.order_by("id")[before:])
    assert [(r.endpoint, r.method, r.status_code) for r in rows] == [
        ("requests", "POST", 201),
        ("request", "GET", 200),
        ("request", "GET", 404),
        ("auth.login", "POST", 400),
    ]
    assert rows[1].object_id == created.data["id"] and rows[2].outcome == "not_found"
    assert rows[3].username == "alice" and rows[3].account is None
    dump = json.dumps([{k: str(v) for k, v in r.__dict__.items()} for r in PortalAuditLog.objects.all()])
    assert "wrong-secret-xyz" not in dump and PASSWORD not in dump and "%PDF" not in dump
    with pytest.raises(ValueError):
        rows[0].save()
    with pytest.raises(ValueError):
        rows[0].delete()


# ---------------------------------------------------------------- 12. external notifications are off


def test_no_external_delivery_with_default_settings(org, two):
    with patch.object(portal_notify.DisabledAdapter, "send", return_value=True) as send:
        issue_id = submit(two["alice"]).data["id"]
        staff = staff_client(org["agent"])
        staff.post(
            staff_url(org, issue_id, "portal/messages/"), {"text": "پاسخ", "access": "EXTERNAL"}, format="multipart"
        )
        staff.post(staff_url(org, issue_id, "portal/triage/"), {"action": "need_info", "message": "؟"}, format="json")
        row = _quote(org, issue_id)
        staff.post(f"/api/workspaces/{org['workspace'].slug}/quotes/{row.id}/send/")
        assert send.call_count == 0
        account = PortalAccount.objects.get(username="alice")
        account.notify_email = True
        account.save()
        portal_settings.save(org["workspace"], org["agent"], {"notify_channels": {"email": True, "sms": False}})
        staff.post(
            staff_url(org, issue_id, "portal/messages/"), {"text": "پاسخ ۲", "access": "EXTERNAL"}, format="multipart"
        )
        assert send.call_count == 0  # server setting PORTAL_NOTIFY_CHANNELS is still empty
        with override_settings(PORTAL_NOTIFY_CHANNELS=("email",)):
            staff.post(
                staff_url(org, issue_id, "portal/messages/"),
                {"text": "پاسخ ۳", "access": "EXTERNAL"},
                format="multipart",
            )
            assert send.call_count == 1
            two["alice"].patch(f"{PORTAL}settings/", {"email": False}, format="json")
            staff.post(
                staff_url(org, issue_id, "portal/messages/"),
                {"text": "پاسخ ۴", "access": "EXTERNAL"},
                format="multipart",
            )
            assert send.call_count == 1
    assert portal_notify.DisabledAdapter("email").send(None, "s", "b") is False
