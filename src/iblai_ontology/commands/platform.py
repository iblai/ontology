"""``ontology platform *`` — register iblai-ontology with the ibl.ai platform."""

from __future__ import annotations

import json
import os
from typing import Optional

import typer

app = typer.Typer(
    no_args_is_help=True,
    help="ibl.ai platform integration (MCP server registration).",
)


def _service_credentials() -> Optional[str]:
    """The authorization value the platform sends: the service token, never an option."""
    token = os.environ.get("ONTOLOGY_SERVICE_TOKEN")
    return f"Bearer {token}" if token else None


@app.command()
def register(
    name: str = typer.Option("iblai-ontology", help="MCP server name in the platform."),
    url: str = typer.Option(
        ..., help="Public MCP endpoint, e.g. https://ontology.alasu.edu/mcp"
    ),
    description: str = typer.Option("", help="Server description."),
    auth_type: str = typer.Option(
        "oauth2",
        help="none | token | oauth2. none/token send ONTOLOGY_SERVICE_TOKEN as `Bearer <token>`.",
    ),
    auth_scope: str = typer.Option("platform", help="platform | mentor | user"),
    role: Optional[str] = typer.Option(
        None, help="X-Iblai-Role every call carries (a roles.yaml role)."
    ),
) -> None:
    """Register iblai-ontology as an MCP Server in the ibl.ai platform.

    With --auth-type none and ONTOLOGY_SERVICE_TOKEN set, one command is enough: the
    platform sends the token and the role on every call, no connection record needed.
    """
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.platform.client import PlatformClient

    credentials = _service_credentials() if auth_type in ("none", "token") else None
    if auth_type in ("none", "token") and not credentials:
        typer.echo("ONTOLOGY_SERVICE_TOKEN is not set.", err=True)
        raise typer.Exit(code=1)
    result = PlatformClient().register_mcp_server(
        name=name,
        url=url,
        description=description,
        auth_type=auth_type,
        auth_scope=auth_scope,
        credentials=credentials,
        extra_headers={"X-Iblai-Role": role} if role else None,
    )
    typer.echo(json.dumps(result, indent=2))


@app.command()
def connect(
    server: int = typer.Option(..., help="MCP server id returned by `register`."),
    scope: str = typer.Option("platform", help="platform | mentor | user"),
    role: Optional[str] = typer.Option(None, help="Role to forward via X-Iblai-Role."),
    user: Optional[str] = typer.Option(None, help="Username (for user scope)."),
    agent: Optional[str] = typer.Option(
        None, help="Agent (mentor) id for mentor scope."
    ),
    auth_type: str = typer.Option(
        "oauth2", help="oauth2 | token | none. token sends ONTOLOGY_SERVICE_TOKEN."
    ),
) -> None:
    """Create an MCP Server Connection: a role (and credential) for one agent, user or platform."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.platform.client import PlatformClient

    token = os.environ.get("ONTOLOGY_SERVICE_TOKEN") if auth_type == "token" else None
    if auth_type == "token" and not token:
        typer.echo("ONTOLOGY_SERVICE_TOKEN is not set.", err=True)
        raise typer.Exit(code=1)
    result = PlatformClient().create_connection(
        server=server,
        scope=scope,
        role=role,
        user=user,
        mentor=agent,
        auth_type=auth_type,
        credentials=token,
    )
    typer.echo(json.dumps(result, indent=2))


@app.command()
def address(
    url: str = typer.Option(
        ..., help="This backend's public base URL, e.g. https://ontology.alasu.edu"
    ),
) -> None:
    """Record where this backend is reached, for the hosted Ontology Frontend to find it.

    Kept in the platform as the ontology record backend/default; the frontend reads it
    with the signed-in admin's own token and sends that admin's calls here.
    """
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    local = parts.hostname in ("localhost", "127.0.0.1", "::1")
    schemes = {"https", "http"} if local else {"https"}
    if not parts.hostname or parts.scheme not in schemes:
        # The frontend refuses anything else: it would send a user's token in the clear.
        typer.echo("The address must be an https URL (http for localhost).", err=True)
        raise typer.Exit(code=1)
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend import store

    try:
        store.put_record("backend", "default", {"url": url.rstrip("/")})
    except RuntimeError as exc:  # the platform's own words, or the missing credentials
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)
    typer.echo(f"{store.client().config.org}: {url.rstrip('/')}")


@app.command()
def attach(
    agent_id: str = typer.Argument(..., help="Agent (mentor) id."),
    server: int = typer.Option(..., help="MCP server id."),
) -> None:
    """Attach the ontology MCP server to an agent and enable its MCP tool."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.platform.client import PlatformClient

    result = PlatformClient().attach_to_agent(agent_id=agent_id, server_id=server)
    typer.echo(json.dumps(result, indent=2))
