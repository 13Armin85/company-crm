"""The scheduled dashboard alert must be available to Celery workers."""

import pytest

from plane.celery import app


@pytest.mark.unit
def test_dashboard_alert_task_is_registered():
    app.loader.import_default_modules()

    assert "plane.bgtasks.dashboard_alerts.notify_idle_team_managers" in app.tasks
