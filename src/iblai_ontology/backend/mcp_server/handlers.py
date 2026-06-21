"""MCP method handlers (Component 4).

Implements the MCP JSON-RPC surface exposed by the outbound gateway, scoped by
the caller's resolved role:

    tools/list        list the tools the caller may use
    tools/call        execute a tool (MCP Toolbox proxy / cache query / memory read)
    read-memory       read a text-memory file (role-scoped path)
    query-cache       run a read-only SELECT against the cache
    get-sync-status   admin-only sync status

The transport (ASGI streamable_http) lives in :mod:`.server`; these handlers are
transport-agnostic and unit-testable.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Optional

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.toolsets import ToolsetResolver


class MCPError(Exception):
    """An MCP-level error with a JSON-RPC-style code."""

    def __init__(self, message: str, code: int = -32000):
        super().__init__(message)
        self.code = code


class PermissionDenied(MCPError):
    def __init__(self, message: str):
        super().__init__(message, code=-32003)


@dataclass
class MCPContext:
    permissions: Permissions
    files_root: str = "/ontology"


class MCPHandlers:
    """Role-scoped handlers for the MCP methods."""

    def __init__(self, ctx: MCPContext, resolver: Optional[ToolsetResolver] = None) -> None:
        self.ctx = ctx
        self.resolver = resolver or ToolsetResolver()

    # -- tools/list ------------------------------------------------------
    def list_tools(self) -> list[dict]:
        specs = self.resolver.tool_specs(self.ctx.permissions)
        return [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("parameters", []),
            }
            for t in specs
        ]

    # -- read-memory -----------------------------------------------------
    def read_memory(self, path: str) -> str:
        # Permission check is against the logical "/ontology/..." namespace.
        if not self.ctx.permissions.allows_memory_path(path):
            raise PermissionDenied(f"role '{self.ctx.permissions.role}' cannot read {path}")
        candidate = self._physical_path(path)
        if not os.path.exists(candidate):
            raise MCPError(f"file not found: {path}")
        with open(candidate) as f:
            return f.read()

    def _physical_path(self, path: str) -> str:
        """Map a logical /ontology/... path to a physical path under files_root.

        Blocks traversal outside the configured memory root.
        """
        safe_root = os.path.normpath(self.ctx.files_root)
        # Strip a leading logical "/ontology" prefix, then anchor under the root.
        rel = path.lstrip("/")
        logical_prefix = "ontology/"
        if rel.startswith(logical_prefix):
            rel = rel[len(logical_prefix):]
        candidate = os.path.normpath(os.path.join(safe_root, rel))
        if candidate != safe_root and not candidate.startswith(safe_root + os.sep):
            raise PermissionDenied("path escapes the memory root")
        return candidate

    # -- query-cache -----------------------------------------------------
    def query_cache(self, sql: str, limit: int = 100) -> list[dict]:
        stripped = sql.strip().rstrip(";").lstrip().upper()
        if not stripped.startswith(("SELECT", "WITH")):
            raise MCPError("only SELECT/WITH queries are allowed")
        from django.db import connection

        with connection.cursor() as cur:
            cur.execute(sql)
            cols = [c[0] for c in cur.description] if cur.description else []
            rows = cur.fetchmany(limit)
        # Cache-table scoping is enforced at tool-definition time; this is a guard.
        return [dict(zip(cols, r)) for r in rows]

    # -- get-sync-status (admin) ----------------------------------------
    def get_sync_status(self) -> list[dict]:
        if not (
            self.ctx.permissions.admin_dashboard
            or "admin-analytics-tools" in self.ctx.permissions.mcp_toolsets
            or "*" in self.ctx.permissions.mcp_toolsets
        ):
            raise PermissionDenied("sync status requires an admin role")
        from iblai_ontology.backend.sync.models import SyncRun

        return [
            {
                "schedule": r.schedule_name,
                "status": r.status,
                "started_at": str(r.started_at),
                "records": r.records_processed,
            }
            for r in SyncRun.objects.order_by("-started_at")[:50]
        ]

    # -- tools/call ------------------------------------------------------
    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        # Built-in tools the gateway serves directly.
        if name == "read-memory":
            return self.read_memory(arguments["path"])
        if name in ("query-ontology-cache", "query-cache"):
            return self.query_cache(arguments["sql"], limit=int(arguments.get("limit", 100)))
        if name == "get-sync-status":
            return self.get_sync_status()

        # Otherwise the tool must be in the caller's scoped set and is proxied to
        # the inbound MCP Toolbox.
        allowed = set(self.resolver.scope_for(self.ctx.permissions).tool_names)
        if name not in allowed:
            raise PermissionDenied(f"role '{self.ctx.permissions.role}' cannot call {name}")
        return self._proxy_to_toolbox(name, arguments)

    def _proxy_to_toolbox(self, name: str, arguments: dict[str, Any]) -> Any:
        toolbox_url = os.environ.get("MCP_TOOLBOX_URL", "http://mcp-toolbox:5000")
        import httpx

        resp = httpx.post(
            f"{toolbox_url}/api/tool/{name}", json=arguments, timeout=30
        )
        resp.raise_for_status()
        return resp.json()


def dispatch(handlers: MCPHandlers, request: dict) -> dict:
    """Dispatch a single JSON-RPC request to the handlers; return the response."""
    method = request.get("method")
    params = request.get("params", {}) or {}
    req_id = request.get("id")
    try:
        if method == "tools/list":
            result: Any = {"tools": handlers.list_tools()}
        elif method == "tools/call":
            value = handlers.call_tool(params["name"], params.get("arguments", {}))
            result = {"content": [{"type": "text", "text": json.dumps(value, default=str)}]}
        else:
            raise MCPError(f"unknown method: {method}", code=-32601)
        return {"jsonrpc": "2.0", "result": result, "id": req_id}
    except MCPError as exc:
        return {"jsonrpc": "2.0", "error": {"code": exc.code, "message": str(exc)}, "id": req_id}
