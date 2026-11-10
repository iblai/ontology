"""``ontology service *`` — manage source-system integrations (Components 5 & 6)."""

from __future__ import annotations

from enum import Enum
from typing import Optional

import typer

from iblai_ontology.ui import console

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
    snowflake = "snowflake"
    generic_trino = "generic-trino"
    generic_clickhouse = "generic-clickhouse"


@app.command()
def add(
    name: str = typer.Option(..., prompt="Service name"),
    from_catalog: Optional[str] = typer.Option(
        None,
        "--from",
        help="Prefill from a catalog key (e.g. peoplesoft, snowflake, canvas).",
    ),
    skill: Optional[str] = typer.Option(
        None, "--skill", help="Seed from a SKILL.md (vendored name, path, or URL)."
    ),
    service_type: Optional[ServiceType] = typer.Option(
        None, help="Service type (database adapters)."
    ),
    host: Optional[str] = typer.Option(None, help="Database host."),
    port: Optional[int] = typer.Option(None, help="Database port."),
    database: Optional[str] = typer.Option(None, help="Database/SID name."),
    user: Optional[str] = typer.Option(None, help="Database user."),
    password: Optional[str] = typer.Option(None, help="Database password."),
    option: Optional[list[str]] = typer.Option(
        None,
        "--option",
        help="Extra connection field as KEY=VALUE (warehouse, schema, http_scheme); repeatable.",
    ),
    llm_discover: bool = typer.Option(
        True, help="Use LLM to analyze schema and generate config."
    ),
    skip_safety: bool = typer.Option(
        False, help="Skip read-only safety check (NOT recommended)."
    ),
) -> None:
    """Add a new source system integration.

    Three ways to seed it:
      * --from <catalog-key>  prefill connection shape from the built-in catalog
      * --skill <name>        seed from a SKILL.md (API sources)
      * (neither)             enter database connection details directly

    Database sources run the full pipeline: connect → verify read-only (CRITICAL)
    → introspect → optional LLM analysis → provision. API sources are served via
    custom MCP servers; `--skill` prints the connection + read-only tools to wire.
    """
    from iblai_ontology.catalog import get_entry

    entry = None
    if from_catalog:
        try:
            entry = get_entry(from_catalog)
        except KeyError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(code=1)
        console.print(
            f"Seeding from catalog: [brand]{entry.display_name}[/brand] ({entry.type})"
        )
        if entry.env:
            console.print(f"  required env: {', '.join(entry.env)}")

    # API sources (catalog or skill) are served by a custom MCP server, not introspected:
    # register the service with the catalog's schedules and show the skill's read-only tools.
    if skill or (entry and entry.type == "api"):
        ref = skill or (entry.skill or "").removesuffix(".md")
        from iblai_ontology.commands.skill import import_skill

        if ref:
            console.print(
                f"[highlight]API source[/highlight] — discovery seed from skill '{ref}':"
            )
            import_skill(ref)
        from iblai_ontology.backend import bootstrap

        bootstrap()
        from iblai_ontology.backend.discovery.engine import DiscoveryEngine

        DiscoveryEngine().register_api(
            name=name, adapter=entry.adapter if entry else ref
        )
        var = f"MCP_{name.upper().replace('-', '_')}_URL"
        console.print()
        console.print(
            f"[dim]Registered '{name}'. Run its MCP server (see mcp-servers/) and point "
            f"{var} at it, then approve and sync.[/dim]"
        )
        return

    # Database source — fill defaults from the catalog, prompt for the rest.
    default_type = entry.adapter if entry else None
    if service_type is None:
        service_type = ServiceType(
            typer.prompt("Service type", default=default_type or "generic-postgres")
        )
    if port is None and entry and entry.connection.get("default_port"):
        port = int(entry.connection["default_port"])
    from iblai_ontology.backend.discovery.adapters import get_adapter
    from iblai_ontology.backend.discovery.connectors import PORTLESS

    options: dict[str, str] = {}
    for item in option or []:
        key, sep, value = item.partition("=")
        if not sep or not key:
            raise typer.BadParameter(
                f"expected KEY=VALUE, got {item!r}", param_hint="--option"
            )
        options[key] = value
    host = host or typer.prompt("Database host")
    if not port and get_adapter(service_type.value).DB_TYPE not in PORTLESS:
        port = int(typer.prompt("Database port"))
    database = database or typer.prompt("Database/SID name")
    user = user or typer.prompt("Database user")
    password = password or typer.prompt("Database password", hide_input=True)

    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine

    DiscoveryEngine().run(
        name=name,
        service_type=service_type.value,
        host=host,
        port=port or 0,
        database=database,
        user=user,
        password=password,
        use_llm=llm_discover,
        options=options,
        skip_safety=skip_safety,
    )


@app.command(name="list")
def list_services() -> None:
    """List all integrated services with status."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.utils.output import print_table

    print_table(
        title="Integrated Services",
        columns=["Name", "Type", "Host", "Status", "Last Sync", "Tables"],
        rows=[
            [
                s.name,
                s.service_type,
                s.host,
                s.status,
                s.last_sync_at or "Never",
                s.tables_synced,
            ]
            for s in store.filter(Service)
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
def schema(
    name: str = typer.Argument(..., help="Service name"),
    top: int = typer.Option(20, help="Show the top N tables by row count."),
) -> None:
    """Show the discovered schema (manifest summary) for a service."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    try:
        service = store.get(Service, name=name)
    except Service.DoesNotExist:
        typer.echo(
            f"Service '{name}' not found. Run `ontology service discover {name}` first.",
            err=True,
        )
        raise typer.Exit(code=1)
    manifest = service.schema_manifest or {}
    tables = sorted(
        manifest.get("tables", []), key=lambda t: t.get("row_count", 0), reverse=True
    )
    if not tables:
        typer.echo("No schema discovered yet. Run `ontology service discover` first.")
        raise typer.Exit(code=1)
    from iblai_ontology.utils.output import print_table

    console.print(
        f"[brand]{name}[/brand] — {manifest.get('db_type', '?')} | "
        f"{manifest.get('total_tables', len(tables))} tables, "
        f"{manifest.get('total_rows', 0):,} rows"
    )
    print_table(
        title=f"Top {top} tables",
        columns=["Schema", "Table", "Rows", "Columns"],
        rows=[
            [
                t.get("schema_name", ""),
                t.get("table_name", ""),
                f"{t.get('row_count', 0):,}",
                t.get("column_count", len(t.get("columns") or [])),
            ]
            for t in tables[:top]
        ],
    )


@app.command()
def connection(name: str = typer.Argument(..., help="Service name")) -> None:
    """Show a service's stored connection (secrets redacted)."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.encryption import decrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    try:
        service = store.get(Service, name=name)
    except Service.DoesNotExist:
        typer.echo(f"Service '{name}' not found.", err=True)
        raise typer.Exit(code=1)
    config = (
        decrypt_connection_config(service.connection_config_encrypted)
        if service.connection_config_encrypted
        else {}
    )
    console.print(
        f"[brand]{service.display_name}[/brand]  [dim]({service.adapter})[/dim]"
    )
    for key, value in config.items():
        shown = (
            "********"
            if key.lower() in ("password", "secret", "api_key", "token")
            else value
        )
        console.print(f"  {key}: {shown}")


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


@app.command(name="map")
def map_tables(
    name: str = typer.Argument(..., help="Service name."),
    sample_rows: Optional[int] = typer.Option(
        None,
        help="Sample rows per table sent to the LLM (default llm.sample_rows; 0 = names and types only).",
    ),
    from_catalog: Optional[str] = typer.Option(
        None,
        "--from",
        help="Apply this catalog entry's vendor mapping (e.g. twenty) instead of asking the LLM.",
    ),
) -> None:
    """Ask the configured LLM how each discovered table maps onto the house entities.

    The answer is recorded as table edits (entity, column renames, memory template,
    entity group, description): review it in the console, then approve to regenerate.
    """
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine

    mapped = DiscoveryEngine().map(name, sample_rows=sample_rows, catalog=from_catalog)
    for table, m in mapped.items():
        renames = ", ".join(f"{k}→{v}" for k, v in (m.get("fields") or {}).items())
        console.print(f"  {table} → {m.get('entity') or '(unchanged)'}  {renames}")
    console.print(f"[success]Mapped {len(mapped)} table(s) for '{name}'.[/success]")
