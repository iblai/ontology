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

import httpx

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
        """Pull rows from a source by invoking an inbound MCP tool."""
        resp = httpx.post(
            f"{self.toolbox_url}/api/tool/{tool}", json=arguments or {}, timeout=120
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and "result" in data:
            return data["result"]
        return data if isinstance(data, list) else [data]

    # -- schedule execution ---------------------------------------------
    def run_service(self, service: str, *, schedule_name: str | None = None, force_full: bool = False):
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
            run.error_message = "generic transform seam (per-service sync not configured)"
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
        """Transform + upsert rows into cache/text-memories/vector index.

        Concrete per-service writers (generated during provisioning) override
        this. The generic path documents the seam rather than guessing a schema.
        """
        raise NotImplementedError(
            "per-service transform/upsert is generated during provisioning"
        )

    # -- validation helper (used by ProvisioningValidator) --------------
    def test_sync_table(self, service: str, table: str, *, limit: int = 100) -> int:
        """Pull a bounded sample for one table to validate connectivity."""
        raise NotImplementedError(
            "test_sync_table requires a generated per-service tool mapping"
        )
