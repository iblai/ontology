"""``ontology roles *`` — role and permission management (Component 3)."""

from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=True, help="Role and permission management.")


@app.command(name="list")
def list_roles() -> None:
    """List all roles defined in roles.yaml."""
    from iblai_ontology.config.reader import ConfigReader
    from iblai_ontology.utils.output import print_table

    roles = ConfigReader().get_roles()
    print_table(
        title="Defined Roles",
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

    from iblai_ontology.config.reader import ConfigReader

    roles = ConfigReader().get_roles()
    if role not in roles:
        typer.echo(f"Role '{role}' not found.", err=True)
        raise typer.Exit(code=1)
    typer.echo(
        yaml.dump({role: roles[role]}, default_flow_style=False, sort_keys=False)
    )


@app.command()
def validate() -> None:
    """Validate roles.yaml against available toolsets and memory paths."""
    from iblai_ontology.config.validator import ConfigValidator

    result = ConfigValidator().validate_roles()
    for issue in result.issues:
        sev = "WARN" if issue.severity == "warning" else "ERR"
        typer.echo(f"  [{sev}] {issue.message}")
    if result.all_valid:
        typer.echo("All roles valid.")
    else:
        raise typer.Exit(code=1)
