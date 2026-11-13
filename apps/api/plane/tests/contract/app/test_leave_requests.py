"""Ticket 6: leave requests (daily/hourly), Word form, signature image and workflow approval.

Each acceptance criterion of the ticket has at least one test here (see the
section headers). The approval route always runs on the ticket-4 workflow engine.
"""

import struct
import zlib
from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from rest_framework.test import APIClient

from plane.app.services import leave_documents as documents
from plane.app.services import leave_requests as leave
from plane.app.services import workflow_engine as engine
from plane.app.services.permission_registry import sync_permission_catalog
from plane.db.models import (
    EntityEvent,
    EntityType,
    FieldDefinition,
    FileAsset,
    FormLayout,
    LeaveRequest,
    LeaveRequestVersion,
    LeaveTemplateVersion,
    Notification,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    RolePermission,
    SignatureImage,
    User,
    UserAbsence,
    UserOrganizationRole,
    WorkflowDecision,
    WorkflowInstance,
    WorkflowStepRun,
    WorkSchedule,
    WorkScheduleDay,
    WorkScheduleException,
    WorkspaceMember,
)
from plane.db.models.asset import PRIVATE_CRM_ASSET_TYPES

pytestmark = [pytest.mark.django_db, pytest.mark.contract]

TEHRAN = ZoneInfo("Asia/Tehran")
MEMBER = ["Workflow.View", "LeaveRequest.Create"]
# 2027-01-09 is a Saturday; 2027-01-15 is a Friday (the built-in weekly day off).
SAT, SUN, MON, THU, FRI = "2027-01-09", "2027-01-10", "2027-01-11", "2027-01-14", "2027-01-15"
NOW = datetime(2027, 1, 1, 9, tzinfo=TEHRAN)


def person(workspace, name, codes=MEMBER):
    user = User.objects.create_user(email=f"{name}@example.test", username=name, password="SafePassword!2026")
    user.display_name = f"کاربر {name}"
    user.save(update_fields=["display_name"])
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    role = OrganizationRole.objects.create(workspace=workspace, name=f"role-{name}")
    for permission in OrganizationPermission.objects.filter(workspace=workspace, code__in=codes):
        RolePermission.objects.create(role=role, permission=permission)
    UserOrganizationRole.objects.create(workspace=workspace, user=user, role=role)
    return user


def grant(user, *codes):
    role = OrganizationRole.objects.get(name=f"role-{user.username}")
    for permission in OrganizationPermission.objects.filter(workspace=role.workspace, code__in=codes):
        RolePermission.objects.get_or_create(role=role, permission=permission)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def png(color=b"\x00\xff\x00"):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00" + color))
        + chunk(b"IEND", b"")
    )


@pytest.fixture(autouse=True)
def private_storage(monkeypatch, tmp_path):
    from django.core.files.storage import FileSystemStorage

    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))


@pytest.fixture
def org(workspace, create_user):
    """employee, colleague ∈ team (manager) ⊂ department (upper); hr holds the HR role."""
    sync_permission_catalog(workspace)
    leave.ensure_leave_entity(workspace)
    people = {name: person(workspace, name) for name in ("upper", "manager", "employee", "colleague", "hr", "other")}
    department = OrganizationUnit.objects.create(workspace=workspace, title="معاونت", manager=people["upper"])
    team = OrganizationUnit.objects.create(
        workspace=workspace, title="تیم پشتیبانی", manager=people["manager"], parent=department
    )
    for name in ("employee", "colleague"):
        OrganizationUnitMember.objects.create(unit=team, user=people[name])
    return {"workspace": workspace, "admin": create_user, "team": team, **people}


def base(workspace, suffix=""):
    return f"/api/workspaces/{workspace.slug}/leave/{suffix}"


def daily(start=SAT, end=None, **extra):
    return {"mode": "daily", "start_date": start, "end_date": end or start, "reason": "کار شخصی", **extra}


def hourly(day=SAT, start="10:00", end="12:00", **extra):
    return {
        "mode": "hourly",
        "start_date": day,
        "end_date": day,
        "start_time": start,
        "end_time": end,
        "reason": "مراجعه به پزشک",
        **extra,
    }


def create(user, workspace, body):
    return client_for(user).post(base(workspace, "requests/"), body, format="json")


def upload_template(admin, workspace, content=None, name="form.docx", **data):
    file = SimpleUploadedFile(name, content if content is not None else documents.build_sample_template())
    return client_for(admin).post(base(workspace, "templates/"), {"file": file, **data}, format="multipart")


def active_template(org):
    response = upload_template(org["admin"], org["workspace"])
    assert response.status_code == 201, response.data
    activated = client_for(org["admin"]).post(base(org["workspace"], f"templates/{response.data['id']}/activate/"))
    assert activated.status_code == 200, activated.data
    return LeaveTemplateVersion.objects.get(id=response.data["id"])


def give_signature(org, user, consent=True, image=None):
    file = SimpleUploadedFile("sig.png", image or png())
    response = client_for(org["admin"]).post(
        base(org["workspace"], f"signatures/{user.id}/"), {"file": file}, format="multipart"
    )
    assert response.status_code == 201, response.data
    if consent:
        granted = client_for(user).post(
            base(org["workspace"], "signatures/me/consent/"),
            {"grant": True, "confirm": True, "signature_id": response.data["id"]},
            format="json",
        )
        assert granted.status_code == 200, granted.data
    return SignatureImage.objects.get(id=response.data["id"])


def publish_route(org, graph=None):
    """The admin defines the route on the workflow engine (default: requester → direct manager)."""
    admin, workspace = org["admin"], org["workspace"]
    wf = f"/api/workspaces/{workspace.slug}/workflows/"
    created = client_for(admin).post(
        f"{wf}definitions/", {"entity": "leave_request", "title": "تأیید مرخصی"}, format="json"
    )
    assert created.status_code == 201, created.data
    version_id = created.data["versions"][0]["id"]
    if graph is not None:
        saved = client_for(admin).put(f"{wf}versions/{version_id}/", {"graph": graph}, format="json")
        assert saved.status_code == 200, saved.data
    published = client_for(admin).post(f"{wf}versions/{version_id}/publish/", {}, format="json")
    assert published.status_code == 200, published.data


def ready(org, user=None):
    active_template(org)
    give_signature(org, user or org["employee"])
    publish_route(org)


def detail(user, workspace, row):
    return client_for(user).get(base(workspace, f"requests/{row['id'] if isinstance(row, dict) else row.id}/"))


def sign(user, workspace, row_id, **extra):
    client = client_for(user)
    current = client.get(base(workspace, f"requests/{row_id}/")).data
    shown = client.get(base(workspace, f"requests/{row_id}/preview/"))
    assert shown.status_code == 200, shown.data
    body = {"confirm": True, "fingerprint": shown.data["fingerprint"], "revision": current["revision"], **extra}
    return client.post(base(workspace, f"requests/{row_id}/sign/"), body, format="json")


def wf_act(user, workspace, row_id, transition, **body):
    instance = WorkflowInstance.objects.filter(record_id=row_id).order_by("-created_at").first()
    body.update({"transition": transition, "revision": instance.revision})
    return client_for(user).post(
        f"/api/workspaces/{workspace.slug}/workflows/runs/{instance.id}/transition/", body, format="json"
    )


def submitted(org, body=None, user=None):
    user = user or org["employee"]
    created = create(user, org["workspace"], body or daily(SAT, SUN))
    assert created.status_code == 201, created.data
    signed = sign(user, org["workspace"], created.data["id"])
    assert signed.status_code == 200, signed.data
    return signed.data


# ------------------------------------------------------------------ 1. daily/hourly only, no category


def test_only_daily_or_hourly_and_no_leave_category_anywhere(org):
    workspace, employee = org["workspace"], org["employee"]
    meta = client_for(employee).get(base(workspace, "meta/")).data
    assert [row["code"] for row in meta["modes"]] == ["daily", "hourly"]
    bad = create(employee, workspace, {**daily(), "mode": "annual"})
    assert bad.status_code == 400 and "mode" in bad.data
    created = create(employee, workspace, {**daily(), "leave_type": "sick", "category": "sick"})
    assert created.status_code == 201
    text = str(created.data) + str(meta)
    assert "leave_type" not in text and "category" not in text and "نوع مرخصی" not in text
    assert not any("leave" in key or "type" in key for key in documents.PLACEHOLDERS)
    # The generic leave (absence) form no longer binds or seeds a leave category.
    layout = FormLayout.objects.select_related("published").get(entity__workspace=workspace, entity__code="leave")
    assert "leave_type" not in str(layout.published.schema) and "leave_type" not in str(layout.draft)
    assert not FieldDefinition.objects.filter(workspace=workspace, code="leave_type", is_active=True).exists()
    # A template that asks for a category is rejected as an unknown placeholder.
    report = documents.validate_template(documents.build_sample_template(list(documents.PLACEHOLDERS) + ["leave_type"]))
    assert [issue["code"] for issue in report["issues"]] == ["unknown"]


def test_data_migration_unbinds_old_leave_category_without_losing_history():
    from importlib import import_module

    strip = import_module("plane.db.migrations.0161_leave_requests_data").strip_leave_type
    layout = {
        "sections": [{"id": "main", "bindings": [{"field": "reason"}, {"field": "leave_type"}]}],
        "tabs": [{"sections": [{"bindings": [{"field": "leave_type"}]}]}],
    }
    cleaned, changed = strip(layout)
    assert changed and "leave_type" not in str(cleaned) and "leave_type" in str(layout)
    assert strip({"sections": []}) == ({"sections": []}, False)


# ------------------------------------------------------------------ 2. duration on the work calendar


def test_daily_duration_skips_weekly_day_off_and_holidays(org):
    workspace, employee = org["workspace"], org["employee"]
    WorkScheduleException.objects.create(
        workspace=workspace, user=employee, date_from=MON, date_to=MON, is_working=False, reason="تعطیل رسمی"
    )
    created = create(employee, workspace, daily(THU, "2027-01-17"))  # Thu, Fri(off), Sat, Sun
    assert created.status_code == 201, created.data
    assert created.data["current"]["duration_days"] == 3
    over_holiday = create(employee, workspace, daily("2027-01-11"))  # the holiday only
    assert over_holiday.status_code == 400 and "end_date" in over_holiday.data
    friday_only = client_for(employee).post(base(workspace, "duration/"), daily(FRI), format="json")
    assert friday_only.status_code == 400
    preview = client_for(employee).post(base(workspace, "duration/"), daily(SAT, MON), format="json")
    assert preview.status_code == 200 and preview.data["duration_days"] == 2  # Mon is the holiday


def test_hourly_duration_counts_only_shift_hours_without_breaks(org):
    workspace, employee = org["workspace"], org["employee"]
    version = WorkSchedule.objects.create(
        workspace=workspace, scope="person", user=employee, effective_from="2026-01-01", reason="شیفت عصر"
    )
    for weekday in range(7):
        WorkScheduleDay.objects.create(
            schedule=version,
            weekday=weekday,
            is_working=weekday != 4,
            start_time=time(10),
            end_time=time(18),
            breaks=[{"start": "13:00", "end": "14:00"}],
        )
    created = create(employee, workspace, hourly(SAT, "08:00", "15:00"))
    assert created.status_code == 201, created.data
    # 10:00–13:00 and 14:00–15:00 are inside the shift: 4 hours.
    assert created.data["current"]["duration_minutes"] == 240
    assert created.data["current"]["duration_text"] == "۴ ساعت کاری"
    outside = create(employee, workspace, hourly(SUN, "07:00", "09:30"))
    assert outside.status_code == 400 and "end_time" in outside.data
    backwards = create(employee, workspace, hourly(SUN, "12:00", "11:00"))
    assert backwards.status_code == 400
    reversed_days = create(employee, workspace, daily(SUN, SAT))
    assert reversed_days.status_code == 400 and "end_date" in reversed_days.data


# ------------------------------------------------------------------ 3. overlap


def test_overlapping_active_request_is_rejected_but_rejected_or_cancelled_is_not(org):
    workspace, employee, colleague = org["workspace"], org["employee"], org["colleague"]
    first = create(employee, workspace, daily(SAT, MON))
    assert first.status_code == 201
    overlap = create(employee, workspace, hourly(SUN, "09:00", "10:00"))
    assert overlap.status_code == 400 and first.data["number"] in str(overlap.data)
    assert create(colleague, workspace, daily(SAT)).status_code == 201  # other person: no overlap
    row = LeaveRequest.objects.get(id=first.data["id"])
    cancelled = client_for(employee).post(
        base(workspace, f"requests/{row.id}/cancel/"), {"revision": row.revision}, format="json"
    )
    assert cancelled.status_code == 200 and cancelled.data["status"] == "cancelled"
    assert create(employee, workspace, hourly(SUN, "09:00", "10:00")).status_code == 201
    LeaveRequest.objects.filter(requester=employee, status="draft").update(status="rejected")
    assert create(employee, workspace, daily(SUN)).status_code == 201


# ------------------------------------------------------------------ 4/5. templates and document data


def test_template_validation_blocks_incomplete_invalid_corrupt_expired_and_deprecated(org):
    admin, workspace = org["admin"], org["workspace"]
    assert upload_template(org["employee"], workspace).status_code == 403
    corrupt = upload_template(admin, workspace, b"not a word file")
    assert corrupt.status_code == 400 and "خراب" in str(corrupt.data)
    wrong = upload_template(admin, workspace, documents.build_sample_template(), name="form.pdf")
    assert wrong.status_code == 400
    incomplete = upload_template(admin, workspace, documents.build_sample_template(["employee_name", "start"]))
    assert incomplete.status_code == 201 and incomplete.data["can_activate"] is False
    assert any("الزامی" in warning for warning in incomplete.data["warnings"])
    invalid = upload_template(admin, workspace, documents.build_sample_template(None, "{{ نام }} {{ unknown_key }}"))
    assert {issue["code"] for issue in invalid.data["issues"]} == {"invalid", "unknown"}
    for row in (incomplete, invalid):
        refused = client_for(admin).post(base(workspace, f"templates/{row.data['id']}/activate/"))
        assert refused.status_code == 400
    expired = upload_template(admin, workspace, expires_at="2020-01-01")
    assert expired.data["is_expired"] and not expired.data["can_activate"]
    assert client_for(admin).post(base(workspace, f"templates/{expired.data['id']}/activate/")).status_code == 400
    good = active_template(org)
    numbers = list(LeaveTemplateVersion.objects.filter(workspace=workspace).values_list("number", flat=True))
    assert sorted(numbers) == [1, 2, 3, 4]  # every upload is a version; nothing deleted
    # The active version later expires: admins get a warning and documents cannot be built.
    good.expires_at = datetime(2020, 1, 1).date()
    good.save()
    overview = client_for(admin).get(base(workspace, "templates/")).data
    assert "منقضی" in overview["active_problem"] or "پایان رسیده" in overview["active_problem"]
    created = create(org["employee"], workspace, daily())
    shown = client_for(org["employee"]).get(base(workspace, f"requests/{created.data['id']}/preview/"))
    assert shown.status_code == 400 and "template" in shown.data
    deprecated = client_for(admin).patch(
        base(workspace, f"templates/{good.id}/"), {"deprecate": True, "expires_at": None}, format="json"
    )
    assert deprecated.data["status"] == "deprecated"
    assert client_for(admin).post(base(workspace, f"templates/{good.id}/activate/")).status_code == 400
    assert EntityEvent.objects.filter(event_type="leave.template.uploaded").count() == 4


def test_document_data_comes_from_account_and_request_and_file_is_not_editable(org):
    workspace, employee, colleague = org["workspace"], org["employee"], org["colleague"]
    ready(org)
    created = create(employee, workspace, {**daily(SAT, SUN), "substitute": str(colleague.id)})
    preview = client_for(employee).get(base(workspace, f"requests/{created.data['id']}/preview/"))
    html = preview.data["html"]
    assert "کاربر employee" in html and "تیم پشتیبانی" in html and created.data["number"] in html
    assert "روزانه" in html and "۲ روز کاری" in html and "کاربر colleague" in html
    assert documents.SIGNATURE_PREVIEW_TEXT in html  # no signature before the explicit action
    # Identity fields cannot be overridden from the request, and there is no way to upload a document.
    row = LeaveRequest.objects.get(id=created.data["id"])
    patched = client_for(employee).patch(
        base(workspace, f"requests/{row.id}/"),
        {**daily(SAT, SUN), "employee_name": "جعل", "document": "x", "revision": row.revision},
        format="json",
    )
    assert patched.status_code == 200
    assert "جعل" not in client_for(employee).get(base(workspace, f"requests/{row.id}/preview/")).data["html"]
    upload = client_for(employee).post(
        base(workspace, f"requests/{row.id}/document/"),
        {"file": SimpleUploadedFile("x.docx", b"x")},
        format="multipart",
    )
    assert upload.status_code in {400, 404, 405}
    assert not FileAsset.objects.filter(entity_type="CRM_LEAVE_DOCUMENT").exists()


# ------------------------------------------------------------------ 6/7. preview, explicit signing, consent


def test_sign_requires_explicit_action_consent_and_owner(org):
    workspace, employee, colleague = org["workspace"], org["employee"], org["colleague"]
    active_template(org)
    publish_route(org)
    created = create(employee, workspace, daily())
    row_id = created.data["id"]
    view = detail(employee, workspace, created.data).data
    assert view["actions"]["can_sign"] is False and "بارگذاری نشده" in view["actions"]["sign_blockers"][0]
    image = give_signature(org, employee, consent=False)
    view = detail(employee, workspace, created.data).data
    assert "اجازه" in view["actions"]["sign_blockers"][0]
    assert sign(employee, workspace, row_id).status_code == 400
    # Saving the form never places a signature.
    assert not LeaveRequestVersion.objects.filter(request_id=row_id, signed_at__isnull=False).exists()
    client_for(employee).post(
        base(workspace, "signatures/me/consent/"),
        {"grant": True, "confirm": True, "signature_id": str(image.id)},
        format="json",
    )
    assert sign(employee, workspace, row_id, confirm=False).status_code == 400
    assert sign(employee, workspace, row_id, fingerprint="stale").status_code == 400
    grant(colleague, "LeaveRequest.ViewAll")
    forged = client_for(colleague).post(
        base(workspace, f"requests/{row_id}/sign/"), {"confirm": True, "fingerprint": "x", "revision": 1}, format="json"
    )
    assert forged.status_code == 403
    assert not LeaveRequestVersion.objects.filter(request_id=row_id, is_locked=True).exists()


def test_preview_sign_builds_final_word_file_with_signature_and_records_who_when_what(org):
    workspace, employee = org["workspace"], org["employee"]
    ready(org)
    template = LeaveTemplateVersion.objects.get(status="active")
    data = submitted(org)
    version = LeaveRequestVersion.objects.get(request_id=data["id"])
    assert version.is_locked and version.signed_by_id == employee.id and version.template_version_id == template.id
    assert data["current"]["template"]["number"] == template.number
    assert data["status"] == "pending" and data["holder"]["people"][0]["id"] == str(org["manager"].id)
    download = client_for(employee).get(base(workspace, f"requests/{data['id']}/versions/{version.id}/document/"))
    assert download.status_code == 200
    content = b"".join(download.streaming_content)
    html = documents.to_html(content)
    assert "data:image/png" in html and documents.SIGNATURE_PREVIEW_TEXT not in html
    assert FileAsset.objects.get(id=version.document_id).entity_type in PRIVATE_CRM_ASSET_TYPES
    event = EntityEvent.objects.get(event_type="leave.signed", record_id=data["id"])
    assert event.created_by_id == employee.id
    assert event.metadata["version_id"] == str(version.id) and event.metadata["template_id"] == str(template.id)
    assert event.metadata["signature_id"] == str(version.signature_id) and event.metadata["signed_at"]
    # The signed preview is the stored document; the locked version cannot be edited in place.
    assert client_for(employee).get(base(workspace, f"requests/{data['id']}/preview/")).data["signed"] is True


def test_revoked_consent_blocks_new_requests_but_keeps_signed_documents(org):
    workspace, employee = org["workspace"], org["employee"]
    ready(org)
    first = submitted(org)
    signed = LeaveRequestVersion.objects.get(request_id=first["id"])
    digest = signed.document_sha256
    revoked = client_for(employee).post(base(workspace, "signatures/me/consent/"), {"grant": False}, format="json")
    assert revoked.status_code == 200 and revoked.data["signature"]["has_consent"] is False
    second = create(employee, workspace, daily(THU))
    assert sign(employee, workspace, second.data["id"]).status_code == 400
    signed.refresh_from_db()
    assert signed.document_sha256 == digest and signed.signature_id
    # A replaced image needs a new consent even after consent was given to the old one.
    client_for(employee).post(
        base(workspace, "signatures/me/consent/"),
        {"grant": True, "confirm": True, "signature_id": str(signed.signature_id)},
        format="json",
    )
    give_signature(org, employee, consent=False, image=png(b"\xff\x00\x00"))
    old_consent = client_for(employee).post(
        base(workspace, "signatures/me/consent/"),
        {"grant": True, "confirm": True, "signature_id": str(signed.signature_id)},
        format="json",
    )
    assert old_consent.status_code == 400
    assert detail(employee, workspace, second.data).data["actions"]["can_sign"] is False


# ------------------------------------------------------------------ 8. signature privacy and audit


def test_signature_image_is_private_and_every_access_is_recorded(org):
    workspace, admin, employee, colleague, hr = (
        org["workspace"],
        org["admin"],
        org["employee"],
        org["colleague"],
        org["hr"],
    )
    assert (
        client_for(colleague)
        .post(
            base(workspace, f"signatures/{employee.id}/"),
            {"file": SimpleUploadedFile("s.png", png())},
            format="multipart",
        )
        .status_code
        == 403
    )
    for name, content in (("s.gif", png()), ("s.png", b"GIF89a....")):
        refused = client_for(admin).post(
            base(workspace, f"signatures/{employee.id}/"),
            {"file": SimpleUploadedFile(name, content)},
            format="multipart",
        )
        assert refused.status_code == 400
    too_big = client_for(admin).post(
        base(workspace, f"signatures/{employee.id}/"),
        {"file": SimpleUploadedFile("s.png", png() + b"0" * (1024 * 1024))},
        format="multipart",
    )
    assert too_big.status_code == 400
    first = give_signature(org, employee, consent=True)
    second = give_signature(org, employee, consent=False, image=png(b"\x00\x00\xff"))
    first.refresh_from_db()
    assert not first.is_current and second.is_current and not second.has_consent
    image_url = base(workspace, f"signatures/{employee.id}/image/")
    assert client_for(colleague).get(image_url).status_code == 403
    assert client_for(hr).get(image_url).status_code == 403
    grant(hr, "Signature.Manage")
    assert client_for(hr).get(image_url).status_code == 200
    mine = client_for(employee).get(image_url)
    assert mine.status_code == 200 and mine.content.startswith(b"\x89PNG") and "no-store" in mine["Cache-Control"]
    assert FileAsset.objects.get(id=second.file_id).entity_type in PRIVATE_CRM_ASSET_TYPES
    client_for(employee).post(base(workspace, "signatures/me/consent/"), {"grant": False}, format="json")
    kinds = [
        row["type"]
        for row in client_for(employee).get(base(workspace, f"signatures/{employee.id}/history/")).data["results"]
    ]
    for kind in ("signature.uploaded", "signature.replaced", "signature.viewed", "signature.consent_granted"):
        assert kind in kinds
    assert client_for(colleague).get(base(workspace, f"signatures/{employee.id}/history/")).status_code == 403
    assert client_for(colleague).get(base(workspace, "signatures/")).status_code == 403
    # Revoking without a granted consent is refused; the history keeps the earlier grant.
    assert (
        client_for(employee)
        .post(base(workspace, "signatures/me/consent/"), {"grant": False}, format="json")
        .status_code
        == 400
    )
    viewed = EntityEvent.objects.filter(event_type="signature.viewed", metadata__subject_user=str(employee.id))
    assert set(viewed.values_list("created_by_id", flat=True)) == {hr.id, employee.id}


# ------------------------------------------------------------------ 9. versions after "return for correction"


def test_return_keeps_the_signed_version_and_a_new_version_needs_a_new_signature(org):
    workspace, employee, manager = org["workspace"], org["employee"], org["manager"]
    ready(org)
    data = submitted(org)
    assert wf_act(manager, workspace, data["id"], "return").status_code == 400  # reason required
    assert wf_act(manager, workspace, data["id"], "return", reason="تاریخ را اصلاح کنید").status_code == 200
    view = detail(employee, workspace, data).data
    assert view["status"] == "returned" and view["actions"]["can_new_version"] and not view["actions"]["can_edit"]
    locked = client_for(employee).patch(
        base(workspace, f"requests/{data['id']}/"), {**daily(MON), "revision": view["revision"]}, format="json"
    )
    assert locked.status_code == 400
    fresh = client_for(employee).post(
        base(workspace, f"requests/{data['id']}/new-version/"), {"revision": view["revision"]}, format="json"
    )
    assert fresh.status_code == 200 and fresh.data["current"]["number"] == 2
    edited = client_for(employee).patch(
        base(workspace, f"requests/{data['id']}/"), {**daily(MON), "revision": fresh.data["revision"]}, format="json"
    )
    assert edited.status_code == 200
    assert edited.data["actions"]["can_sign"] is True
    resigned = sign(employee, workspace, data["id"])
    assert resigned.status_code == 200 and resigned.data["status"] == "pending"
    versions = list(LeaveRequestVersion.objects.filter(request_id=data["id"]).order_by("number"))
    assert [v.number for v in versions] == [1, 2] and all(v.is_locked and v.document_id for v in versions)
    assert versions[0].start_date.isoformat() == SAT and versions[1].start_date.isoformat() == MON
    for version in versions:
        got = client_for(manager).get(base(workspace, f"requests/{data['id']}/versions/{version.id}/document/"))
        assert got.status_code == 200
    assert EntityEvent.objects.filter(event_type="leave.signed", record_id=data["id"]).count() == 2


# ------------------------------------------------------------------ 10. end to end with the workflow engine


def test_end_to_end_route_decisions_and_absence(org):
    workspace, employee, manager, colleague, hr, upper = (
        org["workspace"],
        org["employee"],
        org["manager"],
        org["colleague"],
        org["hr"],
        org["upper"],
    )
    hr_role = OrganizationRole.objects.create(workspace=workspace, name="منابع انسانی")
    UserOrganizationRole.objects.create(workspace=workspace, user=hr, role=hr_role)
    active_template(org)
    give_signature(org, employee)
    # The admin decides the route: direct manager → HR (role), with reject and return.
    route = leave.LeaveRequestSource().default_graph(None)
    route["steps"].insert(
        2,
        {
            "code": "hr",
            "title": "تأیید منابع انسانی",
            "type": "approval",
            "status_code": "pending",
            "assignee": {"type": "role", "role_id": str(hr_role.id)},
        },
    )
    route["transitions"] = [
        t if t["code"] != "approve" else {**t, "to": "hr", "label": "تأیید و ارسال به منابع انسانی"}
        for t in route["transitions"]
    ] + [
        {"code": "hr_approve", "from": "hr", "to": "approved", "kind": "approve", "label": "تأیید نهایی"},
        {"code": "hr_reject", "from": "hr", "to": "rejected", "kind": "reject", "label": "رد"},
    ]
    publish_route(org, route)

    data = submitted(org, {**daily(SAT, SUN), "substitute": str(colleague.id)})
    # The generic workflow panel cannot bypass "sign and submit".
    instance = WorkflowInstance.objects.get(record_id=data["id"])
    assert instance.definition.entity.adapter == "leave_request"
    # Visibility is enforced on the queryset: the colleague sees nothing, the manager sees it.
    assert client_for(colleague).get(base(workspace, "requests/")).data["results"] == []
    assert detail(colleague, workspace, data).status_code == 403
    assert detail(org["other"], workspace, data).status_code == 403
    assert [
        row["id"] for row in client_for(manager).get(base(workspace, "requests/?scope=waiting")).data["results"]
    ] == [data["id"]]
    assert detail(upper, workspace, data).status_code == 200  # upper manager of the requester
    assert Notification.objects.filter(receiver=manager, workspace=workspace).exists()
    assert wf_act(colleague, workspace, data["id"], "approve").status_code == 403
    assert wf_act(manager, workspace, data["id"], "approve").status_code == 200
    view = detail(employee, workspace, data).data
    assert view["status"] == "pending" and view["holder"]["step"] == "تأیید منابع انسانی"
    assert [p["id"] for p in view["holder"]["people"]] == [str(hr.id)]
    assert detail(hr, workspace, data).status_code == 200
    assert not UserAbsence.objects.filter(user=employee).exists()
    assert wf_act(hr, workspace, data["id"], "hr_approve").status_code == 200
    row = LeaveRequest.objects.get(id=data["id"])
    assert row.status == "approved" and row.absence.status == "scheduled"
    assert row.absence.substitute_id == colleague.id
    assert row.absence.starts_at == datetime(2027, 1, 9, tzinfo=TEHRAN)
    assert row.absence.ends_at == datetime(2027, 1, 11, tzinfo=TEHRAN)
    assert Notification.objects.filter(receiver=employee, title__contains="تأیید شد").exists()
    # Idempotent: replaying the approval status does not create a second absence.
    with transaction.atomic():
        source = engine.record_source(leave.leave_entity(workspace))
        source.apply_status(leave.leave_entity(workspace), hr, row.id, "approved", {})
        leave.ensure_absence(row, hr)
    assert UserAbsence.objects.filter(user=employee).count() == 1
    # Cancelling after approval (before the leave starts) cancels the absence too.
    cancel = client_for(employee).post(
        base(workspace, f"requests/{row.id}/cancel/"),
        {"revision": row.revision, "reason": "برنامه تغییر کرد"},
        format="json",
    )
    assert cancel.status_code == 200 and cancel.data["status"] == "cancelled"
    row.refresh_from_db()
    assert row.absence.status == "cancelled"
    assert WorkflowDecision.objects.filter(instance__record_id=row.id, kind="cancel").exists()
    assert UserAbsence.objects.filter(user=employee).count() == 1


def test_rejection_needs_reason_and_records_no_absence(org):
    workspace, employee, manager = org["workspace"], org["employee"], org["manager"]
    ready(org)
    data = submitted(org)
    assert wf_act(manager, workspace, data["id"], "reject").status_code == 400
    assert wf_act(manager, workspace, data["id"], "reject", reason="هم‌زمان با تحویل پروژه").status_code == 200
    row = LeaveRequest.objects.get(id=data["id"])
    assert row.status == "rejected" and row.absence_id is None
    assert Notification.objects.filter(receiver=employee, message_stripped__contains="هم‌زمان با تحویل پروژه").exists()
    # A rejected request is not active: the same period can be requested again.
    assert create(employee, workspace, daily(SAT, SUN)).status_code == 201
    assert not detail(employee, workspace, data).data["actions"]["can_cancel"]


def test_requester_cancels_pending_request_through_the_workflow(org):
    workspace, employee, manager = org["workspace"], org["employee"], org["manager"]
    ready(org)
    data = submitted(org)
    assert (
        client_for(manager)
        .post(base(workspace, f"requests/{data['id']}/cancel/"), {"revision": data["revision"]}, format="json")
        .status_code
        == 403
    )
    done = client_for(employee).post(
        base(workspace, f"requests/{data['id']}/cancel/"), {"revision": data["revision"]}, format="json"
    )
    assert done.status_code == 200 and done.data["status"] == "cancelled"
    instance = WorkflowInstance.objects.get(record_id=data["id"])
    assert instance.status == "cancelled"
    assert not WorkflowStepRun.objects.filter(instance=instance, status="active").exists()
    assert wf_act(manager, workspace, data["id"], "approve").status_code == 400
    assert not UserAbsence.objects.filter(user=employee).exists()


def test_generic_workflow_actions_cannot_submit_without_signature(org):
    workspace, employee, manager = org["workspace"], org["employee"], org["manager"]
    ready(org)
    data = submitted(org)
    wf_act(manager, workspace, data["id"], "return", reason="اصلاح")
    blocked = wf_act(employee, workspace, data["id"], "submit")
    assert blocked.status_code == 400 and "امضا" in str(blocked.data)
    panel = (
        client_for(employee).get(f"/api/workspaces/{workspace.slug}/workflows/records/leave_request/{data['id']}/").data
    )
    assert panel["can_start"] is False
    assert [t["code"] for t in panel["instance"]["actions"]["transitions"]] == []
    assert (
        client_for(org["colleague"])
        .get(f"/api/workspaces/{workspace.slug}/workflows/records/leave_request/{data['id']}/")
        .status_code
        == 403
    )
    # The generic engine pages do not expose leave requests as ordinary records.
    assert (
        client_for(org["admin"])
        .get(f"/api/workspaces/{workspace.slug}/engine/entities/leave_request/records/")
        .status_code
        == 404
    )


def test_attachments_use_private_files_and_only_owner_files(org):
    workspace, employee, colleague, manager = org["workspace"], org["employee"], org["colleague"], org["manager"]
    up = client_for(employee).post(
        base(workspace, "attachments/"), {"file": SimpleUploadedFile("note.pdf", b"%PDF-1.4")}, format="multipart"
    )
    assert up.status_code == 201
    bad = client_for(employee).post(
        base(workspace, "attachments/"), {"file": SimpleUploadedFile("x.exe", b"MZ")}, format="multipart"
    )
    assert bad.status_code == 400
    others = client_for(colleague).post(
        base(workspace, "attachments/"), {"file": SimpleUploadedFile("c.pdf", b"%PDF")}, format="multipart"
    )
    stolen = create(employee, workspace, {**daily(), "attachments": [others.data["id"]]})
    assert stolen.status_code == 400
    created = create(employee, workspace, {**daily(), "attachments": [up.data["id"]]})
    assert created.status_code == 201 and created.data["current"]["attachments"][0]["name"] == "note.pdf"
    url = base(workspace, f"requests/{created.data['id']}/files/{up.data['id']}/")
    assert client_for(manager).get(url).status_code == 200
    assert client_for(colleague).get(url).status_code == 403
    assert FileAsset.objects.get(id=up.data["id"]).entity_type in PRIVATE_CRM_ASSET_TYPES


def test_sign_without_published_route_is_blocked(org):
    workspace, employee = org["workspace"], org["employee"]
    active_template(org)
    give_signature(org, employee)
    created = create(employee, workspace, daily())
    view = detail(employee, workspace, created.data).data
    assert any("مسیر تأیید" in text for text in view["actions"]["sign_blockers"])
    assert sign(employee, workspace, created.data["id"]).status_code == 400
    assert not LeaveRequestVersion.objects.filter(is_locked=True).exists()
    assert EntityType.objects.filter(workspace=workspace, code="leave_request", adapter="leave_request").exists()


# ------------------------------------------------------------------ deployment safety


def test_missing_docx_library_does_not_break_the_api(org, monkeypatch):
    """An image built before python-docx was added must still serve the whole API (regression)."""
    import os
    import subprocess
    import sys

    # A fresh interpreter where ``import docx`` fails still loads every URL (the outage was an
    # ImportError at URL-config import time that took the whole server down).
    script = (
        "import sys; sys.modules['docx'] = None\n"
        "import django; django.setup()\n"
        "import plane.urls\n"
        "from plane.app.services import leave_documents as d\n"
        "assert d.DOCX_AVAILABLE is False\n"
        "print('ok')\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, env=os.environ.copy(), timeout=240
    )
    assert done.returncode == 0 and "ok" in done.stdout, done.stderr[-2000:]

    # In the running process, Word features answer 503 with a clear message; everything else works.
    workspace, employee = org["workspace"], org["employee"]
    monkeypatch.setattr(documents, "DOCX_AVAILABLE", False)
    upload = upload_template(org["admin"], workspace, content=b"PK\x03\x04")
    assert upload.status_code == 503 and "python-docx" in str(upload.data)
    created = create(employee, workspace, daily())
    assert created.status_code == 201
    assert client_for(employee).get(base(workspace, "meta/")).status_code == 200
    assert detail(employee, workspace, created.data).status_code == 200
