"""Ticket 5: periodic overdue flag and reminder for ticket deadlines (idempotent, never closes)."""

from celery import shared_task

from plane.app.services.ticket_core import mark_overdue


@shared_task
def mark_overdue_tickets():
    return mark_overdue()
