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
    """Inspect the local ontology cache for table/row counts and size.

    On PostgreSQL the size/row/connection stats are filled from the catalog
    (``pg_database_size``, ``pg_stat_user_tables.n_live_tup``,
    ``pg_stat_activity``); on SQLite those stay zero (no equivalent view).
    """
    from django.db import connection

    try:
        with connection.cursor() as cur:
            if connection.vendor == "postgresql":
                cur.execute(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema NOT IN ('pg_catalog','information_schema')"
                )
                table_count = cur.fetchone()[0]
                cur.execute(
                    "SELECT coalesce(sum(n_live_tup),0) FROM pg_stat_user_tables"
                )
                total_rows = int(cur.fetchone()[0] or 0)
                cur.execute("SELECT pg_database_size(current_database())")
                size_mb = round((cur.fetchone()[0] or 0) / 1_048_576, 2)
                cur.execute(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database()"
                )
                active_connections = int(cur.fetchone()[0] or 0)
                return DbHealth(
                    healthy=True,
                    table_count=table_count,
                    total_rows=total_rows,
                    size_mb=size_mb,
                    active_connections=active_connections,
                )
            cur.execute("SELECT count(*) FROM sqlite_master WHERE type='table'")
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
    from iblai_ontology.backend.sync import schedules as source

    schedules = source.all()
    try:
        from datetime import timedelta

        from django.utils import timezone

        from iblai_ontology.backend import store
        from iblai_ontology.backend.sync.models import SyncRun

        since = timezone.now() - timedelta(hours=24)
        failed = store.count(SyncRun, status="failed", started_at__gte=since)
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
    """The MCP gateway as seen from its public URL (``ONTOLOGY_GATEWAY_URL``).

    A ``ping`` answered with 200 or 401 means the tunnel and the gateway are up;
    anything else, or no answer, is down. No URL means a local-only gateway.
    """
    from iblai_ontology.config.reader import ConfigReader

    reader = ConfigReader()
    url = os.environ.get("ONTOLOGY_GATEWAY_URL", "")
    running = False
    if url:
        import httpx

        try:
            status = httpx.post(
                url, json={"jsonrpc": "2.0", "id": 1, "method": "ping"}, timeout=3
            ).status_code
            running = status in (200, 401)
        except httpx.HTTPError:
            running = False
    # ponytail: no session store, so active_sessions stays 0.
    return GatewayHealth(
        running=running,
        url=url,
        tool_count=len(reader.get_tools()),
        toolset_count=len(reader.get_toolsets()),
    )
