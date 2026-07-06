"""Transform + write pulled rows into the knowledge store (Component 2).

``write_entities`` is the real, DB-agnostic primitive behind a live sync:
  1. upsert rows into the PostgreSQL cache (works on SQLite too, for tests),
  2. render one Markdown text memory per row,
  3. index each memory into the vector store (best-effort).

It uses a Django DB cursor, so ``%s`` placeholders work on both Postgres and
SQLite (Django's SQLite wrapper rewrites them to ``?``). ``INSERT ... ON
CONFLICT`` is supported by both engines.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional


@dataclass
class WriteResult:
    processed: int = 0
    created: int = 0
    updated: int = 0
    files: list[str] = field(default_factory=list)


def _normalise(row: dict[str, Any]) -> dict[str, Any]:
    """Lowercase keys so source columns map onto cache columns consistently."""
    return {k.lower(): v for k, v in row.items()}


def upsert_rows(
    cursor, table: str, rows: list[dict], primary_key: str
) -> tuple[int, int]:
    """Insert/update rows by primary key. Returns (created, updated)."""
    created = updated = 0
    for raw in rows:
        row = _normalise(raw)
        if primary_key not in row:
            raise KeyError(
                f"primary key '{primary_key}' not in row columns {list(row)}"
            )
        cols = list(row.keys())
        cursor.execute(
            f"SELECT 1 FROM {table} WHERE {primary_key} = %s", [row[primary_key]]
        )
        exists = cursor.fetchone() is not None
        placeholders = ", ".join(["%s"] * len(cols))
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != primary_key)
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT ({primary_key}) DO UPDATE SET {updates}"
            if updates
            else f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT ({primary_key}) DO NOTHING"
        )
        cursor.execute(sql, [row[c] for c in cols])
        if exists:
            updated += 1
        else:
            created += 1
    return created, updated


def write_memories(
    rows: list[dict],
    *,
    entity_group: str,
    primary_key: str,
    files_root: str,
    indexer: Optional[Any] = None,
) -> list[str]:
    """Render + write one Markdown memory per row; index each (best-effort)."""
    from iblai_ontology.backend.provisioning.memory_generator import MemoryGenerator

    gen = MemoryGenerator()
    out_dir = Path(files_root) / entity_group
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for raw in rows:
        row = _normalise(raw)
        pk_value = row.get(primary_key, "unknown")
        context = dict(row)
        context.setdefault("id", pk_value)
        context.setdefault("fields", {k: v for k, v in row.items()})
        try:
            text = gen.render(entity_group, context)
        except Exception:
            # Unknown template / missing field -> fall back to the generic one.
            text = gen.render(
                "generic",
                {
                    "id": pk_value,
                    "last_synced_at": context.get("last_synced_at", ""),
                    "fields": context["fields"],
                },
            )
        path = out_dir / f"{pk_value}.md"
        path.write_text(text)
        written.append(str(path))
        if indexer is not None:
            try:
                indexer.index_file(f"/ontology/{entity_group}/{pk_value}.md", text)
            except Exception:
                pass
    return written


def write_entities(
    cursor,
    rows: Iterable[dict],
    *,
    cache_table: Optional[str],
    primary_key: str,
    entity_group: str = "generic",
    files_root: Optional[str] = None,
    indexer: Optional[Any] = None,
) -> WriteResult:
    """Upsert rows to the cache (if a table is given) and write text memories."""
    rows = list(rows)
    result = WriteResult(processed=len(rows))
    if cache_table:
        result.created, result.updated = upsert_rows(
            cursor, cache_table, rows, primary_key
        )
    root = files_root or os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology")
    result.files = write_memories(
        rows,
        entity_group=entity_group,
        primary_key=primary_key,
        files_root=root,
        indexer=indexer,
    )
    return result


# Heuristic primary-key detection for the generic sync path.
def detect_primary_key(row: dict) -> str:
    keys = [k.lower() for k in row]
    for candidate in ("id", "emplid", "student_id"):
        if candidate in keys:
            return candidate
    for k in keys:
        if k.endswith("_id"):
            return k
    return keys[0] if keys else "id"
