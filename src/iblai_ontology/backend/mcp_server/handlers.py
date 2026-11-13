"""MCP method handlers (Component 4).

Implements the MCP JSON-RPC surface exposed by the outbound gateway, scoped by
the caller's resolved role:

    initialize / ping  the handshake a standard MCP client opens with
    tools/list         list the tools the caller may use (with their inputSchema)
    tools/call         execute a tool (MCP Toolbox proxy / cache query / memory read)
    read-memory        read a text-memory file (role-scoped path)
    describe-cache     the cache tables the role may query, with their columns
    query-cache        run a read-only SELECT against the cache
    get-sync-status    admin-only sync status

The transport (stateless streamable HTTP) lives in :mod:`.server`; these handlers
are transport-agnostic and unit-testable.
"""

from __future__ import annotations

import json
import os
import posixpath
from dataclasses import dataclass
from typing import Any, Callable, Optional

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.toolbox_config import GATEWAY_TYPES
from iblai_ontology.backend.mcp_server.toolsets import ToolsetResolver

# Argument names that carry a subject (person) identifier. For a self-service
# role these must equal the caller's own subject id (see _require_subject_ownership).
SUBJECT_ARG_KEYS = ("student_id", "student", "student_sis_id", "emplid")

# The MCP revision answered to `initialize` when the client names none.
PROTOCOL_VERSION = "2025-03-26"

# DSL parameter types -> JSON Schema types (anything else is a string).
_JSON_TYPES = {
    "string": "string",
    "integer": "integer",
    "int": "integer",
    "float": "number",
    "number": "number",
    "boolean": "boolean",
    "bool": "boolean",
    "array": "array",
    "map": "object",
}

_LISTED = 200  # names in one folder listing

# The gateway's own tools, in the DSL shape tools.yaml uses.
BUILTIN_TOOLS = {
    "read-memory": {
        "name": "read-memory",
        "description": (
            "Read one text memory (Markdown) by its /ontology/... path. "
            "A folder's path lists what is in it: start at /ontology."
        ),
        "parameters": [
            {
                "name": "path",
                "type": "string",
                "description": "Logical path, e.g. /ontology or /ontology/students/S1.md",
            }
        ],
    },
    "describe-ontology-cache": {
        "name": "describe-ontology-cache",
        "description": (
            "List the ontology cache tables you may query, each with its columns. "
            "Call this before query-ontology-cache."
        ),
        "parameters": [],
    },
    "query-ontology-cache": {
        "name": "query-ontology-cache",
        "description": "Run one read-only SELECT against the ontology cache tables.",
        "parameters": [
            {
                "name": "sql",
                "type": "string",
                "description": "A single SELECT statement",
            },
            {
                "name": "limit",
                "type": "integer",
                "description": "Rows to return (default 100)",
                "required": False,
            },
        ],
    },
    "get-sync-status": {
        "name": "get-sync-status",
        "description": "The latest sync runs of every schedule (admin roles).",
        "parameters": [],
    },
}


# Where a tool keeps its arguments: `parameters`, and for an http tool these four lists too.
_PARAMETER_KEYS = (
    "parameters",
    "pathParams",
    "queryParams",
    "bodyParams",
    "headerParams",
)


def tool_parameters(spec: dict) -> list[dict]:
    """Every argument a caller gives a tool, whichever list of its spec declares it.

    A system's own tool keeps its header to itself: the gateway fills it with the key.
    """
    keys = [
        k for k in _PARAMETER_KEYS if k != "headerParams" or not spec.get("service")
    ]
    return [p for key in keys for p in spec.get(key) or []]


def input_schema(parameters: list[dict]) -> dict:
    """The JSON Schema an MCP client expects for a tool's arguments."""
    properties, required = {}, []
    for p in parameters or []:
        name = str(p.get("name", ""))
        properties[name] = {
            "type": _JSON_TYPES.get(str(p.get("type", "string")).lower(), "string"),
            "description": str(p.get("description", "")),
        }
        if p.get("required", True):
            required.append(name)
    return {"type": "object", "properties": properties, "required": required}


def server_info() -> dict:
    from importlib.metadata import PackageNotFoundError, version

    try:
        v = version("iblai-ontology")
    except PackageNotFoundError:  # pragma: no cover - source checkout without install
        v = "0"
    return {"name": "iblai-ontology", "version": v}


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
    # Called with (tool, arguments) before a tool that can change data runs; raises to stop it.
    before_write: Optional[Callable[[str, dict], None]] = None


class MCPHandlers:
    """Role-scoped handlers for the MCP methods."""

    def __init__(
        self, ctx: MCPContext, resolver: Optional[ToolsetResolver] = None
    ) -> None:
        self.ctx = ctx
        self.resolver = resolver or ToolsetResolver()

    # -- tools/list ------------------------------------------------------
    def list_tools(self) -> list[dict]:
        """The caller's tools: tools.yaml ones in scope, plus the gateway's own."""
        specs = {t["name"]: t for t in self.resolver.tool_specs(self.ctx.permissions)}
        # The gateway serves these itself: its own schema, and its own rule for who gets them.
        cache_tools = ("describe-ontology-cache", "query-ontology-cache")
        for name in cache_tools:
            specs.pop(name, None)
        specs["read-memory"] = BUILTIN_TOOLS["read-memory"]
        if self.ctx.permissions.cache_tables:
            specs |= {name: BUILTIN_TOOLS[name] for name in cache_tools}
        if self._may_see_sync_status():
            specs.setdefault("get-sync-status", BUILTIN_TOOLS["get-sync-status"])
        writing = self.resolver.writing
        return [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": tool_parameters(t),
                "inputSchema": input_schema(tool_parameters(t)),
                # MCP's hints: a client may ask its user before a tool that is not read-only.
                "annotations": (
                    {"readOnlyHint": False, "destructiveHint": True}
                    if t["name"] in writing
                    else {"readOnlyHint": True}
                ),
            }
            for t in specs.values()
        ]

    def _may_see_sync_status(self) -> bool:
        perms = self.ctx.permissions
        return (
            perms.admin_dashboard
            or "admin-analytics-tools" in perms.mcp_toolsets
            or "*" in perms.mcp_toolsets
        )

    # -- read-memory -----------------------------------------------------
    def read_memory(self, path: str) -> str:
        # Permission check is against the logical "/ontology/..." namespace, with ".."
        # resolved first: a path may not climb out of a granted folder into another.
        path = posixpath.normpath(path)
        candidate = self._physical_path(path)
        if os.path.isdir(candidate):
            return self._list_memories(path, candidate)
        if not self.ctx.permissions.allows_memory_path(path):
            raise PermissionDenied(
                f"role '{self.ctx.permissions.role}' cannot read {path}"
            )
        if not os.path.exists(candidate):
            raise MCPError(f"file not found: {path}")
        with open(candidate) as f:
            return f.read()

    def _list_memories(self, path: str, folder: str) -> str:
        """A folder's listing: what in it this role may read, or what leads to something it may.

        A folder that shows the role nothing is refused in a file's words, so it cannot be
        told from one that is not there.
        """
        perms = self.ctx.permissions
        base = path.rstrip("/")
        seen = []
        for name in sorted(os.listdir(folder)):
            child = f"{base}/{name}"
            if os.path.isdir(os.path.join(folder, name)):
                inside = f"{child}/"
                if perms.allows_memory_path(f"{inside}_") or any(
                    granted.startswith(inside) for granted in perms.memory_paths
                ):
                    seen.append(inside)
            elif perms.allows_memory_path(child):
                seen.append(child)
        if not seen:
            raise PermissionDenied(f"role '{perms.role}' cannot read {path}")
        # ponytail: the first 200 names; a search tool if agents need to find one among thousands.
        more = len(seen) - _LISTED
        lines = seen[:_LISTED]
        if more > 0:
            lines.append(f"... and {more} more: read one by its path.")
        return "\n".join(lines)

    def _physical_path(self, path: str) -> str:
        """Map a logical /ontology/... path to a physical path under files_root.

        Blocks traversal outside the configured memory root both lexically and
        after resolving symlinks: a symlink under the root that points outside it
        cannot escape, because the fully resolved real path is re-checked against
        the resolved root. Returns the resolved (canonical) path.
        """
        safe_root = os.path.normpath(self.ctx.files_root)
        # Strip a leading logical "/ontology" prefix, then anchor under the root.
        rel = path.lstrip("/")
        logical_prefix = "ontology/"
        # "/ontology" itself is the root, as "/ontology/" is.
        if rel == "ontology" or rel.startswith(logical_prefix):
            rel = rel[len(logical_prefix) :]
        candidate = os.path.normpath(os.path.join(safe_root, rel))
        if candidate != safe_root and not candidate.startswith(safe_root + os.sep):
            raise PermissionDenied("path escapes the memory root")
        # Re-check containment after resolving symlinks (realpath resolves every
        # component), so a symlink inside the root pointing elsewhere is rejected.
        real_root = os.path.realpath(safe_root)
        real_candidate = os.path.realpath(candidate)
        if real_candidate != real_root and not real_candidate.startswith(
            real_root + os.sep
        ):
            raise PermissionDenied("path escapes the memory root")
        return real_candidate

    # -- describe-cache --------------------------------------------------
    def _require_tables(self) -> None:
        """Deny unless the role may query some cache table: the grant is the table, not a toolset."""
        if not self.ctx.permissions.cache_tables:
            raise PermissionDenied(
                f"role '{self.ctx.permissions.role}' cannot query the ontology cache"
            )

    def describe_cache(self) -> list[dict]:
        """The cache tables the caller may query, each with its columns."""
        from django.db import connection

        from iblai_ontology.backend.sync import schedules

        perms = self.ctx.permissions
        # What the schedules fill, and what the role names itself (the two logs, say).
        named = {
            (sched.get("output") or {}).get("structured_cache")
            for sched in schedules.all()
        } | set(perms.cache_tables)
        with connection.cursor() as cursor:
            reader = connection.introspection
            present = set(reader.table_names(cursor))
            return [
                {
                    "table": table,
                    "columns": [
                        c.name for c in reader.get_table_description(cursor, table)
                    ],
                }
                for table in sorted(
                    t for t in named if t in present and perms.allows_cache_table(t)
                )
            ]

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

    @staticmethod
    def _relation_names(explain_json: Any) -> set[str]:
        """Collect every base ``Relation Name`` in an ``EXPLAIN (FORMAT JSON)`` plan.

        Walks the whole plan tree so tables reached through joins, subqueries,
        CTEs, and views are all included (the planner resolves them to their
        underlying relations). ``explain_json`` may be a parsed object or a JSON
        string, depending on the driver.
        """
        if isinstance(explain_json, str):
            explain_json = json.loads(explain_json)
        names: set[str] = set()
        stack = [explain_json]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                rel = node.get("Relation Name")
                if rel:
                    names.add(rel)
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
        return names

    def _enforce_cache_acl(self, cur, statement: str) -> None:
        """Deny the query if it touches a cache table the role may not read.

        The referenced relations are taken from the query plan
        (``EXPLAIN (FORMAT JSON)``), which is the database's own resolution of
        what the query reads, and each is checked against the role's
        ``cache_tables`` ACL. Runs in the caller's READ ONLY transaction;
        ``EXPLAIN`` plans but does not execute the query.
        """
        perms = self.ctx.permissions
        if "*" in perms.cache_tables:
            return
        cur.execute("EXPLAIN (FORMAT JSON) " + statement)
        row = cur.fetchone()
        tables = self._relation_names(row[0] if row else [])
        forbidden = sorted(t for t in tables if not perms.allows_cache_table(t))
        if forbidden:
            raise PermissionDenied(
                f"role '{perms.role}' cannot access cache table(s): "
                + ", ".join(forbidden)
            )

    def query_cache(self, sql: str, limit: int = 100) -> list[dict]:
        statement = self._validate_read_only_sql(sql)
        limit = max(1, int(limit))
        # The role's "rows per cache query"; anything but a whole number above zero is no limit.
        cap = self.ctx.permissions.concurrency_limits.get("max_records_per_query")
        if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0:
            limit = min(limit, cap)
        from django.db import connection

        sqlite = connection.vendor == "sqlite"
        if sqlite and "*" not in self.ctx.permissions.cache_tables:
            # The plan-based table ACL is PostgreSQL's; a scoped role on SQLite gets a clear no.
            raise PermissionDenied(
                f"role '{self.ctx.permissions.role}' is limited to some cache tables, "
                "which only a PostgreSQL cache can enforce"
            )
        with connection.cursor() as cur:
            # A read-only transaction (PostgreSQL) or connection (SQLite's query_only):
            # any write, including DML hidden in a CTE, fails at the engine. Always
            # rolled back; this path never commits.
            cur.execute(
                "PRAGMA query_only = ON" if sqlite else "BEGIN TRANSACTION READ ONLY"
            )
            try:
                self._enforce_cache_acl(cur, statement)
                cur.execute(statement)
                cols = [c[0] for c in cur.description] if cur.description else []
                rows = cur.fetchmany(limit)
            finally:
                cur.execute("PRAGMA query_only = OFF" if sqlite else "ROLLBACK")
        return [dict(zip(cols, r)) for r in rows]

    # -- get-sync-status (admin) ----------------------------------------
    def get_sync_status(self) -> list[dict]:
        if not self._may_see_sync_status():
            raise PermissionDenied("sync status requires an admin role")
        from iblai_ontology.backend import store
        from iblai_ontology.backend.sync.models import SyncRun

        return [
            {
                "schedule": r.schedule_name,
                "status": r.status,
                "started_at": str(r.started_at),
                "records": r.records_processed,
            }
            for r in store.filter(SyncRun, order="-started_at", limit=50)
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
        # the cache tools need a table grant, and the query checks each table it reads.
        if name == "read-memory":
            return self.read_memory(arguments["path"])
        if name == "describe-ontology-cache":
            self._require_tables()
            return self.describe_cache()
        if name in ("query-ontology-cache", "query-cache"):
            self._require_tables()
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
        spec = self.resolver.spec(name)
        if name in self.resolver.writing:
            # A change is recorded before it is made: no recorder, no change.
            if self.ctx.before_write is None:
                raise PermissionDenied(
                    f"{name} can change data and runs only through the gateway, "
                    "which records the call first"
                )
            self.ctx.before_write(name, arguments)
            # An API system's own operation is always a change, and never the Toolbox's.
            if spec.get("type") in GATEWAY_TYPES:
                return self._change_at_source(spec, arguments)
        if spec.get("type") == "http" and spec.get("service"):
            return self._call_system(spec, arguments)
        return self._proxy_to_toolbox(name, arguments)

    def _call_system(self, spec: dict, arguments: dict[str, Any]) -> Any:
        """A custom API's endpoint: the Toolbox's call, with the system's key added here.

        After the change was recorded, so the audit log never holds the key; and the key
        is masked in what comes back, for an API that echoes what it was sent.
        """
        from iblai_ontology.backend.services import http_api

        try:
            arguments, key = http_api.signed(
                spec, self.resolver.source(str(spec.get("source") or "")), arguments
            )
        except http_api.ApiError as exc:
            raise MCPError(str(exc)) from exc
        try:
            return http_api.without(
                key, self._proxy_to_toolbox(spec["name"], arguments)
            )
        except MCPError as exc:
            # Not chained: the Toolbox's own error may hold what the API echoed.
            raise MCPError(http_api.without(key, str(exc)), code=exc.code) from None

    def _change_at_source(self, spec: dict, arguments: dict[str, Any]) -> dict:
        """Run an API system's named operation here, then hand the record to the cache.

        The change is made with the system's own registry login; what the system refuses
        is raised, and reaches the agent as the tool's error. The worker writes the cache
        row and the memory; when it cannot be told, the answer says so and stays a success,
        since the change already happened.
        """
        from iblai_ontology.backend import store
        from iblai_ontology.backend.services import twenty
        from iblai_ontology.backend.services.encryption import decrypt_connection_config
        from iblai_ontology.backend.services.models import Service
        from iblai_ontology.backend.sync import tasks
        from iblai_ontology.catalog import get_entry

        service = store.first(Service, name=spec.get("service"))
        if service is None or service.adapter != twenty.ADAPTER:
            raise MCPError(f"{spec['name']} names a system that is not connected")
        config = decrypt_connection_config(service.connection_config_encrypted)
        record, rows = twenty.call(config, get_entry(spec["type"]), spec, arguments)
        try:
            for plural, changed in rows.items():
                tasks.write_rows.delay(f"{service.name}-{plural}", changed)
            cache = "refresh queued"
        except Exception as exc:
            cache = f"not refreshed ({exc}); the next sync brings it in"
        return {"record": record, "cache": cache}

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


def dispatch(handlers: MCPHandlers, request: dict) -> dict | None:
    """Dispatch one JSON-RPC message; ``None`` for a notification (no response body)."""
    method = request.get("method")
    params = request.get("params", {}) or {}
    req_id = request.get("id")
    if isinstance(method, str) and method.startswith("notifications/"):
        return None
    try:
        if method == "initialize":
            result: Any = {
                # Echo the client's revision: this surface is the same under every one.
                "protocolVersion": params.get("protocolVersion") or PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": server_info(),
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": handlers.list_tools()}
        elif method == "tools/call":
            try:
                value = handlers.call_tool(params["name"], params.get("arguments", {}))
                result = {
                    "content": [
                        {"type": "text", "text": json.dumps(value, default=str)}
                    ]
                }
            except MCPError:
                raise
            except Exception as exc:
                # A tool that failed (bad SQL, unreachable source) is a result the
                # agent can read, not a transport failure that drops every tool.
                result = {
                    "content": [
                        {"type": "text", "text": f"{type(exc).__name__}: {exc}"}
                    ],
                    "isError": True,
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
