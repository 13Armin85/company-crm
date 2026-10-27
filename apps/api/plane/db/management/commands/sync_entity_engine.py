from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from plane.db.models import Workspace, EntityRecord, FieldDefinition, SystemIdentifierCounter, FormLayout
from plane.app.services.entity_schema import initialize_engine, schema_fields
from plane.app.services.entity_records import ADAPTERS, base_native_rows
from plane.app.services.permission_registry import sync_permission_catalog


class Command(BaseCommand):
    help = "Initialize entity metadata and attach custom-value sidecars without changing native records."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", help="Workspace slug; omitted means all workspaces")

    def handle(self, *args, **options):
        workspaces = Workspace.objects.all()
        if options.get("workspace"):
            workspaces = workspaces.filter(slug=options["workspace"])
        for workspace in workspaces.iterator():
            with transaction.atomic():
                Workspace.objects.select_for_update().get(id=workspace.id)
                sync_permission_catalog(workspace)
                types = initialize_engine(workspace)
                from plane.db.models import IssueType
                from plane.app.services.entity_issue_types import sync_native_subtype

                subtype_map = {
                    native.id: sync_native_subtype(native)
                    for native in IssueType.all_objects.filter(workspace=workspace)
                }
                attached = 0
                for code, model in ADAPTERS.items():
                    if code not in types:
                        # Legacy aliases use the canonical entity and do not own a second catalog row.
                        continue
                    entity = types[code]
                    form = FormLayout.objects.get(entity=entity)
                    counter = SystemIdentifierCounter.locked(f"entity:{entity.id}", "default")
                    sources = set(EntityRecord.all_objects.filter(entity=entity).values_list("source_id", flat=True))
                    for native in base_native_rows(entity, include_deleted=True).iterator():
                        if native.id in sources:
                            if code == "ticket" and native.type_id:
                                EntityRecord.all_objects.filter(
                                    entity=entity, source_id=native.id, subtype__isnull=True
                                ).update(subtype=subtype_map.get(native.type_id))
                            continue
                        from plane.app.services.entity_identifiers import format_record_number

                        number = format_record_number(entity, counter.advance())
                        record = EntityRecord(
                            entity=entity,
                            workspace=workspace,
                            source_id=native.id,
                            subtype=subtype_map.get(native.type_id) if code == "ticket" else None,
                            number=number,
                            data={},
                            form_version=form.published,
                            created_by_id=getattr(native, "created_by_id", None),
                            deleted_at=getattr(native, "deleted_at", None),
                        )
                        record.save(disable_auto_set_user=True)
                        attached += 1
                    if sources or EntityRecord.all_objects.filter(entity=entity).exists():
                        _, fields = schema_fields(entity)
                        FieldDefinition.objects.filter(
                            workspace=workspace, code__in=fields, used_at__isnull=True
                        ).update(used_at=timezone.now())
                self.stdout.write(
                    self.style.SUCCESS(f"{workspace.slug}: metadata ready; {attached} existing records attached")
                )
