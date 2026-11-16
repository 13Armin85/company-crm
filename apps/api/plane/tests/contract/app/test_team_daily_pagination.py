"""Team daily reports paginate after scoped status filtering, before loading item details."""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from plane.db.models import DailyReport, DailyReportItem, OrganizationUnitMember, User, WorkspaceMember
from plane.tests.contract.app.test_ticket_eight import (
    D,
    NOW,
    at,
    client_for,
    frozen,
    item,
    leave_row,
    org,
    private_storage,
    put_day,
    url,
    ws,
)

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def team_page(org, **params):
    with frozen(NOW):
        return client_for(org["manager"]).get(url(org, "daily-reports/team/"), {"date": D.isoformat(), **params})


def test_team_pages_are_bounded_stable_scoped_and_only_load_current_page_items(org):
    users = User.objects.bulk_create(
        [User(email=f"paging-{i}@example.test", username=f"paging-{i}", display_name="همکار") for i in range(25)]
    )
    WorkspaceMember.objects.bulk_create([WorkspaceMember(workspace=ws(org), member=u, role=15) for u in users])
    OrganizationUnitMember.objects.bulk_create([OrganizationUnitMember(unit=org["team"], user=u) for u in users])
    reports = DailyReport.objects.bulk_create([DailyReport(workspace=ws(org), user=u, work_date=D) for u in users])
    DailyReportItem.objects.bulk_create(
        [DailyReportItem(report=r, kind="blocker", text=f"مانع {r.id}", needs_help=True) for r in reports]
    )
    DailyReportItem.objects.create(report=reports[0], kind="done", text="حذف‌شده", deleted_at=timezone.now())
    leave_row(org, org["onleave"], D)
    put_day(org, org["employee"], at(D, 9), submit=True, items=[item()])
    put_day(org, org["colleague"], at(D, 10), submit=True, items=[item()])
    DailyReport.objects.filter(user=org["colleague"]).update(is_late=True)

    # The default is bounded even if a caller forgets the page parameter.
    default = team_page(org)
    assert default.status_code == 200, default.data
    assert (default.data["count"], default.data["page_size"], default.data["pages"]) == (31, 25, 2)
    assert len(default.data["people"]) == 25
    expected_summary = {"submitted": 1, "late": 1, "draft": 25, "missing": 3, "not_required": 1, "off": 0, "future": 0}
    seen, all_people = set(), []
    for page in range(1, 5):
        with CaptureQueriesContext(connection) as queries:
            response = team_page(org, page=page, page_size=10)
        data = response.data
        assert response.status_code == 200, data
        assert (data["page"], data["page_size"], data["pages"], data["count"]) == (page, 10, 4, 31)
        assert data["summary"] == expected_summary
        assert len(data["people"]) == (10 if page < 4 else 1)
        ids = {row["person"]["id"] for row in data["people"]}
        assert not (ids & seen)
        seen |= ids
        all_people.extend(data["people"])
        item_queries = [q["sql"] for q in queries if 'FROM "crm_daily_report_items"' in q["sql"]]
        page_report_ids = {str(r.id) for r in reports if str(r.user_id) in ids}
        if page_report_ids:
            assert len(item_queries) == 1
            # Drivers can render UUID literals with or without hyphens.
            item_sql = item_queries[0].replace("-", "")
            assert all(report_id.replace("-", "") in item_sql for report_id in page_report_ids)
            assert not any(r.id.hex in item_sql for r in reports if str(r.user_id) not in ids)
        for row in data["people"]:
            if row["status"] == "draft":
                assert len(row["help"]) == 1 and row["blockers"] == []
                assert row["counts"]["blocker"] == 1 and row["counts"]["done"] == 0
    assert str(org["outsider"].id) not in seen and str(org["manager"].id) not in seen
    assert [row["status"] for row in all_people] == ["missing"] * 3 + ["draft"] * 25 + [
        "late",
        "submitted",
        "not_required",
    ]
    assert [row["person"]["id"] for row in all_people if row["status"] == "draft"] == sorted(str(u.id) for u in users)
    assert team_page(org, page=2, page_size=10).data["people"] == all_people[10:20]
    filtered = team_page(org, page=3, page_size=10, filter="missing").data
    assert filtered["count"] == 28 and len(filtered["people"]) == 8
    assert filtered["summary"] == expected_summary
    assert all(row["status"] in ("missing", "draft") for row in filtered["people"])


def test_status_groups_and_empty_filtered_results_keep_whole_team_summary(org):
    put_day(org, org["employee"], at(D, 9), submit=True, items=[item()])
    put_day(org, org["colleague"], at(D, 10), submit=True, items=[item()])
    DailyReport.objects.filter(user=org["colleague"]).update(is_late=True)
    put_day(org, org["holiday"], at(D, 9), items=[item()])
    leave_row(org, org["onleave"], D)
    for group, expected in {
        "all": ["missing", "missing", "draft", "late", "submitted", "not_required"],
        "missing": ["missing", "missing", "draft"],
        "late": ["late"],
        "submitted": ["late", "submitted"],
        "not_required": ["not_required"],
    }.items():
        response = team_page(org, page=1, page_size=10, filter=group)
        assert response.status_code == 200, response.data
        assert [row["status"] for row in response.data["people"]] == expected
        assert response.data["count"] == len(expected)
        assert sum(response.data["summary"].values()) == 6
    DailyReport.objects.filter(workspace=ws(org), is_late=True).update(is_late=False)
    empty = team_page(org, page=99, filter="late").data
    assert (empty["count"], empty["page"], empty["pages"], empty["people"], empty["empty"]) == (0, 1, 1, [], None)
    assert sum(empty["summary"].values()) == 6
    invalid = team_page(org, filter="not-a-status")
    assert invalid.status_code == 400 and "filter" in invalid.data


def test_bad_page_parameters_and_permission_checks(org):
    for params, expected_page, expected_size in [
        ({"page": "abc", "page_size": "abc"}, 1, 25),
        ({"page": -9, "page_size": -1}, 1, 25),
        ({"page": 999, "page_size": 1000000}, 1, 25),
        ({"page": 1, "page_size": 100}, 1, 100),
    ]:
        response = team_page(org, **params)
        assert response.status_code == 200, response.data
        assert (response.data["page"], response.data["page_size"], response.data["count"]) == (
            expected_page,
            expected_size,
            6,
        )
    with frozen(NOW):
        forbidden = client_for(org["employee"]).get(url(org, "daily-reports/team/"), {"page": 1})
        no_team = client_for(org["other_manager"]).get(
            url(org, "daily-reports/team/"), {"date": D.isoformat(), "filter": "submitted", "page": 9}
        )
    assert forbidden.status_code == 403
    assert no_team.data["count"] == 0 and no_team.data["empty"] is None  # Has a team, but no matching status.
