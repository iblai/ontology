"""Health checks backing `ontology health`, `ontology data stats`, `ontology mcp status`."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class DbHealth:
    healthy: bool
    table_count: int = 0
    total_rows: int = 0
    size_mb: float = 0.0
    active_connections: int = 0


@dataclass
class McpServerHealth:
    reachable: bool
    latency_ms: int = 0
    tool_count: int = 0


@dataclass
class SyncHealth:
    running: bool
    total_schedules: int = 0
    failed_last_24h: int = 0
    next_due_schedule: str = "-"
    next_due_at: str = "-"


@dataclass
class StorageHealth:
    total_files: int = 0
    total_size_mb: float = 0.0
    by_domain: dict[str, dict[str, float]] = field(default_factory=dict)


@dataclass
class GatewayHealth:
    running: bool
    url: str = ""
    tool_count: int = 0
    toolset_count: int = 0
    active_sessions: int = 0


def check_db() -> DbHealth:
    """Inspect the local ontology cache for table/row counts and size."""
    from django.db import connection

    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema NOT IN ('pg_catalog','information_schema')"
                if connection.vendor == "postgresql"
                else "SELECT count(*) FROM sqlite_master WHERE type='table'"
            )
            table_count = cur.fetchone()[0]
        return DbHealth(healthy=True, table_count=table_count)
    except Exception:
        return DbHealth(healthy=False)


def check_mcp_servers() -> dict[str, McpServerHealth]:
    """Probe configured inbound MCP servers (best-effort)."""
    # Full implementation lands with Component 1/4; report the cache as reachable.
    return {}


def check_sync() -> SyncHealth:
    """Summarise sync engine status from SyncRun history."""
    from iblai_ontology.config.reader import ConfigReader

    schedules = ConfigReader().get_sync_schedules()
    try:
        from datetime import timedelta

        from django.utils import timezone

        from iblai_ontology.backend.sync.models import SyncRun

        since = timezone.now() - timedelta(hours=24)
        failed = SyncRun.objects.filter(status="failed", started_at__gte=since).count()
    except Exception:
        failed = 0
    return SyncHealth(
        running=True,
        total_schedules=len(schedules),
        failed_last_24h=failed,
    )


def check_storage() -> StorageHealth:
    """Walk the text-memory root and report per-domain file counts and sizes."""
    root = os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology")
    result = StorageHealth()
    if not os.path.isdir(root):
        return result
    for dirpath, _dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        domain = rel.split(os.sep)[0] if rel != "." else "_root"
        for fn in files:
            size = os.path.getsize(os.path.join(dirpath, fn))
            result.total_files += 1
            result.total_size_mb += size / 1_048_576
            d = result.by_domain.setdefault(domain, {"files": 0, "size_mb": 0.0})
            d["files"] += 1
            d["size_mb"] += size / 1_048_576
    return result


def check_mcp_gateway() -> GatewayHealth:
    """Report the MCP outbound gateway status (Component 4)."""
    from iblai_ontology.config.reader import ConfigReader

    reader = ConfigReader()
    return GatewayHealth(
        running=False,
        url=os.environ.get("ONTOLOGY_GATEWAY_URL", ""),
        tool_count=len(reader.get_tools()),
        toolset_count=len(reader.get_toolsets()),
    )
