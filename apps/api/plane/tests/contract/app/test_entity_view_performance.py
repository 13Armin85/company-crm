"""Reproducible 10,000-row acceptance exercise, isolated from development data."""

import json
import os
import platform
from pathlib import Path
from time import perf_counter
from types import SimpleNamespace

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.core.files.storage import FileSystemStorage
from django.core.management import call_command

from plane.db.models import EntityRecord, EntityViewExport, FileAsset
from plane.app.services.entity_query import EntityQuery
from plane.app.services.entity_view_export import build_entity_export
from plane.tests.contract.app.test_entity_engine import make_entity, endpoint
from plane.tests.contract.app.test_entity_views import spec, engine_fixture  # noqa: F401

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def benchmark_data(engine):
    workspace, owner, client = engine
    company, _ = make_entity(
        engine, [{"code": "region", "kind": "short_text", "title": "منطقه"}], code="benchmark_company"
    )
    companies = [
        EntityRecord(
            workspace=workspace,
            entity=company,
            number=f"C-{i}",
            data={"title": f"شرکت شماره {i}", "region": ["تهران", "اصفهان", "فارس"][i % 3]},
            created_by=owner,
        )
        for i in range(100)
    ]
    EntityRecord.objects.bulk_create(companies)
    entity, _ = make_entity(
        engine,
        [
            {"code": "amount", "kind": "money", "title": "مبلغ"},
            {"code": "due", "kind": "date", "title": "سررسید"},
            {"code": "urgent", "kind": "boolean", "title": "فوری"},
            {"code": "company", "kind": "relation", "title": "شرکت", "relation_entity": company},
        ],
        code="benchmark_case",
    )
    EntityRecord.objects.bulk_create(
        [
            EntityRecord(
                workspace=workspace,
                entity=entity,
                number=f"B-{i:05}",
                data={
                    "title": f"درخواست خدمات شماره {i}",
                    "amount": str(100000 + i * 125),
                    "due": f"2026-{10 + i % 2:02}-{1 + i % 28:02}",
                    "urgent": i % 5 == 0,
                    "company": str(companies[i % 100].id),
                },
                created_by=owner,
            )
            for i in range(10000)
        ],
        batch_size=1000,
    )
    call_command(
        "index_entity_fields",
        "--workspace",
        workspace.slug,
        "--entity",
        entity.code,
        "--field",
        "amount",
        "--field",
        "due",
    )
    # Match a maintained production table, rather than benchmarking stale bulk-load statistics.
    with connection.cursor() as cursor:
        cursor.execute('ANALYZE "crm_entity_records"')
    return entity


@pytest.mark.django_db(transaction=True)
def test_ten_thousand_records_filter_sort_relation_aggregate_and_export(engine, monkeypatch, tmp_path):
    workspace, owner, client = engine
    entity = benchmark_data(engine)
    report = {
        "rows": 10000,
        "companies": 100,
        "platform": platform.platform(),
        "cpus": os.cpu_count(),
        "python": platform.python_version(),
        "scenarios": [],
    }
    scenarios = {
        "indexed_numeric_range": spec(
            "title",
            "amount",
            filter={"field": "amount", "op": "gte", "value": "1300000"},
            sort=[{"field": "amount", "direction": "asc"}],
        ),
        "compound_sort_aggregate": spec(
            "title",
            "amount",
            "due",
            filter={
                "op": "and",
                "rules": [
                    {"field": "amount", "op": "gte", "value": "200000"},
                    {
                        "op": "or",
                        "rules": [
                            {"field": "urgent", "op": "eq", "value": True},
                            {"field": "due", "op": "lt", "value": "2026-11-01"},
                        ],
                    },
                ],
            },
            sort=[{"field": "amount", "direction": "desc"}, {"field": "title", "direction": "asc"}],
            group="urgent",
        ),
        "relation_path": spec(
            "title",
            "amount",
            "company.region",
            filter={"field": "company.region", "op": "eq", "value": "تهران"},
            sort=[{"field": "company.region", "direction": "asc"}, {"field": "amount", "direction": "desc"}],
        ),
        "deterministic_pagination": spec(
            "title", "amount", sort=[{"field": "due", "direction": "asc"}, {"field": "amount", "direction": "desc"}]
        ),
    }
    for name, definition in scenarios.items():
        with CaptureQueriesContext(connection) as queries:
            start = perf_counter()
            response = client.post(
                endpoint(workspace, f"entities/{entity.code}/query/"),
                {"definition": definition, "page": 2, "page_size": 100},
                format="json",
            )
            elapsed = perf_counter() - start
        assert response.status_code == 200, response.data
        assert len(response.data["results"]) == 100
        report["scenarios"].append(
            {
                "name": name,
                "api_seconds": round(elapsed, 4),
                "queries": len(queries),
                "matched": response.data["count"],
                "returned": 100,
            }
        )
        if name == "relation_path":
            assert response.data["count"] == 3400
    report["plan"] = {}
    for name in ["indexed_numeric_range", "compound_sort_aggregate", "relation_path"]:
        query = EntityQuery(entity, owner, SimpleNamespace(user=owner)).prepare(scenarios[name])
        query.projection()
        report["plan"][name] = json.loads(query.ordered().explain(analyze=True, buffers=True, format="json"))
    monkeypatch.setattr(FileAsset._meta.get_field("asset"), "storage", FileSystemStorage(location=tmp_path))
    monkeypatch.setattr(build_entity_export, "delay", lambda identifier: None)
    requested = client.post(
        endpoint(workspace, f"entities/{entity.code}/exports/"),
        {"format": "csv", "definition": spec("title", "amount", "due", "company.region")},
        format="json",
    )
    assert requested.status_code == 202, requested.data
    start = perf_counter()
    build_entity_export.run(requested.data["id"])
    job = EntityViewExport.objects.get(id=requested.data["id"])
    assert job.status == "ready", job.error
    assert job.row_count == 10000
    report["export"] = {"seconds": round(perf_counter() - start, 4), "rows": job.row_count, "format": "csv"}
    Path(".pytest_cache/entity-view-performance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("ENTITY_VIEW_PERFORMANCE=" + json.dumps({k: v for k, v in report.items() if k != "plan"}, ensure_ascii=False))
    # Regression guard, not a new product SLA; measurements and hardware are reported.
    assert max(s["api_seconds"] for s in report["scenarios"]) < 10
    assert max(s["queries"] for s in report["scenarios"]) < 80
