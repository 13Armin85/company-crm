"""Periodic near-due / overdue reminders for workflow steps (once per step run)."""

from celery import shared_task

from plane.app.services.workflow_actions import send_due_reminders


@shared_task
def send_workflow_reminders():
    return send_due_reminders()
