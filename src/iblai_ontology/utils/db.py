"""Read-only query helpers against the local ontology PostgreSQL cache.

These are thin helpers used by the CLI ``data`` commands. They enforce that
only ``SELECT`` statements run, mirroring the read-only posture of the whole
system. The actual connection is created lazily so the CLI imports without a
database driver present.
"""

from __future__ import annotations

import os
from typing import Any


class ReadOnlyQueryError(RuntimeError):
    """Raised when a non-SELECT statement is submitted to the cache."""


def _ontology_db_url() -> str:
    url = os.environ.get("ONTOLOGY_DB_URL")
    if not url:
        raise RuntimeError(
            "ONTOLOGY_DB_URL is not set. Point it at the local cache, e.g. "
            "postgresql://ontology:***@localhost:5432/ontology"
        )
    return url


def _assert_select_only(sql: str) -> None:
    stripped = sql.strip().rstrip(";").lstrip()
    if not stripped.upper().startswith(("SELECT", "WITH")):
        raise ReadOnlyQueryError("Only SELECT/WITH queries are allowed.")


def run_readonly_query(
    sql: str, *, limit: int = 100
) -> tuple[list[tuple[Any, ...]], list[str]]:
    """Execute a read-only SELECT against the ontology cache.

    Returns ``(rows, column_names)``. Requires the ``[db]`` extra (psycopg2).
    """
    _assert_select_only(sql)
    try:
        import psycopg2  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "psycopg2 is required for `ontology data query`. Install with: "
            "pip install 'iblai-ontology[db]'"
        ) from exc

    conn = psycopg2.connect(_ontology_db_url())
    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchmany(limit)
            columns = [d[0] for d in cur.description] if cur.description else []
        return list(rows), columns
    finally:
        conn.close()
