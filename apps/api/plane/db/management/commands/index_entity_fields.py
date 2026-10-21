"""Build selected typed indexes from validated field metadata, with safe quoting."""

import hashlib

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, models
from django.db.models.fields.json import KeyTextTransform

from plane.db.models import EntityRecord, EntityType
from plane.app.services.entity_schema import schema_fields
from plane.app.services.entity_query import ISODate, NUMERIC, output_type, TypedNumeric


class Command(BaseCommand):
    help = "Create idempotent numeric/date query indexes for a configured entity; JSONB remains the source of truth."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--entity", required=True)
        parser.add_argument("--field", action="append", dest="fields", required=True)
        parser.add_argument("--concurrently", action="store_true")

    def handle(self, *args, **options):
        entity = EntityType.objects.get(
            workspace__slug=options["workspace"], code=options["entity"], parent__isnull=True
        )
        _, fields = schema_fields(entity)
        with connection.cursor() as cursor:
            existing = connection.introspection.get_constraints(cursor, EntityRecord._meta.db_table)
        for code in options["fields"]:
            field = fields.get(code)
            if not field or field["binding"].get("source") or field["kind"] not in (NUMERIC - {"computed"}) | {"date"}:
                raise CommandError("Choose a custom stored numeric/date field from this entity's published schema.")
            name = "crm_ev_" + hashlib.sha256(f"{entity.id}:{code}".encode()).hexdigest()[:20]
            if name in existing:
                self.stdout.write(f"{code}: index already exists ({name})")
                continue
            value = KeyTextTransform(code, "data")
            expression = ISODate(value) if field["kind"] == "date" else TypedNumeric(value, output_type(field["kind"]))
            index = models.Index(
                models.F("entity"),
                expression,
                models.F("id"),
                condition=models.Q(entity_id=entity.id, deleted_at__isnull=True),
                name=name,
            )
            with connection.schema_editor(atomic=False) as editor:
                editor.add_index(EntityRecord, index, concurrently=options["concurrently"])
            self.stdout.write(f"{code}: created {name}")
