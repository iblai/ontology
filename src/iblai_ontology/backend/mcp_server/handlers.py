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

# Argument names that carry a subject (person) identifier. For a self-service
# role these must equal the caller's own subject id (see _require_subject_ownership).
SUBJECT_ARG_KEYS = ("student_id", "student", "student_sis_id", "emplid")


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
    # The caller's own subject id (emplid), resolved from their token via the
    # IdentityMap. Used to self-scope subject tools for self-service roles.
    subject_id: Optional[str] = None


class MCPHandlers:
    """Role-scoped handlers for the MCP methods."""

    def __init__(
        self, ctx: MCPContext, resolver: Optional[ToolsetResolver] = None
    ) -> None:
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
            raise PermissionDenied(
                f"role '{self.ctx.permissions.role}' cannot read {path}"
            )
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
            rel = rel[len(logical_prefix) :]
        candidate = os.path.normpath(os.path.join(safe_root, rel))
        if candidate != safe_root and not candidate.startswith(safe_root + os.sep):
            raise PermissionDenied("path escapes the memory root")
        return candidate

    # -- query-cache -----------------------------------------------------
    @staticmethod
    def _validate_read_only_sql(sql: str) -> str:
        """Return the single statement to execute, or raise :class:`MCPError`.

        Accepts one ``SELECT``/``WITH`` statement (a single optional trailing
        ``;`` is allowed); rejects non-strings, empty input, stacked statements,
        and any lead other than ``SELECT``/``WITH``. Writes hidden in a CTE are
        not caught here — :meth:`query_cache` runs the statement in a PostgreSQL
        ``READ ONLY`` transaction that rejects them at execution time.
        """
        if not isinstance(sql, str):
            raise MCPError("sql must be a string")
        statement = sql.strip()
        # Allow a single optional trailing ';' but reject stacked statements.
        body = statement.rstrip(";").rstrip()
        if not body:
            raise MCPError("empty query")
        if ";" in body:
            raise MCPError("only a single SQL statement is allowed")
        # Ignore leading '(' so parenthesised selects still validate.
        head = body.lstrip("(").lstrip().upper()
        if not head.startswith(("SELECT", "WITH")):
            raise MCPError("only SELECT/WITH read-only queries are allowed")
        return body

    def query_cache(self, sql: str, limit: int = 100) -> list[dict]:
        statement = self._validate_read_only_sql(sql)
        limit = max(1, int(limit))
        from django.db import connection

        with connection.cursor() as cur:
            # READ ONLY transaction: any write, including DML hidden in a CTE,
            # fails at the engine. Always rolled back; this path never commits.
            cur.execute("BEGIN TRANSACTION READ ONLY")
            try:
                cur.execute(statement)
                cols = [c[0] for c in cur.description] if cur.description else []
                rows = cur.fetchmany(limit)
            finally:
                cur.execute("ROLLBACK")
        # Does not enforce per-table cache-table ACLs.
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
    def _require_scoped(self, tool_name: str) -> None:
        """Deny unless ``tool_name`` is in the caller's role-scoped tool set."""
        allowed = set(self.resolver.scope_for(self.ctx.permissions).tool_names)
        if tool_name not in allowed:
            raise PermissionDenied(
                f"role '{self.ctx.permissions.role}' cannot call {tool_name}"
            )

    def _require_subject_ownership(self, arguments: dict[str, Any]) -> None:
        """Restrict subject-scoped tools to the caller for self-service roles.

        A self-service role may only query its own record: any subject-identifier
        argument (see :data:`SUBJECT_ARG_KEYS`) must equal the caller's own
        subject id, and the caller must have a known subject id. Non-self-service
        roles are unrestricted here — cross-subject access is granted by role per
        the authorization model (docs/authorization-model.md).
        """
        if not self.ctx.permissions.self_service:
            return
        for key in SUBJECT_ARG_KEYS:
            if key not in arguments:
                continue
            requested = str(arguments[key])
            if not self.ctx.subject_id or requested != self.ctx.subject_id:
                raise PermissionDenied(
                    f"role '{self.ctx.permissions.role}' may only access its own record"
                )

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        # Built-in tools are served directly here but remain subject to
        # authorization: read-memory and get-sync-status carry their own checks;
        # the cache-query aliases pass the same toolset-scope test as any tool.
        if name == "read-memory":
            return self.read_memory(arguments["path"])
        if name in ("query-ontology-cache", "query-cache"):
            # `query-cache` is an alias for the scoped `query-ontology-cache`
            # tool; both are gated on that tool being in the caller's scope.
            self._require_scoped("query-ontology-cache")
            return self.query_cache(
                arguments["sql"], limit=int(arguments.get("limit", 100))
            )
        if name == "get-sync-status":
            return self.get_sync_status()

        # Otherwise the tool must be in the caller's scoped set and is proxied to
        # the inbound MCP Toolbox. Self-service roles are additionally restricted
        # to their own subject record.
        self._require_scoped(name)
        self._require_subject_ownership(arguments)
        return self._proxy_to_toolbox(name, arguments)

    def _proxy_to_toolbox(self, name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on the inbound MCP Toolbox via the shared /mcp client."""
        from iblai_ontology.backend.mcp_server.toolbox_client import (
            ToolboxError,
            call_tool,
        )

        toolbox_url = os.environ.get("MCP_TOOLBOX_URL", "http://mcp-toolbox:5000")
        try:
            return call_tool(toolbox_url, name, arguments)
        except ToolboxError as exc:
            raise MCPError(str(exc)) from exc


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
            result = {
                "content": [{"type": "text", "text": json.dumps(value, default=str)}]
            }
        else:
            raise MCPError(f"unknown method: {method}", code=-32601)
        return {"jsonrpc": "2.0", "result": result, "id": req_id}
    except MCPError as exc:
        return {
            "jsonrpc": "2.0",
            "error": {"code": exc.code, "message": str(exc)},
            "id": req_id,
        }
