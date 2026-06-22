"""``ontology mcp *`` — MCP server administration (Component 4)."""

from __future__ import annotations

from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="MCP server administration.")


@app.command()
def status() -> None:
    """MCP outbound server status."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_mcp_gateway

    result = check_mcp_gateway()
    typer.echo(f"MCP Gateway: {'RUNNING' if result.running else 'STOPPED'}")
    typer.echo(f"  URL: {result.url}")
    typer.echo(f"  Tools: {result.tool_count} | Toolsets: {result.toolset_count}")
    typer.echo(f"  Active sessions: {result.active_sessions}")


@app.command()
def tools() -> None:
    """List all exposed MCP tools."""
    from iblai_ontology.config.reader import ConfigReader
    from iblai_ontology.utils.output import print_table

    print_table(
        title="MCP Tools",
        columns=["Name", "Type", "Source", "Description"],
        rows=[
            [t["name"], t.get("type", ""), t.get("source", ""), t.get("description", "")[:60]]
            for t in ConfigReader().get_tools()
        ],
    )


@app.command()
def toolsets() -> None:
    """List all toolsets with their tools."""
    from iblai_ontology.config.reader import ConfigReader

    for name, ts in ConfigReader().get_toolsets().items():
        typer.echo(f"  {name}: {', '.join(ts.get('tools', []))}")


@app.command()
def validate() -> None:
    """Validate tools.yaml against the Google MCP Toolbox resource schema."""
    from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml
    from iblai_ontology.config import config_dir

    report = validate_tools_yaml(config_dir() / "tools.yaml")
    typer.echo(f"sources: {report.sources}  tools: {report.tools}  toolsets: {report.toolsets}")
    for issue in report.issues:
        marker = "ERR" if issue.severity == "error" else "WARN"
        typer.echo(f"  [{marker}] {issue.message}")
    if report.ok:
        typer.echo("tools.yaml is MCP Toolbox compliant.")
    else:
        raise typer.Exit(code=1)


@app.command()
def test(
    tool: str = typer.Argument(..., help="Tool name."),
    params: Optional[str] = typer.Option(None, help="JSON params."),
) -> None:
    """Test a specific MCP tool."""
    import json

    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.mcp_server.tester import ToolTester

    p = json.loads(params) if params else {}
    result = ToolTester().call(tool, p)
    typer.echo(json.dumps(result, indent=2, default=str))
