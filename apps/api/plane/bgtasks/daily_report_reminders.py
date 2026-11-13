"""Ticket 8: periodic in-app daily-report reminder (idempotent: one per person and day)."""

from celery import shared_task

from plane.app.services.daily_report_reminders import send_reminders


@shared_task
def send_daily_report_reminders():
    return send_reminders()
