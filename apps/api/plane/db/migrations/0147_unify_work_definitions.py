"""Consolidate work configuration without discarding old form versions."""

from copy import deepcopy
from django.db import migrations
from django.db.models import Max

ALIASES = {"assignee": "ticket_assignees", "task_status": "ticket_state"}


def forward(apps, schema_editor):
    db = schema_editor.connection.alias
    Entity = apps.get_model("db", "EntityType")
    Field = apps.get_model("db", "FieldDefinition")
    Form = apps.get_model("db", "FormLayout")
    Version = apps.get_model("db", "FormVersion")
    Record = apps.get_model("db", "EntityRecord")
    Event = apps.get_model("db", "EntityEvent")
    View = apps.get_model("db", "IssueView")
    Preference = apps.get_model("db", "EntityViewPreference")
    Relation = apps.get_model("db", "EntityRelation")
    Unique = apps.get_model("db", "EntityUniqueRule")
    Numbering = apps.get_model("db", "EntityNumberingRule")
    Work = apps.get_model("db", "Issue")
    for canonical in Entity._base_manager.using(db).filter(
        code="ticket", parent__isnull=True
    ):
        legacy = (
            Entity._base_manager.using(db)
            .filter(
                workspace_id=canonical.workspace_id, code="task", parent__isnull=True
            )
            .first()
        )
        fields = {
            field.code: field
            for field in Field._base_manager.using(db).filter(
                workspace_id=canonical.workspace_id
            )
        }

        def path(value, root=canonical.id):
            if not isinstance(value, str):
                return value
            parts = []
            for segment in value.split("."):
                original = fields.get(segment)
                if root in {canonical.id, legacy.id if legacy else None}:
                    segment = ALIASES.get(segment, segment)
                parts.append(segment)
                root = original.relation_entity_id if original else None
            return ".".join(parts)

        def rewrite(value, root=canonical.id):
            if isinstance(value, list):
                return [rewrite(item, root) for item in value]
            if not isinstance(value, dict):
                return value
            result = {}
            for key, item in value.items():
                if key in {
                    "field",
                    "group",
                    "depends_on",
                    "kanban_field",
                    "calendar_field",
                } and isinstance(item, str):
                    result[key] = path(item, root)
                else:
                    result[key] = rewrite(item, root)
            if result.get("source") in {"state_id", "status"}:
                result["source"] = "work_status"
            if result.get("source") == "assignee_id":
                result["source"] = "assignee_ids"
                if result.get("default") and not isinstance(
                    result["default"], (list, dict)
                ):
                    result["default"] = [result["default"]]
            return result

        form = Form._base_manager.using(db).filter(entity_id=canonical.id).first()
        if not form or not form.published_id:
            raise RuntimeError(
                "Publish the current work form before unifying work definitions."
            )
        published = Version._base_manager.using(db).get(id=form.published_id)
        layout = rewrite(deepcopy(published.schema))
        draft = rewrite(deepcopy(form.draft))
        old_form = (
            Form._base_manager.using(db).filter(entity_id=legacy.id).first()
            if legacy
            else None
        )
        if old_form:
            for target, source in [
                (
                    layout,
                    (
                        Version._base_manager.using(db)
                        .get(id=old_form.published_id)
                        .schema
                        if old_form.published_id
                        else old_form.draft
                    ),
                ),
                (draft, old_form.draft),
            ]:
                attached = {
                    binding["field"]
                    for section in target.get("sections", [])
                    for binding in section.get("bindings", [])
                }
                for section in rewrite(source).get("sections", []):
                    extra = [
                        binding
                        for binding in section.get("bindings", [])
                        if binding["field"] not in attached
                    ]
                    if extra:
                        target.setdefault("sections", []).append(
                            {
                                **section,
                                "id": "legacy-" + section["id"],
                                "bindings": extra,
                            }
                        )
                        attached.update(binding["field"] for binding in extra)
        for configured in [layout, draft]:
            for section in configured.get("sections", []):
                for binding in section.get("bindings", []):
                    if binding.get("source") == "project_id":
                        binding["required"] = False
        number = (
            Version._base_manager.using(db)
            .filter(layout_id=form.id)
            .aggregate(last=Max("number"))["last"]
            or 0
        ) + 1
        version = Version._base_manager.using(db).create(
            layout_id=form.id,
            number=number,
            schema=layout,
            change_note="یکپارچه‌سازی کارها و حفظ نسخه‌های قبلی",
        )
        Form._base_manager.using(db).filter(id=form.id).update(
            published_id=version.id, draft=draft, revision=form.revision + 1
        )
        Entity._base_manager.using(db).filter(id=canonical.id).update(
            title="کار",
            description="فرم و جدول مشترک همه کارها، با پروژه یا بدون پروژه",
        )
        for code in ["project", "ticket_state"]:
            field = fields.get(code)
            if field:
                config = deepcopy(field.config)
                if code == "project":
                    config["required"] = False
                else:
                    config["provider"] = "work_states"
                Field._base_manager.using(db).filter(id=field.id).update(config=config)
        if legacy:
            # Preserve every record's old number, data and historical form FK.
            for record in (
                Record._base_manager.using(db)
                .filter(entity_id=legacy.id)
                .iterator(chunk_size=500)
            ):
                data = dict(record.data)
                for old, new in ALIASES.items():
                    if old in data:
                        data[new] = (
                            [data[old]]
                            if old == "assignee"
                            and data[old]
                            and not isinstance(data[old], list)
                            else data[old]
                        )
                Record._base_manager.using(db).filter(id=record.id).update(
                    entity_id=canonical.id, data=data
                )
            for view in View._base_manager.using(db).filter(engine_entity_id=legacy.id):
                View._base_manager.using(db).filter(id=view.id).update(
                    engine_entity_id=canonical.id,
                    engine_definition=rewrite(view.engine_definition),
                )
            for preference in Preference._base_manager.using(db).filter(
                entity_id=legacy.id
            ):
                if (
                    Preference._base_manager.using(db)
                    .filter(entity_id=canonical.id, user_id=preference.user_id)
                    .exists()
                ):
                    raise RuntimeError(
                        "A user has two personal work defaults; select the intended default before migration."
                    )
                Preference._base_manager.using(db).filter(id=preference.id).update(
                    entity_id=canonical.id
                )
            for rule in Unique._base_manager.using(db).filter(entity_id=legacy.id):
                Unique._base_manager.using(db).filter(id=rule.id).update(
                    entity_id=canonical.id,
                    fields=[ALIASES.get(code, code) for code in rule.fields],
                )
            Numbering._base_manager.using(db).filter(entity_id=legacy.id).update(
                entity_id=canonical.id
            )
            Relation._base_manager.using(db).filter(left_entity_id=legacy.id).update(
                left_entity_id=canonical.id
            )
            Relation._base_manager.using(db).filter(right_entity_id=legacy.id).update(
                right_entity_id=canonical.id
            )
            Field._base_manager.using(db).filter(relation_entity_id=legacy.id).update(
                relation_entity_id=canonical.id
            )
            Event._base_manager.using(db).filter(entity_id=legacy.id).update(
                entity_id=canonical.id
            )
            settings = dict(legacy.view_settings)
            settings["alias_of"] = "ticket"
            Entity._base_manager.using(db).filter(id=legacy.id).update(
                is_active=False, adapter="", view_settings=settings
            )
        missing = (
            Work._base_manager.using(db)
            .filter(workspace_id=canonical.workspace_id, deleted_at__isnull=True)
            .exclude(
                id__in=Record._base_manager.using(db)
                .filter(entity_id=canonical.id)
                .values("source_id")
            )
        )
        for work in missing.iterator(chunk_size=500):
            prefix = "TSK" if work.project_id is None else "TKT"
            Record._base_manager.using(db).create(
                entity_id=canonical.id,
                workspace_id=canonical.workspace_id,
                source_id=work.id,
                number=f"{prefix}-{work.sequence_id:05d}-{str(work.id)[:8]}",
                data={},
                form_version_id=version.id,
                created_by_id=work.created_by_id,
            )
        Event._base_manager.using(db).create(
            workspace_id=canonical.workspace_id,
            entity_id=canonical.id,
            event_type="definition.work.unified",
            before=published.schema,
            after=layout,
            metadata={
                "actor": "migration:0147",
                "legacy_entity": str(legacy.id) if legacy else None,
                "archive_table": "workspace_tasks_archive_20261026",
            },
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0146_single_work_model")]
    operations = [migrations.RunPython(forward)]
