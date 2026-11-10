"""``ontology roles *`` — role and permission management (Component 3)."""

from __future__ import annotations

from pathlib import Path

import typer

app = typer.Typer(no_args_is_help=True, help="Role and permission management.")


def _roles() -> tuple[dict, str]:
    """The roles the gateway resolves, and where they are kept."""
    from iblai_ontology.config import dm_store

    if dm_store():
        from iblai_ontology.backend import bootstrap

        bootstrap()  # the platform's roles are cached in Django's cache
    from iblai_ontology.backend.identity import role_source

    source = "the ibl.ai platform" if dm_store() else "roles.yaml"
    return role_source.reader().get_roles(), source


@app.command(name="list")
def list_roles() -> None:
    """List all roles defined in roles.yaml, or in the ibl.ai platform in dm mode."""
    from iblai_ontology.utils.output import print_table

    roles, source = _roles()
    print_table(
        title=f"Defined Roles ({source})",
        columns=["Role", "Display Name", "Toolsets", "Memory Paths", "Cache Tables"],
        rows=[
            [
                name,
                r.get("display_name", ""),
                ", ".join(r.get("mcp_toolsets", [])),
                len(r.get("memory_paths", [])),
                ", ".join(r.get("cache_tables", []))[:40],
            ]
            for name, r in roles.items()
        ],
    )


@app.command()
def show(role: str = typer.Argument(..., help="Role name")) -> None:
    """Show full permissions for a role."""
    import yaml

    roles, _ = _roles()
    if role not in roles:
        typer.echo(f"Role '{role}' not found.", err=True)
        raise typer.Exit(code=1)
    typer.echo(
        yaml.dump({role: roles[role]}, default_flow_style=False, sort_keys=False)
    )


@app.command()
def validate() -> None:
    """Check each role's toolsets exist (the ibl.ai platform's roles in dm mode)."""
    from iblai_ontology.config.validator import ConfigValidator

    roles, _ = _roles()
    result = ConfigValidator().validate_roles(roles)
    for issue in result.issues:
        sev = "WARN" if issue.severity == "warning" else "ERR"
        typer.echo(f"  [{sev}] {issue.message}")
    if result.all_valid:
        typer.echo("All roles valid.")
    else:
        raise typer.Exit(code=1)


@app.command(name="import")
def import_roles(
    path: Path = typer.Argument(..., help="The roles.yaml to copy."),
) -> None:
    """Copy a roles.yaml into the ibl.ai platform (ONTOLOGY_DATA_STORE=dm)."""
    import yaml

    from iblai_ontology.config import dm_store

    if not dm_store():
        typer.echo("Not in dm mode: the file is the store already.", err=True)
        raise typer.Exit(code=1)
    if not path.exists():
        typer.echo(f"{path} not found.", err=True)
        raise typer.Exit(code=1)
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.identity import role_source

    # Read raw, so ${USER_EMPLID} is stored as written.
    roles = (yaml.safe_load(path.read_text()) or {}).get("roles") or {}
    refused = False
    for name, spec in roles.items():
        try:
            role_source.put_role(name, spec)
        except RuntimeError as exc:  # the reason, and on to the next role
            refused = True
            typer.echo(f"{name}: {exc}", err=True)
        else:
            typer.echo(name)
    if refused:
        raise typer.Exit(code=1)
