"""Sync engine (Component 2).

A SyncRunner pulls rows from a source and writes them into the local knowledge
store: Markdown text memories, the structured cache, and the vector index. Each
run is recorded as a SyncRun.

A database service is read straight through its own connection (``pull_table``,
the schedule names ``service`` and ``table``). An API service is read through its
custom MCP server (``pull``, the schedule names a ``tool`` and a ``<name>-mcp``
source). The MCP Toolbox serves agent-facing tools only.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("iblai_ontology.sync")

# Bounded samples per dialect; everything else takes LIMIT.
_LIMIT_SQL = {
    "oracle": "SELECT * FROM {table} FETCH FIRST {n} ROWS ONLY",
    "sqlserver": "SELECT TOP {n} * FROM {table}",
}


def _owned_by(sched: dict, service: str) -> bool:
    """A schedule's service: its ``service`` key or a source named ``<name>``, ``<name>-source`` or ``<name>-mcp`` (no prefix match: ``twenty`` is also a prefix of ``twenty-cloud``)."""
    source = sched.get("source", "")
    return sched.get("service") == service or source in (
        service,
        f"{service}-source",
        f"{service}-mcp",
    )


def _qualified(table: str, db_type: str | None) -> str:
    """``schema.table`` as the dialect's FROM clause wants it."""
    # ponytail: PostgreSQL folds unquoted names, so camelCase sources need quotes; the other dialects stay unquoted until a mixed-case source arrives.
    if db_type == "postgresql":
        return ".".join(f'"{part}"' for part in table.split("."))
    return table


@dataclass
class SyncResult:
    schedule_name: str
    source_system: str
    records_processed: int
    records_created: int
    records_updated: int
    status: str


class SyncRunner:
    """Executes syncs and records SyncRun rows."""

    def __init__(self, toolbox_url: str | None = None) -> None:
        self.toolbox_url = toolbox_url or os.environ.get(
            "MCP_TOOLBOX_URL", "http://mcp-toolbox:5000"
        )

    # -- source pulls ----------------------------------------------------
    @staticmethod
    def mcp_url(source: str) -> str | None:
        """A ``<name>-mcp`` source is a custom MCP server at ``MCP_<NAME>_URL``; others are Toolbox tools."""
        if not source.endswith("-mcp"):
            return None
        var = f"MCP_{source[:-4].upper().replace('-', '_')}_URL"
        url = os.environ.get(var)
        if not url:
            raise RuntimeError(
                f"{var} is not set: the sync engine cannot reach {source}"
            )
        return url

    def pull(
        self, tool: str, arguments: dict | None = None, *, url: str | None = None
    ) -> list[dict]:
        """Pull rows by calling an MCP tool on a custom server (``url``) or the Toolbox."""
        from iblai_ontology.backend.mcp_server.toolbox_client import call_tool

        rows = call_tool(url or self.toolbox_url, tool, arguments, timeout=120)
        return rows if isinstance(rows, list) else [rows]

    def pull_table(
        self, service, table: str, *, limit: int | None = None
    ) -> list[dict]:
        """Rows of ``schema.table`` through the service's own connection, JSON-native values."""
        from iblai_ontology.backend.discovery.engine import create_connection
        from iblai_ontology.backend.services.encryption import decrypt_connection_config

        config = decrypt_connection_config(service.connection_config_encrypted)
        name = _qualified(table, config.get("db_type"))
        sql = (
            _LIMIT_SQL.get(
                config.get("db_type"), "SELECT * FROM {table} LIMIT {n}"
            ).format(table=name, n=limit)
            if limit
            else f"SELECT * FROM {name}"
        )
        conn = create_connection(service.adapter, config)
        try:
            cur = conn.cursor()
            cur.execute(sql)
            cols = [d[0] for d in cur.description or []]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            cap = getattr(getattr(conn, "connector", None), "_max_rows", None)
            if cap and len(rows) >= cap:
                raise RuntimeError(
                    f"{table}: the connector capped the result at {cap} rows; "
                    "raise it with --option max_rows=<n>"
                )
        finally:
            conn.close()
        # Decimal, datetime and numpy scalars become JSON-native so they bind on SQLite and Postgres.
        return json.loads(json.dumps(rows, default=str))

    def _pull(self, sched: dict) -> list[dict]:
        if sched.get("table"):
            from iblai_ontology.backend import store
            from iblai_ontology.backend.services.models import Service

            service = store.get(Service, name=sched["service"])
            return self.pull_table(service, sched["table"])
        if sched.get("tool"):
            return self.pull(sched["tool"], url=self.mcp_url(sched.get("source") or ""))
        raise ValueError(
            f"schedule {sched.get('name')!r} names neither a table nor a tool"
        )

    # -- schedule execution ---------------------------------------------
    def run_service(
        self,
        service: str,
        *,
        schedule_name: str | None = None,
        force_full: bool = False,
    ):
        from iblai_ontology.backend.sync import schedules as source

        schedules = [
            s
            for s in source.all()
            if _owned_by(s, service) and s.get("enabled", True) is not False
        ]
        if schedule_name:
            schedules = [s for s in schedules if s["name"] == schedule_name]
        results = []
        for sched in schedules:
            results.append(self._run_schedule(sched, force_full=force_full))
        return results

    def run_all_due(self, *, force_full: bool = False):
        from iblai_ontology.backend.sync import schedules

        # A real deployment consults each schedule's cron + last run; here we run
        # every configured schedule (Celery beat owns the cron cadence).
        results = []
        for sched in schedules.all():
            if sched.get("enabled", True) is False:
                continue
            results.append(self._run_schedule(sched, force_full=force_full))
        return results

    def _run_schedule(self, sched: dict, *, force_full: bool) -> SyncResult:
        from django.utils import timezone

        from iblai_ontology.backend import store
        from iblai_ontology.backend.sync.models import SyncRun

        run = store.create(
            SyncRun,
            schedule_name=sched["name"],
            source_system=sched.get("source", ""),
            started_at=timezone.now(),
            status=SyncRun.Status.RUNNING,
        )
        try:
            rows = self._pull(sched)
            written = self._write(sched, rows)
            run.records_processed = len(rows)
            run.records_created = written.get("created", 0)
            run.records_updated = written.get("updated", 0)
            run.status = SyncRun.Status.SUCCESS
        except Exception as exc:  # pragma: no cover - integration path
            run.status = SyncRun.Status.FAILED
            run.error_message = str(exc)[:1000]
        finally:
            run.completed_at = timezone.now()
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            store.save(run)
        return SyncResult(
            schedule_name=run.schedule_name,
            source_system=run.source_system,
            records_processed=run.records_processed,
            records_created=run.records_created,
            records_updated=run.records_updated,
            status=run.status,
        )

    def _write(self, sched: dict, rows: list[dict]) -> dict:
        """Upsert rows into the cache, write text memories, index them.

        The schedule's ``output`` drives it: ``structured_cache`` names the cache
        table, ``text_memories`` the entity folder, ``map`` renames source columns,
        ``template`` picks the memory template, ``primary_key`` the upsert key
        (detected from the first row when absent).
        """
        from django.db import connection

        from iblai_ontology.backend.sync.writer import (
            _normalise,
            detect_primary_key,
            write_entities,
        )

        if not rows:
            return {"created": 0, "updated": 0}

        output = sched.get("output", {}) or {}
        mapping = {
            str(k).lower(): str(v).lower() for k, v in (output.get("map") or {}).items()
        }
        cache_table = output.get("structured_cache")
        entity_group = self._entity_group(sched, output)
        primary_key = output.get("primary_key") or detect_primary_key(
            _normalise(rows[0], mapping)
        )

        indexer = self._indexer()
        with connection.cursor() as cursor:
            result = write_entities(
                cursor,
                rows,
                cache_table=cache_table,
                primary_key=primary_key,
                entity_group=entity_group,
                indexer=indexer,
                mapping=mapping,
                template=output.get("template"),
                create_table=bool(output.get("create_table")),
            )
        return {
            "created": result.created,
            "updated": result.updated,
            "files": len(result.files),
        }

    @staticmethod
    def _entity_group(sched: dict, output: dict) -> str:
        text_path = output.get("text_memories", "")
        if text_path:
            return text_path.strip("/").split("/")[-1] or "generic"
        return sched.get("name", "generic").split("-")[0]

    @staticmethod
    def _indexer():
        try:
            from iblai_ontology.backend.search.vector import VectorSearch

            return VectorSearch()
        except Exception:  # pragma: no cover - optional extra
            return None


def latest_runs() -> list:
    """The newest SyncRun of each schedule, newest first: one query per schedule (no DISTINCT)."""
    from iblai_ontology.backend import store
    from iblai_ontology.backend.sync.models import SyncRun

    runs, after = [], {}
    while run := store.first(SyncRun, order=("schedule_name", "-started_at"), **after):
        runs.append(run)
        after = {"schedule_name__gt": run.schedule_name}
    return sorted(runs, key=lambda r: r.started_at, reverse=True)
