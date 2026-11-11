"""Ticket 2: completing the relation engine (link data, duplicates, delete rules,
permissions on options, cycles, definition changes, reports, system tables)."""

from uuid import uuid4

import pytest

from plane.db.models import (
    EntityEvent,
    EntityRecord,
    EntityRelation,
    EntityType,
    LookupCategory,
    LookupValue,
    User,
    WorkspaceMember,
)
from plane.app.services.entity_relations import CARDINALITY
from plane.tests.contract.app.test_entity_engine import (
    make_entity,
    create_record,
    endpoint,
    engine,  # noqa: F401 - pytest fixture
)
from plane.tests.contract.app.test_entity_views import spec, query
from plane.tests.contract.app.test_crm_access_control import grant_role

pytestmark = [pytest.mark.django_db, pytest.mark.contract]
KINDS = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"]


def relation(engine, left, right, expected=201, **changes):
    workspace, _, client = engine
    response = client.post(
        endpoint(workspace, "relations/"),
        {
            "left_entity": left.code,
            "right_entity": right.code,
            "left_title": "سمت اول",
            "right_title": "سمت دوم",
            "kind": "one_to_many",
            **changes,
        },
        format="json",
    )
    assert response.status_code == expected, response.data
    return response.data


def patch_relation(engine, rule, expected=200, **changes):
    workspace, _, client = engine
    response = client.patch(
        endpoint(workspace, f"relations/{rule['id']}/"), changes, format="json"
    )
    assert response.status_code == expected, response.data
    return response.data


def update(engine, entity, record, values, expected=200, **payload):
    workspace, _, client = engine
    current = client.get(
        endpoint(workspace, f"entities/{entity.code}/records/{record['id']}/")
    ).data
    response = client.patch(
        endpoint(workspace, f"entities/{entity.code}/records/{record['id']}/"),
        {"revision": current["revision"], "values": values, **payload},
        format="json",
    )
    assert response.status_code == expected, response.data
    return response.data


def value(ids, multiple):
    return ids if multiple else ids[0]


def viewer(workspace, name):
    user = User.objects.create_user(email=f"{name}@example.com", username=name)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


# ------------------------------------------------------------ cardinality


@pytest.mark.parametrize("kind", KINDS)
def test_cardinality_is_enforced_from_both_sides(engine, kind):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(engine, left, right, kind=kind)
    left_many, right_many = CARDINALITY[kind]
    r1, r2, r3 = (create_record(engine, right, {"title": t}) for t in "abc")
    first = create_record(
        engine, left, {"title": "L1", rule["left_field"]: value([r1["id"]], left_many)}
    )
    # Reverse projection on the right record.
    reverse = client.get(endpoint(workspace, f"entities/right/records/{r1['id']}/"))
    assert first["id"] in str(reverse.data["values"][rule["right_field"]])
    # A second left record to the same right record needs a "many" right side.
    create_record(
        engine,
        left,
        {"title": "L2", rule["left_field"]: value([r1["id"]], left_many)},
        201 if right_many else 400,
    )
    # One left record to two right records needs a "many" left side.
    create_record(
        engine,
        left,
        {"title": "L3", rule["left_field"]: [r2["id"], r3["id"]]},
        201 if left_many else 400,
    )
    # The right side enforces its own count too.
    fresh = [create_record(engine, left, {"title": f"F{i}"}) for i in range(2)]
    create_record(
        engine,
        right,
        {"title": "R4", rule["right_field"]: [item["id"] for item in fresh]},
        201 if right_many else 400,
    )


@pytest.mark.parametrize("kind", KINDS)
def test_required_side_is_checked_on_create_and_edit(engine, kind):
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(engine, left, right, kind=kind, left_required=True)
    target = create_record(engine, right, {"title": "مقصد"})
    create_record(engine, left, {"title": "بدون اتصال"}, 400)
    many = CARDINALITY[kind][0]
    record = create_record(
        engine, left, {"title": "با اتصال", rule["left_field"]: value([target["id"]], many)}
    )
    update(engine, left, record, {rule["left_field"]: [] if many else None}, 400)


# ------------------------------------------------------- duplicates & data


def role_lookup(workspace):
    category = LookupCategory.objects.create(
        workspace=workspace, code="contact-role", title="نقش مخاطب"
    )
    return [
        LookupValue.objects.create(category=category, code=code, title=title)
        for code, title in (("owner", "مالک"), ("tech", "فنی"))
    ]


def test_link_data_quantity_and_role_are_validated_and_returned(engine):
    workspace, _, client = engine
    owner, tech = role_lookup(workspace)
    ticket, _ = make_entity(engine, code="order")
    product, _ = make_entity(engine, code="product")
    rule = relation(
        engine,
        ticket,
        product,
        kind="many_to_many",
        link_fields=[
            {"code": "quantity", "title": "تعداد", "kind": "integer", "config": {"required": True, "min": 1}},
            {"code": "role", "title": "نقش", "kind": "select", "lookup": "contact-role"},
        ],
    )
    item = create_record(engine, product, {"title": "کالا"})
    code = rule["left_field"]
    # Required link field missing.
    create_record(engine, ticket, {"title": "سفارش", code: [item["id"]]}, 400)
    # Invalid quantity and invalid lookup option.
    for data in ({"quantity": 0}, {"quantity": 2, "role": str(uuid4())}, {"other": 1}):
        create_record(
            engine,
            ticket,
            {"title": "سفارش", code: [item["id"]]},
            400,
            relation_data={code: [{"id": item["id"], "data": data}]},
        )
    order = create_record(
        engine,
        ticket,
        {"title": "سفارش", code: [item["id"]]},
        relation_data={code: [{"id": item["id"], "data": {"quantity": 3, "role": str(owner.id)}}]},
    )
    assert order["relation_data"][code] == [
        {"id": item["id"], "data": {"quantity": 3, "role": str(owner.id)}}
    ]
    # Editing only the data keeps one link and changes it in place.
    update(
        engine,
        ticket,
        order,
        {code: [item["id"]]},
        relation_data={code: [{"id": item["id"], "data": {"quantity": 5, "role": str(tech.id)}}]},
    )
    links = EntityRelation.objects.get(id=rule["id"]).links.all()
    assert [link.data for link in links] == [{"quantity": 5, "role": str(tech.id)}]
    related = client.get(
        endpoint(workspace, f"entities/order/records/{order['id']}/related/{code}/")
    ).data
    assert related["link_data"][item["id"]] == [{"quantity": 5, "role": str(tech.id)}]
    assert [field["code"] for field in related["link_fields"]] == ["quantity", "role"]


def test_duplicate_pairs_follow_the_allow_duplicates_switch(engine):
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    fields = [{"code": "quantity", "title": "تعداد", "kind": "integer"}]
    rule = relation(engine, left, right, kind="many_to_many", link_fields=fields)
    code = rule["left_field"]
    item = create_record(engine, right, {"title": "کالا"})
    twice = [{"id": item["id"], "data": {"quantity": 1}}, {"id": item["id"], "data": {"quantity": 2}}]
    # Off: the same pair cannot be linked twice even with different data.
    create_record(engine, left, {"title": "x", code: [item["id"]]}, 400, relation_data={code: twice})
    # Only many-to-many may allow duplicates.
    patch_relation(engine, rule, 400, kind="one_to_many", allow_duplicates=True)
    patch_relation(engine, rule, allow_duplicates=True)
    record = create_record(
        engine, left, {"title": "x", code: [item["id"]]}, relation_data={code: twice}
    )
    assert len(record["relation_data"][code]) == 2
    # Identical data is still a duplicate.
    same = [{"id": item["id"], "data": {"quantity": 1}}] * 2
    create_record(engine, left, {"title": "y", code: [item["id"]]}, 400, relation_data={code: same})
    # Turning duplicates off while duplicates exist is refused and nothing is lost.
    error = patch_relation(engine, rule, 400, allow_duplicates=False)
    assert "۱" in str(error)
    assert EntityRelation.objects.get(id=rule["id"]).links.count() == 2


# ---------------------------------------------------------------- options


def test_options_return_only_permitted_records_with_search_filter_and_pages(engine):
    workspace, owner, client = engine
    target, _ = make_entity(engine, code="customer")
    source, _ = make_entity(engine, code="deal")
    rule = relation(engine, source, target, kind="many_to_one")
    member = viewer(workspace, "options-member")
    mine = []
    for index in range(12):
        row = create_record(engine, target, {"title": f"مشتری {index}"})
        if index % 2 == 0:
            EntityRecord.objects.filter(id=row["id"]).update(created_by=member)
            mine.append(row["id"])
    hidden = create_record(engine, target, {"title": "مشتری پنهان"})
    inactive = create_record(engine, target, {"title": "مشتری غیرفعال"})
    EntityRecord.objects.filter(id=inactive["id"]).update(
        created_by=member, is_active=False
    )
    url = endpoint(workspace, f"entities/deal/options/{rule['left_field']}/")
    full = client.get(url + "?page_size=5").data
    assert full["count"] == 13 and len(full["results"]) == 5 and full["can_create"]
    assert client.get(url + "?page=3&page_size=5").data["results"]
    assert client.get(url + "?search=پنهان").data["count"] == 1
    response = client.get(
        url,
        {"filter": '{"field": "title", "op": "contains", "value": "مشتری 1"}'},
    )
    assert response.status_code == 200, response.data
    filtered = response.data
    assert {row["title"] for row in filtered["results"]} == {"مشتری 1", "مشتری 10", "مشتری 11"}
    # A member sees only records they may read; inactive ones only when already selected.
    client.force_authenticate(member)
    limited = client.get(url + "?page_size=50").data
    assert {row["id"] for row in limited["results"]} == set(mine)
    assert hidden["id"] not in str(limited)
    resolved = client.get(url + f"?resolve=true&selected={inactive['id']}").data
    assert resolved["results"][0]["inactive"] is True
    client.force_authenticate(owner)


def test_quick_create_without_target_create_permission_is_403(engine):
    workspace, owner, client = engine
    target, _ = make_entity(engine, code="customer")
    source, _ = make_entity(engine, code="deal")
    rule = relation(engine, source, target, kind="many_to_one")
    target.record_permissions = {**target.record_permissions, "create": "Config.Export"}
    target.save()
    member = viewer(workspace, "quick-member")
    client.force_authenticate(member)
    options = client.get(endpoint(workspace, f"entities/deal/options/{rule['left_field']}/"))
    assert options.status_code == 200 and options.data["can_create"] is False
    created = client.post(
        endpoint(workspace, "entities/customer/records/"),
        {"values": {"title": "سریع"}},
        format="json",
    )
    assert created.status_code == 403
    client.force_authenticate(owner)


# ----------------------------------------------------------------- delete


@pytest.mark.parametrize("behavior", ["block", "detach", "soft_deactivate"])
def test_delete_rules_with_impact_preview(engine, behavior):
    workspace, _, client = engine
    left, _ = make_entity(engine, code="ticketx")
    right, _ = make_entity(engine, code="customer")
    rule = relation(engine, left, right, kind="many_to_one", on_delete=behavior)
    customer = create_record(engine, right, {"title": "مشتری"})
    tickets = [
        create_record(engine, left, {"title": f"تیکت {i}", rule["left_field"]: customer["id"]})
        for i in range(2)
    ]
    preview = client.get(
        endpoint(workspace, f"entities/customer/records/{customer['id']}/delete-preview/")
    )
    assert preview.status_code == 200, preview.data
    impact = preview.data["impacts"][0]
    assert impact["link_count"] == 2 and impact["behavior"] == behavior
    assert impact["opposite_entity"] == "ticketx"
    assert preview.data["result"] == {"block": "blocked", "detach": "delete", "soft_deactivate": "deactivate"}[behavior]
    # The preview changed nothing.
    assert EntityRelation.objects.get(id=rule["id"]).links.count() == 2
    response = client.delete(
        endpoint(workspace, f"entities/customer/records/{customer['id']}/?confirm_relations=true")
    )
    links = EntityRelation.objects.get(id=rule["id"]).links
    if behavior == "block":
        assert response.status_code == 400
        assert links.count() == 2
    elif behavior == "detach":
        assert response.status_code == 204, response.data
        assert links.count() == 0
        ticket = client.get(endpoint(workspace, f"entities/ticketx/records/{tickets[0]['id']}/"))
        assert ticket.data["values"][rule["left_field"]] is None
    else:
        assert response.status_code == 204, response.data
        row = EntityRecord.objects.get(id=customer["id"])
        assert row.is_active is False and row.deleted_at is None
        assert links.count() == 2
        result = query(engine, left, spec("title", rule["left_field"]))
        assert result.data["labels"][rule["left_field"]][customer["id"]]["inactive"] is True


def test_preview_requires_delete_permission(engine):
    workspace, owner, client = engine
    entity, _ = make_entity(engine, code="customer")
    entity.record_permissions = {**entity.record_permissions, "delete": "Config.Export"}
    entity.save()
    member = viewer(workspace, "preview-member")
    row = create_record(engine, entity, {"title": "مشتری"})
    EntityRecord.objects.filter(id=row["id"]).update(created_by=member)
    client.force_authenticate(member)
    response = client.get(
        endpoint(workspace, f"entities/customer/records/{row['id']}/delete-preview/")
    )
    assert response.status_code == 403
    client.force_authenticate(owner)


def test_cascade_delete_is_not_an_option(engine):
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    relation(engine, left, right, 400, on_delete="cascade")


# ---------------------------------------------------- self relations


def test_self_relation_refuses_self_links_and_cycles(engine):
    entity, _ = make_entity(engine, code="company")
    relation(engine, entity, entity, 400, kind="many_to_many", hierarchical=True)
    # left = parent, right = children (one parent has many children).
    rule = relation(engine, entity, entity, kind="one_to_many", hierarchical=True)
    children = rule["left_field"]
    a = create_record(engine, entity, {"title": "A"})
    b = create_record(engine, entity, {"title": "B", children: []})
    c = create_record(engine, entity, {"title": "C"})
    update(engine, entity, a, {children: [a["id"]]}, 400)
    update(engine, entity, a, {children: [b["id"]]})
    update(engine, entity, b, {children: [c["id"]]})
    # C -> A would close A -> B -> C -> A.
    update(engine, entity, c, {children: [a["id"]]}, 400)
    # The same edge through the reverse (parent) field is refused as well.
    update(engine, entity, a, {rule["right_field"]: c["id"]}, 400)


# ---------------------------------------------------- definition changes


def test_incompatible_definition_changes_are_refused_without_data_loss(engine):
    workspace, actor, client = engine
    left, _ = make_entity(engine, code="left")
    right, _ = make_entity(engine, code="right")
    rule = relation(
        engine,
        left,
        right,
        kind="many_to_many",
        link_fields=[{"code": "quantity", "title": "تعداد", "kind": "integer"}],
    )
    code = rule["left_field"]
    targets = [create_record(engine, right, {"title": t}) for t in "ab"]
    create_record(
        engine,
        left,
        {"title": "x", code: [t["id"] for t in targets]},
        relation_data={code: [{"id": t["id"], "data": {"quantity": 1}} for t in targets]},
    )
    create_record(engine, left, {"title": "بدون اتصال"})
    error = patch_relation(engine, rule, 400, kind="one_to_one")
    assert "۱ رکورد" in str(error)
    error = patch_relation(engine, rule, 400, left_required=True)
    assert "۱ رکورد" in str(error)
    error = patch_relation(engine, rule, 400, link_fields=[])
    assert "۲ پیوند" in str(error)
    error = patch_relation(
        engine,
        rule,
        400,
        link_fields=[{"code": "quantity", "title": "تعداد", "kind": "short_text"}],
    )
    stored = EntityRelation.objects.get(id=rule["id"])
    assert stored.kind == "many_to_many" and not stored.left_required
    assert stored.links.count() == 2 and all(link.data == {"quantity": 1} for link in stored.links.all())
    # A compatible change is accepted and audited with actor, before and after.
    patch_relation(engine, rule, left_title="اقلام", on_delete="soft_deactivate")
    event = EntityEvent.objects.filter(
        workspace=workspace, event_type="definition.relation.updated"
    ).first()
    assert event.created_by_id == actor.id
    assert event.before["left_title"] == "سمت اول" and event.after["left_title"] == "اقلام"
    assert event.after["on_delete"] == "soft_deactivate"
    assert EntityEvent.objects.filter(
        workspace=workspace, event_type="definition.relation.created"
    ).exists()
    response = client.delete(endpoint(workspace, f"relations/{rule['id']}/?confirm=true"))
    assert response.status_code == 204
    assert EntityEvent.objects.filter(
        workspace=workspace, event_type="definition.relation.deleted"
    ).exists()


# ------------------------------------------------- query and reports


def test_relation_filter_sort_and_report_group_do_not_leak_titles(engine):
    workspace, owner, client = engine
    customer, _ = make_entity(engine, code="customer")
    product, _ = make_entity(engine, code="product")
    deal, _ = make_entity(engine, code="deal")
    single = relation(engine, deal, customer, kind="many_to_one")
    multi = relation(engine, deal, product, kind="many_to_many")
    member = viewer(workspace, "report-member")
    grant_role(workspace, member, ["Relation.View"], name="report-relations")
    visible = create_record(engine, customer, {"title": "بهار"})
    secret = create_record(engine, customer, {"title": "محرمانه"})
    alpha = create_record(engine, customer, {"title": "آلفا"})
    EntityRecord.objects.filter(id__in=[visible["id"], alpha["id"]]).update(created_by=member)
    item = create_record(engine, product, {"title": "کالا"})
    rows = {}
    for title, target in (("d1", visible), ("d2", secret), ("d3", alpha), ("d4", None)):
        values = {"title": title, multi["left_field"]: [item["id"]] if title == "d1" else []}
        if target:
            values[single["left_field"]] = target["id"]
        rows[title] = create_record(engine, deal, values)
    EntityRecord.objects.filter(entity=deal).update(created_by=member)
    s, m = single["left_field"], multi["left_field"]
    for op, val, expected in (
        ("eq", visible["id"], {"d1"}),
        ("in", [visible["id"], alpha["id"]], {"d1", "d3"}),
        ("empty", None, {"d4"}),
        ("not_empty", None, {"d1", "d2", "d3"}),
    ):
        result = query(engine, deal, spec("title", s, filter={"field": s, "op": op, "value": val}))
        assert result.status_code == 200, result.data
        assert {row["title"] for row in result.data["results"]} == expected, op
    contains = query(engine, deal, spec("title", m, filter={"field": m, "op": "contains", "value": item["id"]}))
    assert {row["title"] for row in contains.data["results"]} == {"d1"}
    # Sorting a single relation orders by the related title; a multiple relation cannot sort.
    ordered = query(engine, deal, spec("title", s, sort=[{"field": s, "direction": "asc"}]))
    assert [row["title"] for row in ordered.data["results"]][:3] == ["d3", "d1", "d2"]
    assert query(engine, deal, spec("title", m, sort=[{"field": m, "direction": "asc"}])).status_code == 400
    # Reports: the member cannot see "محرمانه"; its deal is counted as "no access".
    client.force_authenticate(member)
    widget = {"type": "chart", "config": {"entity": "deal", "group_by": s}}
    response = client.post(
        f"/api/workspaces/{workspace.slug}/dashboard/widgets/data/", {"widget": widget}, format="json"
    )
    assert response.status_code == 200, response.data
    assert not response.data.get("hidden"), response.data
    points = {str(point["label"]): point["value"] for point in response.data["points"]}
    assert points["__restricted__"] == 1
    assert response.data["labels"]["__restricted__"] == "بدون دسترسی"
    assert "محرمانه" not in str(response.data)
    assert response.data["labels"][visible["id"]] == "بهار"
    client.force_authenticate(owner)


# ---------------------------------------------------- system tables


def test_ticket_and_project_system_tables_take_part_in_relations(engine):
    workspace, _, client = engine
    ticket = EntityType.objects.get(workspace=workspace, code="ticket", parent__isnull=True)
    project = EntityType.objects.get(workspace=workspace, code="project", parent__isnull=True)
    customer, _ = make_entity(engine, code="customer")
    contact, _ = make_entity(engine, code="contact")
    owner, _ = role_lookup(workspace)
    ticket_rule = relation(engine, ticket, customer, kind="many_to_one", left_title="مشتری", right_title="تیکت‌ها")
    project_rule = relation(
        engine,
        project,
        contact,
        kind="many_to_many",
        link_fields=[{"code": "role", "title": "نقش", "kind": "select", "lookup": "contact-role"}],
    )
    acme = create_record(engine, customer, {"title": "آکمه"})
    person = create_record(engine, contact, {"title": "مریم"})
    space = create_record(engine, project, {"title": "پروژه ارتباط"})
    work = create_record(
        engine,
        ticket,
        {"title": "تیکت مشتری", "project": space["id"], ticket_rule["left_field"]: acme["id"]},
    )
    # Reverse side: the customer lists the ticket through the related endpoint.
    related = client.get(
        endpoint(workspace, f"entities/customer/records/{acme['id']}/related/{ticket_rule['right_field']}/")
    )
    assert related.status_code == 200, related.data
    assert [row["id"] for row in related.data["results"]] == [work["id"]]
    assert EntityRecord.objects.get(entity=customer, id=acme["id"]).data[ticket_rule["right_field"]] == [work["id"]]
    # Project <-> contact with a role on the link.
    update(
        engine,
        project,
        space,
        {project_rule["left_field"]: [person["id"]]},
        relation_data={project_rule["left_field"]: [{"id": person["id"], "data": {"role": str(owner.id)}}]},
    )
    link = EntityRelation.objects.get(id=project_rule["id"]).links.get()
    assert str(link.left_id) == space["id"] and link.data == {"role": str(owner.id)}
    # Deleting the customer is blocked by default and the preview says why.
    preview = client.get(endpoint(workspace, f"entities/customer/records/{acme['id']}/delete-preview/"))
    assert preview.data["blocked"] and preview.data["impacts"][0]["opposite_entity"] == "ticket"
    assert client.delete(endpoint(workspace, f"entities/customer/records/{acme['id']}/?confirm_relations=true")).status_code == 400
