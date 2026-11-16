"""Cross-module report reads: absence lifecycle, deduplication, directories and portal queues."""

import csv
import io
from datetime import timedelta

import pytest
from django.db import transaction

from plane.app.services import daily_reports, leave_requests, report_sources
from plane.db.models import (
    EntityRecord,
    EntityType,
    FieldDefinition,
    FormLayout,
    FormVersion,
    EntityViewExport,
    Issue,
    IssueAssignee,
    LeaveRequestVersion,
    PortalAccount,
    Project,
    ProjectMember,
    UserAbsence,
)
from plane.tests.contract.app.test_ticket_eight import (
    org,
    private_storage,
    D,
    NOW,
    WIDE,
    at,
    client_for,
    export,
    frozen,
    grant,
    leave_row,
    run,
    ticket,
    url,
    ws,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def absence(org, user=None, start=None, end=None, **kwargs):
    return UserAbsence.objects.create(
        workspace=ws(org),
        user=user or org["employee"],
        starts_at=start or at(D, 8),
        ends_at=end or at(D, 16),
        reason="عدم حضور ثبت‌شده",
        **kwargs,
    )


def cells(result, key):
    index = next(i for i, c in enumerate(result["columns"]) if c["key"] == key)
    return [row["cells"][index] for row in result["rows"]]


def test_absence_api_flows_into_leave_report_daily_report_team_and_schedule(org):
    manager, worker = org["manager"], org["employee"]
    grant(manager, "Absence.View", "Absence.Create", "Absence.End")
    with frozen(NOW):
        created = client_for(manager).post(
            url(org, "organization/absences/"),
            {
                "user": str(worker.id),
                "starts_at": at(D, 8).isoformat(),
                "ends_at": at(D, 16).isoformat(),
                "reason": "مراجعهٔ اداری",
            },
            format="json",
        )
    assert created.status_code == 201, created.data
    result = run(org, manager, "leave", WIDE)
    assert result["total"] == 1 and cells(result, "origin") == ["عدم حضور مستقیم"]
    assert result["rows"][0]["link"] == f"/edit/leave/{created.data['id']}"
    day = daily_reports.day_payload(ws(org), worker, worker, D, now=NOW)
    assert day["requirement"] == "not_required" and len(day["absences"]) == 1 and day["leaves"] == []
    statuses = daily_reports.day_statuses(ws(org), [worker.id], D, D, NOW)
    assert statuses[0]["status"] == "not_required"
    for source in ("daily_reports", "team_schedule"):
        linked = run(org, manager, source, {**WIDE, "columns": ["person", "absence"], "filters": []})
        assert any(value for value in cells(linked, "absence")), source
    with frozen(NOW):
        ended = client_for(manager).delete(url(org, f"organization/absences/{created.data['id']}/"))
    assert ended.status_code == 204
    assert daily_reports.day_payload(ws(org), worker, worker, D, now=NOW)["requirement"] == "required"
    assert cells(run(org, manager, "leave", WIDE), "status") == ["پایان‌یافته"]


def test_linked_leave_absence_is_reported_once_and_cancellation_is_live(org):
    grant(org["manager"], "Absence.View")
    row = leave_row(org, org["employee"], D)
    with transaction.atomic():
        linked, _ = leave_requests.ensure_absence(row, org["manager"])
    result = run(org, org["manager"], "leave", {**WIDE, "columns": ["number", "origin", "absence_status"]})
    assert result["total"] == 1 and cells(result, "origin") == ["درخواست مرخصی"]
    assert cells(result, "absence_status") == ["ثبت‌شده"]
    UserAbsence.objects.filter(id=linked.id).update(status="cancelled")
    day = daily_reports.day_payload(ws(org), org["employee"], org["employee"], D, now=NOW)
    assert day["requirement"] == "required" and not day["leaves"] and not day["absences"]
    assert cells(run(org, org["manager"], "leave", {**WIDE, "columns": ["absence_status"]}), "absence_status") == [
        "لغوشده"
    ]


def test_partial_absence_and_hourly_leave_cover_the_day_together(org):
    absence(org, end=at(D, 10))
    leave_row(org, org["employee"], D, mode="hourly", hours=(10, 16))
    day = daily_reports.day_payload(ws(org), org["employee"], org["employee"], D, now=NOW)
    assert day["requirement"] == "not_required" and len(day["absences"]) == len(day["leaves"]) == 1
    assert not day["absences"][0]["full_day"] and not day["leaves"][0]["full_day"]


def test_ending_a_linked_absence_clips_the_approved_leave_context(org):
    row = leave_row(org, org["employee"], D, D + timedelta(days=2))
    with transaction.atomic():
        linked, _ = leave_requests.ensure_absence(row, org["manager"])
    UserAbsence.objects.filter(id=linked.id).update(status="ended", updated_at=at(D, 9))
    day = daily_reports.day_payload(ws(org), org["employee"], org["employee"], D, now=NOW)
    assert day["requirement"] == "required" and len(day["leaves"]) == 1
    assert day["leaves"][0]["duration_text"] == "طبق بازهٔ به‌روزشدهٔ عدم حضور"
    later = daily_reports.day_payload(
        ws(org), org["employee"], org["employee"], D + timedelta(days=1), now=at(D + timedelta(days=2), 12)
    )
    assert later["requirement"] == "required" and later["leaves"] == []


@pytest.mark.parametrize("status", ["pending", "cancelled"])
def test_unapproved_or_cancelled_absence_never_exempts_a_daily_report(org, status):
    absence(org, status=status)
    day = daily_reports.day_payload(ws(org), org["employee"], org["employee"], D, now=NOW)
    assert day["requirement"] == "required" and day["absences"] == []


def test_ended_absence_exempts_only_its_effective_historical_interval(org):
    row = absence(org, end=at(D + timedelta(days=3), 16), status="ended")
    UserAbsence.objects.filter(id=row.id).update(updated_at=at(D + timedelta(days=1), 0))
    statuses = daily_reports.day_statuses(
        ws(org), [org["employee"].id], D, D + timedelta(days=1), at(D + timedelta(days=2), 12)
    )
    assert [row["status"] for row in statuses] == ["not_required", "missing"]


def test_absence_report_respects_both_report_scope_and_source_permission(org):
    absence(org)
    absence(org, user=org["outsider"])
    assert run(org, org["manager"], "leave", WIDE)["total"] == 0
    grant(org["manager"], "Absence.View")
    assert run(org, org["manager"], "leave", WIDE)["total"] == 1
    grant(org["manager"], "Report.ViewAll")
    # Report.ViewAll cannot bypass absence organization visibility.
    assert run(org, org["manager"], "leave", WIDE)["total"] == 1
    grant(org["manager"], "Absence.ManageAll")
    assert run(org, org["manager"], "leave", WIDE)["total"] == 2


def test_only_current_request_version_affects_range_and_row_limit(org):
    for offset in range(2):
        row = leave_row(org, org["employee"], D)
        moved = D + timedelta(days=60 + offset)
        LeaveRequestVersion.objects.create(
            request=row,
            number=2,
            mode="daily",
            start_date=moved,
            end_date=moved,
            starts_at=at(moved, 0),
            ends_at=at(moved + timedelta(days=1), 0),
            duration_days=1,
        )
    current = leave_row(org, org["employee"], D)
    definition = report_sources.validate(report_sources.LEAVE, WIDE)
    _, rows = report_sources.compute(ws(org), org["manager"], report_sources.LEAVE, definition, now=NOW, limit=1)
    assert [r["number"] for r in rows] == [current.number]


def test_generic_business_records_are_reported_without_needing_a_ticket(org):
    entity = EntityType.objects.create(
        workspace=ws(org),
        code="report-directory",
        title="دادهٔ سفارشی",
        record_permissions={"view": "Issue.View", "view_all": "Issue.ViewAll"},
        title_field="report_directory_title",
    )
    field = FieldDefinition.objects.create(
        workspace=ws(org), code=entity.title_field, title="عنوان داده", kind="short_text"
    )
    layout = {"tabs": [], "sections": [{"id": "main", "columns": 1, "bindings": [{"field": field.code}]}]}
    form = FormLayout.objects.create(entity=entity, draft=layout)
    form.published = FormVersion.objects.create(layout=form, number=1, schema=layout)
    form.save()
    own = EntityRecord(
        workspace=ws(org),
        entity=entity,
        number="CUSTOM-1",
        data={entity.title_field: "مشتری بدون تیکت"},
    )
    own.save(created_by_id=org["employee"].id)
    other = EntityRecord(workspace=ws(org), entity=entity, number="CUSTOM-2", data={entity.title_field: "خارج از تیم"})
    other.save(created_by_id=org["outsider"].id)
    result = run(org, org["manager"], "records", {})
    assert cells(result, "title") == ["مشتری بدون تیکت"]
    assert result["rows"][0]["link"] == f"/entities/{entity.code}/{own.id}"
    grant(org["manager"], "Report.ViewAll")
    assert run(org, org["manager"], "records", {})["total"] == 2
    for config in ({"secret": True}, {"hidden": True}):
        field.config = config
        field.save(update_fields=["config"])
        result = run(org, org["manager"], "records", {})
        assert cells(result, "title") == ["رکورد", "رکورد"]


def test_project_report_includes_empty_projects_and_only_visible_task_counts(org):
    manager = org["manager"]
    grant(manager, "Project.View")
    project = Project.objects.create(
        workspace=ws(org), name="پروژهٔ بدون کار", identifier="RCONN", project_lead=org["employee"]
    )
    ProjectMember.objects.create(workspace=ws(org), project=project, member=manager, role=15)
    hidden = Project.objects.create(workspace=ws(org), name="پروژهٔ خصوصی", identifier="RHIDE")
    result = run(org, manager, "projects", {})
    assert result["total"] == 1 and cells(result, "tasks") == [0]
    ticket(org, org["employee"], project=project)
    ticket(org, org["employee"], project=hidden)
    result = run(org, manager, "projects", {})
    assert cells(result, "tasks") == [1] and cells(result, "open") == [1]


def test_unassigned_portal_queue_is_visible_to_authorized_global_reports_only(org):
    manager = org["manager"]
    grant(manager, "Portal.Reply", "Report.ViewAll")
    entity = EntityType.objects.create(workspace=ws(org), code="customer", title="مشتری")
    customer = EntityRecord.objects.create(
        workspace=ws(org), entity=entity, number="RCUST", data={entity.title_field: "مشتری درگاه"}
    )
    account = PortalAccount.objects.create(
        workspace=ws(org), customer_record=customer, username="report-customer", display_name="نماینده مشتری"
    )
    issue = Issue(workspace=ws(org), name="درخواست تازهٔ مشتری", portal_account=account, portal_stage="pending")
    issue.save(disable_auto_set_user=True)
    result = run(org, manager, "portal_requests", {})
    assert result["total"] == 1 and result["rows"][0]["link"] == f"/portal-settings/requests/{issue.id}"
    assert run(org, manager, "my_work", {"filters": []})["total"] == 1
    grant(org["other_manager"], "Portal.Reply")
    assert run(org, org["other_manager"], "portal_requests", {})["total"] == 0
    IssueAssignee.objects.create(workspace=ws(org), issue=issue, assignee=org["employee"])
    assert run(org, manager, "portal_requests", {})["total"] == 1


def test_catalog_connects_sources_to_authorized_pages_and_designer(org):
    grant(org["manager"], "Absence.View", "LeaveRequest.Create")
    catalog = {source["code"]: source for source in report_sources.catalog(org["manager"], ws(org))}
    assert {"records", "projects", "portal_requests"}.issubset(catalog)
    assert {link["path"] for link in catalog["leave"]["connections"]} == {"/absences", "/leave-requests"}
    employee = {source["code"]: source for source in report_sources.catalog(org["employee"], ws(org))}
    assert "/absences" not in {link["path"] for link in employee["leave"]["connections"]}
    response = client_for(org["admin"]).get(url(org, "engine/surfaces/"))
    assert response.status_code == 200
    codes = {row["code"] for row in response.data["results"]}
    assert {"report-records", "report-projects", "report-portal_requests"}.issubset(codes)


def test_saved_report_and_csv_export_read_the_same_live_connected_absences(org):
    manager = org["manager"]
    grant(manager, "Absence.View")
    absence(org)
    definition = {**WIDE, "columns": ["number", "person", "origin", "status"]}
    with frozen(NOW):
        saved = client_for(manager).post(
            url(org, "reports/saved/"),
            {"name": "عدم حضور یکپارچه", "source": "leave", "definition": definition},
            format="json",
        )
    assert saved.status_code == 201, saved.data
    absence(org, user=org["colleague"])
    with frozen(NOW):
        page = client_for(manager).post(url(org, f"reports/saved/{saved.data['id']}/run/"), {}, format="json")
        response = export(org, manager, {"source": "leave", "definition": definition, "format": "csv"})
        assert response.status_code == 202, response.data
        job = EntityViewExport.objects.get(id=response.data["id"])
        assert job.status == "ready" and job.row_count == page.data["total"] == 2
        download = client_for(manager).get(url(org, f"reports/exports/{job.id}/download/"))
    exported = list(csv.reader(io.StringIO(b"".join(download.streaming_content).decode("utf-8-sig"))))
    assert exported[1:] == [[str(v) for v in row["cells"]] for row in page.data["rows"]]
