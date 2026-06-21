"""``ontology health *`` — health checks and diagnostics."""

from __future__ import annotations

import typer

app = typer.Typer(help="Health checks and diagnostics.")


@app.callback(invoke_without_command=True)
def health_check(ctx: typer.Context) -> None:
    """Overall system health check (runs all sub-checks when no subcommand given)."""
    if ctx.invoked_subcommand is None:
        db()
        mcp()
        sync_health()
        storage()


@app.command()
def db() -> None:
    """PostgreSQL cache health."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_db

    result = check_db()
    typer.echo(f"PostgreSQL: {'OK' if result.healthy else 'UNHEALTHY'}")
    typer.echo(f"  Tables: {result.table_count} | Rows: {result.total_rows:,}")
    typer.echo(
        f"  Size: {result.size_mb:.1f} MB | Connections: {result.active_connections}"
    )


@app.command()
def mcp() -> None:
    """MCP server connectivity."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_mcp_servers

    for name, r in check_mcp_servers().items():
        status = "OK" if r.reachable else "UNREACHABLE"
        typer.echo(f"  {name}: {status} ({r.latency_ms}ms, {r.tool_count} tools)")


@app.command(name="sync")
def sync_health() -> None:
    """Sync engine status."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_sync

    result = check_sync()
    typer.echo(f"Sync engine: {'RUNNING' if result.running else 'STOPPED'}")
    typer.echo(f"  Schedules: {result.total_schedules}")
    typer.echo(f"  Failed (last 24h): {result.failed_last_24h}")
    typer.echo(f"  Next due: {result.next_due_schedule} at {result.next_due_at}")


@app.command()
def storage() -> None:
    """Disk usage for text memories."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_storage

    result = check_storage()
    typer.echo(f"Text memories: {result.total_files:,} files, {result.total_size_mb:.1f} MB")
    for domain, stats in result.by_domain.items():
        typer.echo(f"  /ontology/{domain}/: {stats['files']} files, {stats['size_mb']:.1f} MB")
