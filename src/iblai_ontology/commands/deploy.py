"""``ontology deploy *`` — Docker Compose deployment lifecycle."""

from __future__ import annotations

from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Docker Compose deployment lifecycle.")


@app.command()
def up(
    detach: bool = typer.Option(True, "-d/--no-detach", help="Run in background."),
    build: bool = typer.Option(False, help="Rebuild images."),
) -> None:
    """Start all services (docker compose up)."""
    from iblai_ontology.backend.mcp_server.toolbox_config import write_toolbox_config
    from iblai_ontology.config import config_dir
    from iblai_ontology.utils.docker import compose_up

    # Regenerate the Toolbox-native config the mcp-toolbox container mounts.
    src = config_dir() / "tools.yaml"
    if src.exists():
        try:
            result = write_toolbox_config(
                src, config_dir() / "generated" / "toolbox.yaml"
            )
        except Exception as exc:  # surface a clean message, not a traceback
            typer.echo(f"Failed to generate toolbox config from {src}: {exc}", err=True)
            raise typer.Exit(code=1)
        typer.echo(
            f"Generated toolbox config: {result.sources} sources, {result.tools} tools."
        )

    raise typer.Exit(code=compose_up(detach=detach, build=build))


@app.command()
def down(volumes: bool = typer.Option(False, help="Remove volumes.")) -> None:
    """Stop all services (docker compose down)."""
    from iblai_ontology.utils.docker import compose_down

    raise typer.Exit(code=compose_down(remove_volumes=volumes))


@app.command()
def logs(
    service: Optional[str] = typer.Argument(None, help="Service name."),
    follow: bool = typer.Option(False, "-f", help="Follow logs."),
    tail: int = typer.Option(100, help="Number of lines."),
) -> None:
    """View service logs."""
    from iblai_ontology.utils.docker import compose_logs

    raise typer.Exit(code=compose_logs(service=service, follow=follow, tail=tail))


@app.command()
def restart(
    service: Optional[str] = typer.Argument(None, help="Service name."),
) -> None:
    """Restart services."""
    from iblai_ontology.utils.docker import compose_restart

    raise typer.Exit(code=compose_restart(service=service))


@app.command()
def status() -> None:
    """Show container status."""
    from iblai_ontology.utils.docker import compose_ps

    raise typer.Exit(code=compose_ps())
