"""Opt-in live HTTP harness for Chrome against an isolated 10,000-record database.

Run with CRM_LIVE_VIEW_PROBE=1, --liveserver=0.0.0.0:8000 and publish port 8000.
The browser forwards HTTP to this real Django server; no API response is mocked.
Only ignored .pytest_cache files contain the short-lived test session.
"""

import json
import os
from pathlib import Path
from time import monotonic, sleep

import pytest
from django.test import Client
from plane.db.models import Profile

from plane.tests.contract.app.test_entity_views import engine_fixture  # noqa: F401
from plane.tests.contract.app.test_entity_view_performance import benchmark_data


@pytest.mark.contract
@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(os.environ.get("CRM_LIVE_VIEW_PROBE") != "1", reason="Opt-in real browser HTTP harness")
def test_live_ten_thousand_record_browser(engine, live_server, settings):
    settings.ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
    settings.CSRF_TRUSTED_ORIGINS = ["http://localhost:3000"]
    settings.SESSION_COOKIE_SECURE = False
    settings.CSRF_COOKIE_SECURE = False
    workspace, owner, _ = engine
    Profile.objects.get_or_create(user=owner, defaults={"last_workspace_id": workspace.id, "is_onboarded": True})
    entity = benchmark_data(engine)
    client = Client()
    client.force_login(owner)
    ready = Path(".pytest_cache/entity-view-live-ready.json")
    done = Path(".pytest_cache/entity-view-live-done.json")
    done.unlink(missing_ok=True)
    ready.write_text(
        json.dumps(
            {
                "slug": workspace.slug,
                "code": entity.code,
                "cookie_name": settings.SESSION_COOKIE_NAME,
                "cookie_value": client.cookies[settings.SESSION_COOKIE_NAME].value,
            }
        )
    )
    try:
        deadline = monotonic() + 1200
        while monotonic() < deadline and not done.exists():
            sleep(0.25)
        assert done.exists(), "The real browser did not finish within 20 minutes"
        result = json.loads(done.read_text())
        assert result.get("passed"), result
    finally:
        ready.unlink(missing_ok=True)
