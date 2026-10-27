"""Workspace-scoped metadata and custom values; native records remain in Plane."""

from django.contrib.postgres.indexes import GinIndex
from django.db import models

from .base import BaseModel


def default_record_permissions():
    return {
        action: f"Issue.{code}"
        for action, code in (
            ("view", "View"),
            ("view_all", "ViewAll"),
            ("create", "Create"),
            ("edit", "Edit"),
            ("delete", "Delete"),
        )
    }


class EntityType(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="entity_types"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="subtypes"
    )
    code = models.SlugField(max_length=80)
    title = models.CharField(max_length=255)
    icon = models.CharField(max_length=80, default="box")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    adapter = models.CharField(max_length=24, blank=True)
    title_field = models.CharField(max_length=80, default="title")
    numbering = models.JSONField(default=dict)
    record_permissions = models.JSONField(default=default_record_permissions)
    view_settings = models.JSONField(default=dict)

    class Meta:
        db_table = "crm_entity_types"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], name="crm_entity_code_unique"
            )
        ]


class LookupCategory(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="lookup_categories"
    )
    code = models.SlugField(max_length=80)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(default=False)

    class Meta:
        db_table = "crm_lookup_categories"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], name="crm_lookup_code_unique"
            )
        ]


class LookupValue(BaseModel):
    category = models.ForeignKey(
        LookupCategory, on_delete=models.PROTECT, related_name="values"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    code = models.SlugField(max_length=80)
    title = models.CharField(max_length=255)
    color = models.CharField(max_length=9, default="#64748b")
    icon = models.CharField(max_length=80, blank=True)
    position = models.IntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "crm_lookup_values"
        ordering = ("position", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["category", "code"], name="crm_lookup_value_code_unique"
            ),
            models.UniqueConstraint(
                fields=["category"],
                condition=models.Q(is_default=True, deleted_at__isnull=True),
                name="crm_lookup_one_default",
            ),
        ]


class FieldDefinition(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="field_definitions"
    )
    code = models.SlugField(max_length=80)
    title = models.CharField(max_length=255)
    kind = models.CharField(max_length=24)
    help_text = models.TextField(blank=True)
    placeholder = models.CharField(max_length=255, blank=True)
    config = models.JSONField(default=dict)
    lookup = models.ForeignKey(
        LookupCategory,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="fields",
    )
    relation_entity = models.ForeignKey(
        EntityType,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="relation_fields",
    )
    is_active = models.BooleanField(default=True)
    hidden_from_form = models.BooleanField(default=False)
    show_in_summary = models.BooleanField(default=False)
    searchable = models.BooleanField(default=True)
    filterable = models.BooleanField(default=True)
    table_visible = models.BooleanField(default=True)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "crm_field_definitions"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], name="crm_field_code_unique"
            )
        ]


class FormLayout(BaseModel):
    entity = models.OneToOneField(
        EntityType, on_delete=models.PROTECT, related_name="form_layout"
    )
    draft = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    published = models.ForeignKey(
        "db.FormVersion",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="current_layouts",
    )

    class Meta:
        db_table = "crm_form_layouts"


class FormVersion(BaseModel):
    layout = models.ForeignKey(
        FormLayout, on_delete=models.PROTECT, related_name="versions"
    )
    number = models.PositiveIntegerField()
    schema = models.JSONField(default=dict)
    change_note = models.TextField(blank=True)

    class Meta:
        db_table = "crm_form_versions"
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(
                fields=["layout", "number"], name="crm_form_version_unique"
            )
        ]


class EntityRecord(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="entity_records"
    )
    entity = models.ForeignKey(
        EntityType, on_delete=models.PROTECT, related_name="records"
    )
    subtype = models.ForeignKey(
        EntityType,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="subtype_records",
    )
    source_id = models.UUIDField(null=True, blank=True)
    number = models.CharField(max_length=120)
    data = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    revision = models.PositiveIntegerField(default=1)
    form_version = models.ForeignKey(
        FormVersion,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="records",
    )

    class Meta:
        db_table = "crm_entity_records"
        indexes = [
            GinIndex(fields=["data"], name="crm_record_data_gin"),
            models.Index(
                fields=["workspace", "entity", "created_at"],
                name="crm_record_scope_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "number"], name="crm_record_number_unique"
            ),
            models.UniqueConstraint(
                fields=["entity", "source_id"],
                condition=models.Q(source_id__isnull=False),
                name="crm_record_source_unique",
            ),
        ]


class EntityEvent(BaseModel):
    """Durable, transactionally committed event log. Auditing is its first consumer."""

    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="entity_events"
    )
    entity = models.ForeignKey(
        EntityType, null=True, on_delete=models.SET_NULL, related_name="events"
    )
    record_id = models.UUIDField(null=True)
    event_type = models.CharField(max_length=80)
    field = models.CharField(max_length=80, blank=True)
    before = models.JSONField(null=True)
    after = models.JSONField(null=True)
    metadata = models.JSONField(default=dict)
    contract_version = models.PositiveSmallIntegerField(default=1)

    class Meta:
        db_table = "crm_entity_events"
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(
                fields=["workspace", "entity", "record_id"], name="crm_event_record_idx"
            )
        ]


class EntityViewExport(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    entity = models.ForeignKey(EntityType, on_delete=models.PROTECT)
    user = models.ForeignKey("db.User", on_delete=models.CASCADE)
    definition = models.JSONField(default=dict)
    format = models.CharField(max_length=4)
    status = models.CharField(max_length=12, default="pending")
    error = models.TextField(blank=True)
    row_count = models.PositiveIntegerField(default=0)
    fingerprint = models.CharField(max_length=64, blank=True)
    asset = models.ForeignKey("db.FileAsset", null=True, on_delete=models.SET_NULL)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "crm_entity_view_exports"
        indexes = [
            models.Index(
                fields=["workspace", "user", "created_at"], name="crm_export_owner_idx"
            )
        ]


class EntityViewPreference(BaseModel):
    """A server-owned preference; a role default never overwrites a user's choice."""

    entity = models.ForeignKey(
        EntityType, on_delete=models.CASCADE, related_name="view_preferences"
    )
    user = models.ForeignKey("db.User", on_delete=models.CASCADE)
    default_view = models.ForeignKey(
        "db.IssueView", null=True, blank=True, on_delete=models.SET_NULL
    )

    class Meta:
        db_table = "crm_entity_view_preferences"
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "user"], name="crm_view_preference_unique"
            )
        ]


class EntityUniqueRule(BaseModel):
    entity = models.ForeignKey(
        EntityType, on_delete=models.CASCADE, related_name="unique_rules"
    )
    title = models.CharField(max_length=255)
    fields = models.JSONField(default=list)
    mode = models.CharField(max_length=8, default="block")
    is_active = models.BooleanField(default=True)
    existing_policy = models.CharField(max_length=12, default="resolve")

    class Meta:
        db_table = "crm_entity_unique_rules"


class EntityNumberingRule(BaseModel):
    entity = models.ForeignKey(
        EntityType, on_delete=models.CASCADE, related_name="numbering_rules"
    )
    field = models.OneToOneField(FieldDefinition, on_delete=models.PROTECT)
    prefix = models.CharField(max_length=60, blank=True)
    start = models.PositiveBigIntegerField(default=1)
    padding = models.PositiveSmallIntegerField(default=0)
    subtype_prefixes = models.JSONField(default=dict)
    shared_sequence = models.BooleanField(default=True)

    class Meta:
        db_table = "crm_entity_numbering_rules"


class EntityNumberValue(BaseModel):
    rule = models.ForeignKey(
        EntityNumberingRule, on_delete=models.PROTECT, related_name="values"
    )
    record = models.ForeignKey(EntityRecord, on_delete=models.PROTECT)
    value = models.CharField(max_length=120)

    class Meta:
        db_table = "crm_entity_number_values"
        constraints = [
            models.UniqueConstraint(
                fields=["rule", "record"], name="crm_number_record_unique"
            ),
            models.UniqueConstraint(
                fields=["rule", "value"], name="crm_number_value_unique"
            ),
        ]


class EntityRelation(BaseModel):
    left_entity = models.ForeignKey(
        EntityType, on_delete=models.PROTECT, related_name="outgoing_relations"
    )
    right_entity = models.ForeignKey(
        EntityType, on_delete=models.PROTECT, related_name="incoming_relations"
    )
    left_field = models.OneToOneField(
        FieldDefinition, on_delete=models.PROTECT, related_name="forward_relation"
    )
    right_field = models.OneToOneField(
        FieldDefinition, on_delete=models.PROTECT, related_name="reverse_relation"
    )
    kind = models.CharField(max_length=16)
    left_required = models.BooleanField(default=False)
    right_required = models.BooleanField(default=False)
    on_delete = models.CharField(max_length=8, default="block")

    class Meta:
        db_table = "crm_entity_relations"


class EntityRelationLink(BaseModel):
    relation = models.ForeignKey(
        EntityRelation, on_delete=models.PROTECT, related_name="links"
    )
    left_id = models.UUIDField()
    right_id = models.UUIDField()

    class Meta:
        db_table = "crm_entity_relation_links"
        constraints = [
            models.UniqueConstraint(
                fields=["relation", "left_id", "right_id"],
                condition=models.Q(deleted_at__isnull=True),
                name="crm_relation_pair_unique",
            )
        ]
        indexes = [
            models.Index(fields=["relation", "left_id"], name="crm_relation_left_idx"),
            models.Index(
                fields=["relation", "right_id"], name="crm_relation_right_idx"
            ),
        ]
