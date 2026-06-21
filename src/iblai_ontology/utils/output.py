"""Rich console output helpers — tables, JSON, CSV.

Kept dependency-light (only ``rich``) so the CLI surface renders without the
Django backend installed.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Iterable, Sequence

from rich.console import Console
from rich.table import Table

console = Console()


def print_table(
    *,
    title: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
) -> None:
    """Render a list of rows as a bordered rich table."""
    table = Table(title=title, header_style="bold cyan", title_style="bold")
    for col in columns:
        table.add_column(str(col))
    for row in rows:
        table.add_row(*[("" if c is None else str(c)) for c in row])
    console.print(table)


def print_result(
    rows: Iterable[dict[str, Any]] | Iterable[Sequence[Any]],
    columns: Sequence[str],
    *,
    format: str = "table",
    title: str = "Result",
) -> None:
    """Print query results in the requested format: ``table``, ``json``, ``csv``."""
    rows = list(rows)
    # Normalise to list-of-lists aligned with ``columns``.
    norm: list[list[Any]] = []
    dict_rows: list[dict[str, Any]] = []
    for r in rows:
        if isinstance(r, dict):
            dict_rows.append(r)
            norm.append([r.get(c) for c in columns])
        else:
            norm.append(list(r))
            dict_rows.append({c: v for c, v in zip(columns, r)})

    if format == "json":
        console.print_json(json.dumps(dict_rows, default=str))
    elif format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(columns)
        writer.writerows(norm)
        console.print(buf.getvalue().rstrip("\n"))
    else:
        print_table(title=title, columns=columns, rows=norm)
