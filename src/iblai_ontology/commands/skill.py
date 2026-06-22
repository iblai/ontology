"""``ontology skill *`` — seed discovery from a SKILL.md file."""

from __future__ import annotations

import typer

from iblai_ontology.ui import console

app = typer.Typer(no_args_is_help=True, help="Inspect SKILL.md files and seed discovery from them.")


@app.command(name="list")
def list_skills() -> None:
    """List the vendored SKILL.md files available offline."""
    from iblai_ontology.catalog import get_entry, list_entries
    from iblai_ontology.catalog.skill_parser import list_vendored
    from iblai_ontology.utils.output import print_table

    # Map vendored skill -> catalog key(s) for context.
    by_skill: dict[str, str] = {}
    for e in list_entries():
        if e.skill:
            by_skill.setdefault(e.skill.removesuffix(".md"), e.key)

    print_table(
        title="Vendored skills",
        columns=["Skill", "Catalog key", "Source"],
        rows=[[s, by_skill.get(s, "—"), "iblai agent-skills"] for s in list_vendored()],
    )


@app.command("import")
def import_skill(ref: str = typer.Argument(..., help="Vendored name, local path, or URL.")) -> None:
    """Parse a SKILL.md and print the discovery seed (connection + tools)."""
    from iblai_ontology.catalog.skill_parser import load_skill

    seed = load_skill(ref)
    console.print(f"[brand]{seed.name}[/brand] — {seed.description}")
    console.print()
    console.print("[highlight]Connection (env vars):[/highlight]")
    for var in seed.env:
        marker = " (primary)" if var == seed.primary_env else ""
        console.print(f"  - {var}{marker}")
    console.print()
    console.print(f"[highlight]Suggested read-only tools[/highlight] ({len(seed.read_operations)}):")
    for tool in seed.suggested_tools(read_only=True):
        console.print(f"  - {tool['name']}: {tool['method']} {tool['path']}")
        console.print(f"      {tool['description']}")
    write_ops = [o for o in seed.operations if not o.read_only]
    if write_ops:
        console.print()
        console.print(f"[dim]({len(write_ops)} write operations omitted — read-only posture)[/dim]")
