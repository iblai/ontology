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

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

logger = logging.getLogger("iblai_ontology.sync")


@dataclass
class WriteResult:
    processed: int = 0
    created: int = 0
    updated: int = 0
    files: list[str] = field(default_factory=list)


def _normalise(
    row: dict[str, Any],
    mapping: Optional[dict[str, str]] = None,
    *,
    flatten: bool = False,
) -> dict[str, Any]:
    """Lowercase keys and apply the schedule's column renames.

    ``flatten`` JSON-encodes nested values for the cache upsert (a cursor cannot bind
    a dict); memories keep them so templates can walk them.
    """
    out = {}
    for k, v in row.items():
        key = k.lower()
        if mapping:
            key = mapping.get(key, key)
        if flatten and isinstance(v, (dict, list)):
            v = json.dumps(v, default=str)
        out[key] = v
    return out


def _key_columns(primary_key: str | list[str]) -> list[str]:
    return [primary_key] if isinstance(primary_key, str) else list(primary_key)


def _ensure_table(cursor, table: str, row: dict[str, Any], keys: list[str]) -> None:
    """Schema-on-write for API sources: a TEXT column per key of the first row."""
    cols = ", ".join(f"{c} TEXT" for c in row)
    cursor.execute(
        f"CREATE TABLE IF NOT EXISTS {table} ({cols}, PRIMARY KEY ({', '.join(keys)}))"
    )


def upsert_rows(
    cursor,
    table: str,
    rows: list[dict],
    primary_key: str | list[str],
    mapping: Optional[dict[str, str]] = None,
) -> tuple[int, int]:
    """Insert/update rows by primary key (one column or several). Returns (created, updated)."""
    keys = _key_columns(primary_key)
    created = updated = 0
    for raw in rows:
        row = _normalise(raw, mapping, flatten=True)
        missing = [k for k in keys if k not in row]
        if missing:
            raise KeyError(f"primary key {missing} not in row columns {list(row)}")
        cols = list(row.keys())
        cursor.execute(
            f"SELECT 1 FROM {table} WHERE " + " AND ".join(f"{k} = %s" for k in keys),
            [row[k] for k in keys],
        )
        exists = cursor.fetchone() is not None
        placeholders = ", ".join(["%s"] * len(cols))
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in keys)
        conflict = ", ".join(keys)
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT ({conflict}) DO UPDATE SET {updates}"
            if updates
            else f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT ({conflict}) DO NOTHING"
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
    primary_key: str | list[str],
    files_root: str,
    indexer: Optional[Any] = None,
    mapping: Optional[dict[str, str]] = None,
    template: Optional[str] = None,
) -> list[str]:
    """Render + write one Markdown memory per row; index each (best-effort)."""
    from iblai_ontology.backend.provisioning.memory_generator import MemoryGenerator

    gen = MemoryGenerator()
    out_dir = Path(files_root) / entity_group
    out_dir.mkdir(parents=True, exist_ok=True)
    synced_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    written: list[str] = []
    for raw in rows:
        row = _normalise(raw, mapping)
        pk_value = "-".join(
            str(row.get(k, "unknown")) for k in _key_columns(primary_key)
        )
        context = dict(row)
        context.setdefault("id", pk_value)
        context.setdefault("last_synced_at", synced_at)
        context.setdefault("fields", {k: v for k, v in row.items()})
        try:
            text = gen.render(template or entity_group, context)
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
            except Exception as exc:
                # One warning, then no more attempts this run: an unreachable vector
                # store costs a connection timeout per row otherwise.
                logger.warning(
                    "vector index unavailable (%s); %s memories written, not indexed",
                    exc,
                    entity_group,
                )
                indexer = None
    return written


def write_entities(
    cursor,
    rows: Iterable[dict],
    *,
    cache_table: Optional[str],
    primary_key: str | list[str],
    entity_group: str = "generic",
    files_root: Optional[str] = None,
    indexer: Optional[Any] = None,
    mapping: Optional[dict[str, str]] = None,
    template: Optional[str] = None,
    create_table: bool = False,
) -> WriteResult:
    """Upsert rows to the cache (if a table is given) and write text memories.

    ``mapping`` renames source columns (``output.map``); ``template`` picks the memory
    template; ``create_table`` builds the cache table from the first row (API sources
    have no DDL), database schedules never set it so a missing DDL fails loudly.
    """
    rows = list(rows)
    result = WriteResult(processed=len(rows))
    if cache_table and rows:
        if create_table:
            _ensure_table(
                cursor,
                cache_table,
                _normalise(rows[0], mapping),
                _key_columns(primary_key),
            )
        result.created, result.updated = upsert_rows(
            cursor, cache_table, rows, primary_key, mapping
        )
    root = files_root or os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology")
    result.files = write_memories(
        rows,
        entity_group=entity_group,
        primary_key=primary_key,
        files_root=root,
        indexer=indexer,
        mapping=mapping,
        template=template,
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
