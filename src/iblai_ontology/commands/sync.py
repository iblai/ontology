"""``ontology sync *`` — sync operations (Component 2)."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Sync operations.")


@app.command()
def run(
    service: Optional[str] = typer.Argument(
        None, help="Service name (all due if omitted)."
    ),
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
    from iblai_ontology.backend.sync.engine import latest_runs
    from iblai_ontology.utils.output import print_table

    latest = latest_runs()
    print_table(
        title="Sync Status",
        columns=["Schedule", "Service", "Status", "Last Run", "Duration", "Records"],
        rows=[
            [
                r.schedule_name,
                r.source_system,
                r.status,
                r.started_at,
                f"{r.duration_seconds}s",
                r.records_processed,
            ]
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
    from iblai_ontology.backend import store
    from iblai_ontology.backend.sync.models import SyncRun
    from iblai_ontology.utils.output import print_table

    where = {"source_system": service} if service else {}
    runs = store.filter(SyncRun, order="-started_at", limit=limit, **where)
    print_table(
        title="Sync History",
        columns=[
            "ID",
            "Schedule",
            "Status",
            "Started",
            "Duration",
            "Created",
            "Updated",
            "Error",
        ],
        rows=[
            [
                str(r.id)[:8],
                r.schedule_name,
                r.status,
                r.started_at,
                f"{r.duration_seconds}s",
                r.records_created,
                r.records_updated,
                (r.error_message or "")[:50],
            ]
            for r in runs
        ],
    )


@app.command()
def schedule() -> None:
    """Show current sync schedules."""
    from iblai_ontology.backend.sync import schedules
    from iblai_ontology.config import dm_store
    from iblai_ontology.utils.output import print_table

    source = "the ibl.ai platform" if dm_store() else "sync-schedules.yaml"
    print_table(
        title=f"Sync Schedules ({source})",
        columns=["Name", "Cron", "Source", "Tool or Table", "Description"],
        rows=[
            # A table schedule has no tool, an event-driven one no cron.
            [
                s["name"],
                s.get("cron", ""),
                s.get("source", ""),
                s.get("tool") or s.get("table", ""),
                s.get("description", ""),
            ]
            for s in schedules.all()
        ],
    )


@app.command(name="import")
def import_schedules(
    path: Optional[Path] = typer.Argument(
        None, help="A sync-schedules.yaml (default: the config directory's)."
    ),
) -> None:
    """Copy a sync-schedules.yaml into the ibl.ai platform (ONTOLOGY_DATA_STORE=dm)."""
    import yaml

    from iblai_ontology.backend.sync import schedules
    from iblai_ontology.config import config_dir, dm_store

    source = path or config_dir() / "sync-schedules.yaml"
    if not dm_store():
        typer.echo("Not in dm mode: the file is the store already.", err=True)
        raise typer.Exit(code=1)
    if not source.exists():
        typer.echo(f"{source} not found.", err=True)
        raise typer.Exit(code=1)
    # Read raw, so ${VAR} is stored as written.
    for spec in (yaml.safe_load(source.read_text()) or {}).get("schedules") or []:
        schedules.upsert(spec)
        typer.echo(spec["name"])
