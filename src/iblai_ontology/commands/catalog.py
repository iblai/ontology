"""``ontology catalog *`` — browse the built-in service catalog."""

from __future__ import annotations

import typer

from iblai_ontology.ui import console

app = typer.Typer(
    no_args_is_help=True,
    help="Browse built-in service defaults across every solution segment.",
)

_DOMAINS = "higher-ed | enterprise | k-12 | government | legal | financial-services | medical-healthcare"


@app.command(name="list")
def list_catalog(
    domain: str = typer.Option(None, help=f"Filter by domain: {_DOMAINS}."),
) -> None:
    """List built-in service defaults, each linking its SKILL.md."""
    from iblai_ontology.catalog import list_entries
    from iblai_ontology.utils.output import print_table

    rows = []
    for e in list_entries():
        if domain and e.domain != domain:
            continue
        rows.append(
            [
                e.key,
                e.display_name,
                e.type,
                e.domain,
                e.default_toolset,
                e.skill_url or "—",
            ]
        )
    print_table(
        title="Service catalog",
        columns=["Key", "Name", "Type", "Domain", "Default toolset", "Skill"],
        rows=rows,
    )


@app.command()
def show(
    key: str = typer.Argument(
        ..., help="Catalog key, e.g. canvas, peoplesoft, snowflake."
    ),
) -> None:
    """Show a catalog entry: connection shape, default toolset, sync cadences, skill."""
    from iblai_ontology.catalog import get_entry

    try:
        entry = get_entry(key)
    except KeyError as exc:
        console.print(f"[error]{exc}[/error]")
        raise typer.Exit(code=1)

    console.print(
        f"[brand]{entry.display_name}[/brand]  [dim]({entry.key}, {entry.domain})[/dim]"
    )
    if entry.summary:
        console.print(entry.summary)
    console.print()
    console.print(
        f"[highlight]Type:[/highlight] {entry.type}    [highlight]Adapter:[/highlight] {entry.adapter}"
    )
    console.print(f"[highlight]Default toolset:[/highlight] {entry.default_toolset}")
    if entry.connection:
        console.print(f"[highlight]Connection:[/highlight] {entry.connection}")
    console.print("[highlight]Required env:[/highlight]")
    for var in entry.env:
        console.print(f"  - {var}")
    if entry.sync_defaults:
        console.print("[highlight]Default sync cadences:[/highlight]")
        for k, v in entry.sync_defaults.items():
            console.print(f"  - {k}: {v}")
    if entry.skill_url:
        console.print(f"[highlight]Skill:[/highlight] {entry.skill_url}")
        console.print(
            "  Seed discovery from it with: "
            f"[dim]ontology skill import {entry.skill.removesuffix('.md')}[/dim]"
        )
