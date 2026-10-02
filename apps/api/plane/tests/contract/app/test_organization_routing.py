import pytest
from django.core.exceptions import ValidationError
from rest_framework import status

from plane.app.services import TicketRoutingService
from plane.db.models import (
    Issue,
    IssueAssignee,
    OrganizationPermission,
    OrganizationRole,
    OrganizationUnit,
    OrganizationUnitMember,
    Project,
    State,
    TicketRoleQueueEntry,
    TicketRoutingDecision,
    TicketRoutingRule,
    User,
    UserOrganizationRole,
    WorkspaceMember,
)


def add_member(workspace, username):
    user = User.objects.create_user(
        email=f"{username}@example.com",
        username=username,
        password="SafePass123!",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def create_issue(workspace):
    project = Project.objects.create(workspace=workspace, name="Routing Project", identifier="RTE")
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#999999",
        default=True,
    )
    return Issue.objects.create(project=project, state=state, name="Route this ticket")


@pytest.mark.django_db
def test_routing_climbs_to_eligible_parent_manager(workspace):
    parent_manager = add_member(workspace, "parent-manager")
    required_role = OrganizationRole.objects.create(workspace=workspace, name="Support manager", level=50)
    UserOrganizationRole.objects.create(
        workspace=workspace,
        user=parent_manager,
        role=required_role,
    )
    parent = OrganizationUnit.objects.create(workspace=workspace, title="Support", manager=parent_manager)
    child = OrganizationUnit.objects.create(workspace=workspace, title="Technical support", parent=parent)
    rule = TicketRoutingRule.objects.create(
        workspace=workspace,
        name="Technical escalation",
        unit=child,
        required_role=required_role,
        required_level=50,
    )
    issue = create_issue(workspace)

    decision = TicketRoutingService.route(issue, rule)

    assert decision.outcome == TicketRoutingDecision.Outcome.ASSIGNED
    assert decision.assigned_user == parent_manager
    assert decision.resolved_unit == parent
    assert IssueAssignee.objects.filter(issue=issue, assignee=parent_manager).exists()


@pytest.mark.django_db
def test_manager_without_required_role_is_sent_to_role_queue(workspace):
    manager = add_member(workspace, "wrong-role-manager")
    required_role = OrganizationRole.objects.create(workspace=workspace, name="Finance manager", level=50)
    other_role = OrganizationRole.objects.create(workspace=workspace, name="Sales expert", level=80)
    UserOrganizationRole.objects.create(workspace=workspace, user=manager, role=other_role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Finance", manager=manager)
    rule = TicketRoutingRule.objects.create(
        workspace=workspace,
        name="Finance approval",
        unit=unit,
        required_role=required_role,
        required_level=50,
    )
    issue = create_issue(workspace)

    decision = TicketRoutingService.route(issue, rule)

    assert decision.outcome == TicketRoutingDecision.Outcome.QUEUED
    assert decision.assigned_user is None
    assert TicketRoleQueueEntry.objects.filter(issue=issue, rule=rule, status="open").exists()


@pytest.mark.django_db
def test_organization_unit_rejects_cycles(workspace):
    parent = OrganizationUnit.objects.create(workspace=workspace, title="Parent")
    child = OrganizationUnit.objects.create(workspace=workspace, title="Child", parent=parent)
    parent.parent = child

    with pytest.raises(ValidationError):
        parent.full_clean()


@pytest.mark.django_db
def test_changing_team_manager_does_not_reassign_historical_tickets(workspace):
    previous_manager = add_member(workspace, "previous-manager")
    current_manager = add_member(workspace, "current-manager")
    required_role = OrganizationRole.objects.create(workspace=workspace, name="Sales manager", level=50)
    UserOrganizationRole.objects.bulk_create(
        [
            UserOrganizationRole(workspace=workspace, user=previous_manager, role=required_role),
            UserOrganizationRole(workspace=workspace, user=current_manager, role=required_role),
        ]
    )
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Sales", manager=previous_manager)
    rule = TicketRoutingRule.objects.create(
        workspace=workspace,
        name="Sales routing",
        unit=unit,
        required_role=required_role,
        required_level=50,
    )
    issue = create_issue(workspace)

    TicketRoutingService.route(issue, rule)
    unit.manager = current_manager
    unit.save(update_fields=["manager", "updated_at"])

    assert IssueAssignee.objects.filter(issue=issue, assignee=previous_manager).exists()
    assert not IssueAssignee.objects.filter(issue=issue, assignee=current_manager).exists()


@pytest.mark.django_db
def test_issue_create_api_runs_selected_routing_rule(session_client, workspace, create_user, mocker):
    required_role = OrganizationRole.objects.create(workspace=workspace, name="API manager", level=50)
    UserOrganizationRole.objects.create(workspace=workspace, user=create_user, role=required_role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="API support", manager=create_user)
    rule = TicketRoutingRule.objects.create(
        workspace=workspace,
        name="API support routing",
        unit=unit,
        required_role=required_role,
        required_level=50,
    )
    project = Project.objects.create(workspace=workspace, name="API Routing", identifier="API")
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#999999",
        default=True,
    )
    mocker.patch("plane.app.views.issue.base.issue_activity.delay")
    mocker.patch("plane.app.views.issue.base.model_activity.delay")
    mocker.patch("plane.app.views.issue.base.issue_description_version_task.delay")

    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
        {
            "name": "Route at creation",
            "state_id": str(state.id),
            "routing_rule_id": str(rule.id),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["routing_decision"]["outcome"] == TicketRoutingDecision.Outcome.ASSIGNED
    issue = Issue.objects.get(id=response.data["id"])
    assert IssueAssignee.objects.filter(issue=issue, assignee=create_user).exists()


@pytest.mark.django_db
def test_eligible_user_can_claim_role_queue_entry(session_client, workspace, create_user):
    required_role = OrganizationRole.objects.create(workspace=workspace, name="Queue specialist", level=30)
    UserOrganizationRole.objects.create(workspace=workspace, user=create_user, role=required_role)
    unit = OrganizationUnit.objects.create(workspace=workspace, title="Unmanaged queue")
    rule = TicketRoutingRule.objects.create(
        workspace=workspace,
        name="Queue fallback",
        unit=unit,
        required_role=required_role,
        required_level=30,
    )
    issue = create_issue(workspace)
    TicketRoutingService.route(issue, rule)
    entry = TicketRoleQueueEntry.objects.get(issue=issue, rule=rule)

    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/organization/role-queue/{entry.id}/claim/",
        {},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    entry.refresh_from_db()
    assert entry.status == TicketRoleQueueEntry.Status.CLAIMED
    assert entry.claimed_by == create_user
    assert IssueAssignee.objects.filter(issue=issue, assignee=create_user).exists()


@pytest.mark.django_db
def test_admin_can_manage_permissions_and_role_permission_links(session_client, workspace):
    permission_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/organization/permissions/",
        {
            "code": "ticket-approve",
            "name": "Approve tickets",
            "description": "Allows operational ticket approval",
        },
        format="json",
    )

    assert permission_response.status_code == status.HTTP_201_CREATED
    permission_id = permission_response.data["id"]
    role_response = session_client.post(
        f"/api/workspaces/{workspace.slug}/organization/roles/",
        {
            "name": "Approval manager",
            "level": 60,
            "permission_ids": [permission_id],
        },
        format="json",
    )

    assert role_response.status_code == status.HTTP_201_CREATED
    assert [str(value) for value in role_response.data["permission_ids"]] == [permission_id]
    assert OrganizationPermission.objects.filter(id=permission_id, is_active=True).exists()


@pytest.mark.django_db
def test_admin_updates_user_profile_with_independent_multi_roles_and_teams(session_client, workspace):
    member = add_member(workspace, "profile-member")
    first_role = OrganizationRole.objects.create(workspace=workspace, name="Senior sales", level=30)
    second_role = OrganizationRole.objects.create(workspace=workspace, name="Support manager", level=50)
    first_unit = OrganizationUnit.objects.create(workspace=workspace, title="Domestic sales")
    second_unit = OrganizationUnit.objects.create(workspace=workspace, title="Technical support")

    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/organization/users/{member.id}/",
        {
            "first_name": "Ali",
            "last_name": "Ahmadi",
            "display_name": "Ali Ahmadi",
            "username": "ali.enterprise",
            "email": "ali.enterprise@example.com",
            "password": "SafeNewPassword!2026",
            "is_active": True,
            "role_ids": [str(first_role.id), str(second_role.id)],
            "unit_ids": [str(first_unit.id), str(second_unit.id)],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    member.refresh_from_db()
    assert member.username == "ali.enterprise"
    assert member.check_password("SafeNewPassword!2026")
    assert set(UserOrganizationRole.objects.filter(user=member, is_active=True).values_list("role_id", flat=True)) == {
        first_role.id,
        second_role.id,
    }
    assert set(
        OrganizationUnitMember.objects.filter(user=member, is_active=True).values_list("unit_id", flat=True)
    ) == {first_unit.id, second_unit.id}
