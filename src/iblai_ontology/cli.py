"""CLI entry point — ``ontology <command>``.

This is a minimal root app; the full command surface (service, config, sync,
roles, health, data, deploy, mcp) is wired in :mod:`iblai_ontology.commands`.
"""

from __future__ import annotations

import typer

from iblai_ontology import __version__

app = typer.Typer(
    name="ontology",
    help="iblai-ontology: on-premise knowledge layer management CLI.",
    no_args_is_help=True,
    add_completion=False,
)


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
