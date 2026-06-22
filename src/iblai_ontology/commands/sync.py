"""``ontology sync *`` — sync operations (Component 2)."""

from __future__ import annotations

from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Sync operations.")


@app.command()
def run(
    service: Optional[str] = typer.Argument(None, help="Service name (all due if omitted)."),
    schedule: Optional[str] = typer.Option(None, help="Specific schedule name."),
    full: bool = typer.Option(False, help="Force full refresh (ignore delta)."),
) -> None:
    """Run syncs now. Omit the service name to run all due syncs."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.sync.engine import SyncRunner

    runner = SyncRunner()
    if service:
        runner.run_service(service, schedule_name=schedule, force_full=full)
    else:
        runner.run_all_due(force_full=full)


@app.command()
def status() -> None:
    """Show sync status for all services."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.sync.models import SyncRun
    from iblai_ontology.utils.output import print_table

    # Latest run per schedule (DB-agnostic — dedupe in Python, no DISTINCT ON).
    latest = {}
    for r in SyncRun.objects.order_by("-started_at"):
        latest.setdefault(r.schedule_name, r)
    latest = list(latest.values())
    print_table(
        title="Sync Status",
        columns=["Schedule", "Service", "Status", "Last Run", "Duration", "Records"],
        rows=[
            [r.schedule_name, r.source_system, r.status, r.started_at,
             f"{r.duration_seconds}s", r.records_processed]
            for r in latest
        ],
    )


@app.command()
def history(
    service: Optional[str] = typer.Argument(None, help="Filter by service."),
    limit: int = typer.Option(20, help="Number of runs to show."),
) -> None:
    """Show sync run history."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.sync.models import SyncRun
    from iblai_ontology.utils.output import print_table

    qs = SyncRun.objects.all()
    if service:
        qs = qs.filter(source_system=service)
    runs = qs.order_by("-started_at")[:limit]
    print_table(
        title="Sync History",
        columns=["ID", "Schedule", "Status", "Started", "Duration", "Created", "Updated", "Error"],
        rows=[
            [str(r.id)[:8], r.schedule_name, r.status, r.started_at,
             f"{r.duration_seconds}s", r.records_created, r.records_updated,
             (r.error_message or "")[:50]]
            for r in runs
        ],
    )


@app.command()
def schedule() -> None:
    """Show current sync schedules."""
    from iblai_ontology.config.reader import ConfigReader
    from iblai_ontology.utils.output import print_table

    schedules = ConfigReader().get_sync_schedules()
    print_table(
        title="Sync Schedules",
        columns=["Name", "Cron", "Source", "Tool", "Description"],
        rows=[
            [s["name"], s["cron"], s["source"], s["tool"], s.get("description", "")]
            for s in schedules
        ],
    )
