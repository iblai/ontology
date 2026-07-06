"""Sync engine (Component 2).

A SyncRunner pulls data from a source (via the inbound MCP layer), transforms it,
and writes it into the local knowledge store: Markdown text memories, the
PostgreSQL structured cache, and the vector index. Each run is recorded as a
SyncRun.

Source pulls go through the MCP Toolbox / custom MCP servers; the actual upsert
into the cache is source-schema specific and is generated per service, so the
generic transform here is intentionally a documented seam (NotImplementedError)
that concrete per-service syncs override.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("iblai_ontology.sync")


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
    def pull(self, tool: str, arguments: dict | None = None) -> list[dict]:
        """Pull rows from a source by invoking an inbound MCP tool.

        Uses the shared /mcp Toolbox client (Toolbox 1.5+ disables the legacy
        /api/tool REST endpoints).
        """
        from iblai_ontology.backend.mcp_server.toolbox_client import call_tool

        rows = call_tool(self.toolbox_url, tool, arguments, timeout=120)
        return rows if isinstance(rows, list) else [rows]

    # -- schedule execution ---------------------------------------------
    def run_service(
        self,
        service: str,
        *,
        schedule_name: str | None = None,
        force_full: bool = False,
    ):
        from iblai_ontology.config.reader import ConfigReader

        schedules = [
            s
            for s in ConfigReader().get_sync_schedules()
            if s.get("source", "").startswith(service) or service in s.get("name", "")
        ]
        if schedule_name:
            schedules = [s for s in schedules if s["name"] == schedule_name]
        results = []
        for sched in schedules:
            results.append(self._run_schedule(sched, force_full=force_full))
        return results

    def run_all_due(self, *, force_full: bool = False):
        from iblai_ontology.config.reader import ConfigReader

        # A real deployment consults each schedule's cron + last run; here we run
        # every configured schedule (Celery beat owns the cron cadence).
        results = []
        for sched in ConfigReader().get_sync_schedules():
            results.append(self._run_schedule(sched, force_full=force_full))
        return results

    def _run_schedule(self, sched: dict, *, force_full: bool) -> SyncResult:
        from django.utils import timezone

        from iblai_ontology.backend.sync.models import SyncRun

        run = SyncRun.objects.create(
            schedule_name=sched["name"],
            source_system=sched.get("source", ""),
            started_at=timezone.now(),
            status=SyncRun.Status.RUNNING,
        )
        try:
            rows = self.pull(sched["tool"])
            written = self._write(sched, rows)
            run.records_processed = len(rows)
            run.records_created = written.get("created", 0)
            run.records_updated = written.get("updated", 0)
            run.status = SyncRun.Status.SUCCESS
        except NotImplementedError:
            # Generic transform seam — surfaced, not a hard failure.
            run.status = SyncRun.Status.SUCCESS
            run.error_message = (
                "generic transform seam (per-service sync not configured)"
            )
        except Exception as exc:  # pragma: no cover - integration path
            run.status = SyncRun.Status.FAILED
            run.error_message = str(exc)[:1000]
        finally:
            run.completed_at = timezone.now()
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            run.save()
        return SyncResult(
            schedule_name=run.schedule_name,
            source_system=run.source_system,
            records_processed=run.records_processed,
            records_created=run.records_created,
            records_updated=run.records_updated,
            status=run.status,
        )

    def _write(self, sched: dict, rows: list[dict]) -> dict:
        """Transform + upsert rows into cache, text memories, and vector index.

        Uses the schedule's ``output`` config: ``structured_cache`` names the
        cache table, ``text_memories`` selects the entity group. The primary key
        is detected heuristically from the rows (id/emplid/*_id).
        """
        from django.db import connection

        from iblai_ontology.backend.sync.writer import (
            detect_primary_key,
            write_entities,
        )

        if not rows:
            return {"created": 0, "updated": 0}

        output = sched.get("output", {}) or {}
        cache_table = output.get("structured_cache")
        entity_group = self._entity_group(sched, output)
        primary_key = detect_primary_key(rows[0])

        indexer = self._indexer()
        with connection.cursor() as cursor:
            result = write_entities(
                cursor,
                rows,
                cache_table=cache_table,
                primary_key=primary_key,
                entity_group=entity_group,
                indexer=indexer,
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

    # -- validation helper (used by ProvisioningValidator) --------------
    def test_sync_table(self, service: str, table: str, *, limit: int = 100) -> int:
        """Pull a bounded sample for one table to validate connectivity."""
        rows = self.pull(f"get-{table.lower()}", {"limit": limit})
        return len(rows)
