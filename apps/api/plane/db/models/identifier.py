"""Persistent counters for identifiers allocated by the server."""

from django.db import models


class SystemIdentifierCounter(models.Model):
    key = models.CharField(max_length=100, primary_key=True)
    value = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = "system_identifier_counters"

    @classmethod
    def locked(cls, key, using):
        # The caller holds an atomic transaction until the entity is saved.
        cls.objects.using(using).get_or_create(key=key)
        return cls.objects.using(using).select_for_update().get(key=key)

    def advance(self, minimum=0):
        self.value = max(self.value, minimum) + 1
        self.save(update_fields=["value"])
        return self.value
