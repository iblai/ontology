"""CLI entry point — ``ontology <command>``.

The full command surface is composed here from :mod:`iblai_ontology.commands`:

    ontology service   manage source-system integrations (Components 5 & 6)
    ontology config    configuration management
    ontology sync      sync operations (Component 2)
    ontology roles     role and permission management (Component 3)
    ontology health    health checks and diagnostics
    ontology data      query / search / inspect the knowledge layer
    ontology deploy    Docker Compose deployment lifecycle
    ontology mcp       MCP server administration (Component 4)
"""

from __future__ import annotations

import typer

from iblai_ontology import __version__
from iblai_ontology.commands import (
    config,
    data,
    deploy,
    health,
    mcp,
    platform,
    roles,
    service,
    skill,
    sync,
)

app = typer.Typer(
    name="ontology",
    help="iblai-ontology: on-premise knowledge layer management CLI.",
    no_args_is_help=True,
    add_completion=False,
)

app.add_typer(service.app, name="service")
app.add_typer(config.app, name="config")
app.add_typer(sync.app, name="sync")
app.add_typer(roles.app, name="roles")
app.add_typer(health.app, name="health")
app.add_typer(data.app, name="data")
app.add_typer(deploy.app, name="deploy")
app.add_typer(mcp.app, name="mcp")
app.add_typer(platform.app, name="platform")
app.add_typer(skill.app, name="skill")


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"ontology {__version__}")
        raise typer.Exit()


@app.callback()
def root(
    version: bool = typer.Option(
        False,
        "--version",
        "-v",
        help="Show version and exit.",
        callback=_version_callback,
        is_eager=True,
    ),
) -> None:
    """iblai-ontology: on-premise knowledge layer management CLI."""


if __name__ == "__main__":
    app()
