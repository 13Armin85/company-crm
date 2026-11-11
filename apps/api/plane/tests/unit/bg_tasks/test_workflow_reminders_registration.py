"""The scheduled workflow reminder must be available to Celery workers and beat."""

import pytest

from plane.celery import app


@pytest.mark.unit
def test_workflow_reminder_task_is_registered_and_scheduled():
    app.loader.import_default_modules()

    assert "plane.bgtasks.workflow_reminders.send_workflow_reminders" in app.tasks
    assert any(
        row["task"] == "plane.bgtasks.workflow_reminders.send_workflow_reminders"
        for row in app.conf.beat_schedule.values()
    )
