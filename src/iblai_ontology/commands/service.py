"""``ontology service *`` — manage source-system integrations (Components 5 & 6)."""

from __future__ import annotations

from enum import Enum
from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Manage source system integrations.")


class ServiceType(str, Enum):
    peoplesoft = "peoplesoft"
    banner = "banner"
    workday = "workday"
    canvas = "canvas"
    slate = "slate"
    navigate = "navigate"
    generic_oracle = "generic-oracle"
    generic_postgres = "generic-postgres"
    generic_mysql = "generic-mysql"
    generic_mssql = "generic-mssql"


@app.command()
def add(
    name: str = typer.Option(..., prompt="Service name"),
    service_type: ServiceType = typer.Option(..., prompt="Service type"),
    host: str = typer.Option(..., prompt="Database host"),
    port: int = typer.Option(..., prompt="Database port"),
    database: str = typer.Option(..., prompt="Database/SID name"),
    user: str = typer.Option(..., prompt="Database user"),
    password: str = typer.Option(..., prompt="Database password", hide_input=True),
    llm_discover: bool = typer.Option(True, help="Use LLM to analyze schema and generate config."),
    skip_safety: bool = typer.Option(False, help="Skip read-only safety check (NOT recommended)."),
) -> None:
    """Add a new source system integration.

    Runs the full discovery pipeline: connect → verify read-only (CRITICAL) →
    introspect schema → optional LLM analysis → provision (cache, MCP tools,
    sync schedules).
    """
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine

    DiscoveryEngine().run(
        name=name,
        service_type=service_type.value,
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        use_llm=llm_discover,
        skip_safety=skip_safety,
    )


@app.command(name="list")
def list_services() -> None:
    """List all integrated services with status."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.utils.output import print_table

    print_table(
        title="Integrated Services",
        columns=["Name", "Type", "Host", "Status", "Last Sync", "Tables"],
        rows=[
            [s.name, s.service_type, s.host, s.status, s.last_sync_at or "Never", s.tables_synced]
            for s in Service.objects.all()
        ],
    )


@app.command()
def status(name: str = typer.Argument(..., help="Service name")) -> None:
    """Health check for a specific service (connectivity, sync status)."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.services.health import check_connectivity

    result = check_connectivity(name)
    typer.echo(f"Connectivity: {'OK' if result.connected else 'FAILED'}")
    typer.echo(f"Read-only verified: {'YES' if result.read_only else 'NO'}")
    typer.echo(f"Latency: {result.latency_ms}ms")


@app.command()
def test(name: str = typer.Argument(..., help="Service name")) -> None:
    """Run the full read-only safety + connectivity test suite."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.services.health import full_safety_report

    report = full_safety_report(name)
    for check in report.checks:
        icon = "PASS" if check.passed else "FAIL"
        typer.echo(f"  [{icon}] {check.description}")
    if report.all_passed:
        typer.echo("All safety checks passed.")
    else:
        typer.echo("SAFETY CHECK FAILED. Do NOT proceed.", err=True)
        raise typer.Exit(code=1)


@app.command()
def discover(
    name: str = typer.Argument(..., help="Service name"),
    llm: bool = typer.Option(True, help="Use LLM for analysis."),
) -> None:
    """Re-run schema discovery on an existing service."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine

    DiscoveryEngine().rediscover(name, use_llm=llm)


@app.command()
def approve(name: str = typer.Argument(..., help="Service name")) -> None:
    """Approve generated config and provision the service."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine

    ProvisioningEngine().provision(name)


@app.command(name="sync")
def sync_service(name: str = typer.Argument(..., help="Service name")) -> None:
    """Trigger a manual sync for a specific service."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.sync.engine import SyncRunner

    SyncRunner().run_service(name)


@app.command()
def remove(
    name: str = typer.Argument(..., help="Service name"),
    confirm: bool = typer.Option(False, "--yes", help="Skip confirmation."),
) -> None:
    """Remove a service integration (drops cache tables, removes config)."""
    if not confirm:
        typer.confirm(f"Remove service '{name}' and all its cached data?", abort=True)
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine

    ProvisioningEngine().teardown(name)
    typer.echo(f"Service '{name}' removed.")
