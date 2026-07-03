"""``ontology data *`` — query, search, and inspect the knowledge layer."""

from __future__ import annotations

import os
from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Query, search, and inspect data.")


@app.command()
def query(
    sql: str = typer.Argument(..., help="SQL SELECT query."),
    format: str = typer.Option("table", help="Output format: table, json, csv."),
    limit: int = typer.Option(100, help="Max rows."),
) -> None:
    """Run a read-only query against the ontology cache."""
    from iblai_ontology.utils.db import ReadOnlyQueryError, run_readonly_query
    from iblai_ontology.utils.output import print_result

    try:
        rows, columns = run_readonly_query(sql, limit=limit)
    except ReadOnlyQueryError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)
    print_result(rows, columns, format=format)


@app.command()
def search(
    term: str = typer.Argument(..., help="Search term."),
    domain: Optional[str] = typer.Option(
        None, help="Restrict to a domain (students, courses…)."
    ),
    limit: int = typer.Option(10, help="Max results."),
) -> None:
    """Semantic search across text memories."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.search.vector import VectorSearch

    for r in VectorSearch().query(term, domain=domain, limit=limit):
        typer.echo(f"  [{r.score:.2f}] {r.path}")
        typer.echo(f"         {r.snippet}")


@app.command()
def memory(
    path: str = typer.Argument(..., help="Memory path, e.g. students/by-id/001234567."),
) -> None:
    """Display a text memory file."""
    root = os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology")
    full_path = os.path.join(root, path.lstrip("/"))
    if not full_path.endswith(".md"):
        full_path += ".md"
    if not os.path.exists(full_path):
        typer.echo(f"File not found: {full_path}", err=True)
        raise typer.Exit(code=1)
    with open(full_path) as f:
        typer.echo(f.read())


@app.command()
def stats() -> None:
    """Statistics on the memory store and cache."""
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend.health.checks import check_db, check_storage

    s = check_storage()
    d = check_db()
    typer.echo(f"Text memories: {s.total_files:,} files, {s.total_size_mb:.1f} MB")
    typer.echo(
        f"Cache DB: {d.table_count} tables, {d.total_rows:,} rows, {d.size_mb:.1f} MB"
    )
