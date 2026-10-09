from django.core.management.base import BaseCommand
from django.db import transaction

from plane.app.services.permission_registry import bootstrap_workspace_access
from plane.db.models import Workspace


class Command(BaseCommand):
    help = "Synchronize the developer-owned CRM catalog and initialize missing default assignments."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", help="Workspace slug; omit to synchronize all workspaces")

    def handle(self, *args, **options):
        rows = Workspace.objects.all()
        if options["workspace"]:
            rows = rows.filter(slug=options["workspace"])
        for workspace in rows:
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=workspace.pk)
                bootstrap_workspace_access(workspace)
            self.stdout.write(self.style.SUCCESS(f"Synchronized {workspace.slug}"))
