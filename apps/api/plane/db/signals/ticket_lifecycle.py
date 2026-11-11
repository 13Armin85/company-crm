"""Ticket 5: one hook for every status write path (API, entity engine, workflow, admin).

Bulk ``QuerySet.update`` calls bypass it by design of Django; ticket status writes in
this codebase go through ``save()``.
"""

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from plane.db.models import Issue, State, WorkspaceTask


def _old_category(instance):
    from plane.app.services.ticket_core import work_category

    original = getattr(instance, "_original_values", {})
    if instance.project_id:
        state_id = original.get("state_id")
        group = State.all_state_objects.filter(id=state_id).values_list("group", flat=True).first() if state_id else None
        return work_category(group=group)
    return work_category(status=original.get("status"), project=False)


HISTORY_FIELDS = ("priority", "target_date", "type_id", "project_id", "parent_id")


@receiver(pre_save, sender=Issue)
@receiver(pre_save, sender=WorkspaceTask)
def remember_category(sender, instance, raw=False, **kwargs):
    if raw:
        return
    instance._t5_changes = (
        {}
        if instance._state.adding
        else {
            field: (instance._original_values.get(field), getattr(instance, field))
            for field in HISTORY_FIELDS
            if instance.has_changed(field)
        }
    )
    if instance._state.adding:
        instance._t5_old = None
        return
    if not (instance.has_changed("state_id") or instance.has_changed("status")):
        instance._t5_old = "unchanged"
        return
    instance._t5_old = _old_category(instance)


@receiver(post_save, sender=Issue)
@receiver(post_save, sender=WorkspaceTask)
def apply_ticket_lifecycle(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    from plane.app.services.ticket_core import on_field_changes, on_saved

    changes = getattr(instance, "_t5_changes", {})
    if changes and not created:
        on_field_changes(instance, changes)
    old = getattr(instance, "_t5_old", "unchanged")
    if old != "unchanged":
        on_saved(instance, old, created)
    for field in ("state_id", "status", *HISTORY_FIELDS):
        instance._original_values[field] = getattr(instance, field)
    instance._t5_changes = {}
