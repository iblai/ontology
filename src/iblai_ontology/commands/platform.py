"""``ontology platform *`` — register iblai-ontology with the ibl.ai platform."""

from __future__ import annotations

import json
from typing import Optional

import typer

app = typer.Typer(
    no_args_is_help=True, help="ibl.ai platform integration (MCP server registration)."
)


@app.command()
def register(
    name: str = typer.Option("iblai-ontology", help="MCP server name in the platform."),
    url: str = typer.Option(
        ..., help="Public MCP endpoint, e.g. https://ontology.alasu.edu/mcp"
    ),
    description: str = typer.Option("", help="Server description."),
    auth_scope: str = typer.Option("user", help="user | agent | platform"),
) -> None:
    """Register iblai-ontology as an MCP Server in the ibl.ai platform."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.ibl_platform.client import PlatformClient

    result = PlatformClient().register_mcp_server(
        name=name, url=url, description=description, auth_scope=auth_scope
    )
    typer.echo(json.dumps(result, indent=2))


@app.command()
def connect(
    server: int = typer.Option(..., help="MCP server id returned by `register`."),
    scope: str = typer.Option("user", help="user | agent | platform"),
    role: Optional[str] = typer.Option(None, help="Role to forward via X-Iblai-Role."),
    user: Optional[str] = typer.Option(None, help="Username (for user scope)."),
    agent: Optional[str] = typer.Option(None, help="Agent UUID (for agent scope)."),
) -> None:
    """Create an MCP Server Connection (carries the role via extra_headers)."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.ibl_platform.client import PlatformClient

    result = PlatformClient().create_connection(
        server=server, scope=scope, role=role, user=user, agent=agent
    )
    typer.echo(json.dumps(result, indent=2))


@app.command()
def attach(
    agent_id: str = typer.Argument(..., help="Agent UUID."),
    server: int = typer.Option(..., help="MCP server id."),
) -> None:
    """Attach the ontology MCP server to an agent and enable the MCP tool."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.ibl_platform.client import PlatformClient

    result = PlatformClient().attach_to_agent(agent_id=agent_id, server_id=server)
    typer.echo(json.dumps(result, indent=2))
