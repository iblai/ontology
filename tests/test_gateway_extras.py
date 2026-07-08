"""Extra coverage for the platform client and MCP handlers (no DB)."""

from __future__ import annotations

import json

import httpx
import pytest

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.handlers import (
    MCPContext,
    MCPError,
    MCPHandlers,
    PermissionDenied,
    dispatch,
)


def _handlers(perms, **ctx):
    from iblai_ontology.backend.mcp_server.toolsets import ToolsetResolver

    class R(ToolsetResolver):
        def __init__(self):
            pass

        def scope_for(self, p):
            from iblai_ontology.backend.mcp_server.toolsets import ScopedTools

            return ScopedTools(toolsets=["t"], tool_names=["allowed-tool"])

        def tool_specs(self, p):
            return [{"name": "allowed-tool", "description": "d", "parameters": []}]

    return MCPHandlers(MCPContext(permissions=perms, **ctx), resolver=R())


def test_query_cache_rejects_non_select():
    h = _handlers(Permissions(role="Executive", display_name="x", mcp_toolsets=["*"]))
    with pytest.raises(MCPError):
        h.query_cache("DELETE FROM students")


def test_query_cache_rejects_cte_dml():
    # A CTE that hides a DELETE must not pass the SELECT/WITH validation.
    h = _handlers(Permissions(role="Executive", display_name="x", mcp_toolsets=["*"]))
    # Stacked statements are rejected outright...
    with pytest.raises(MCPError):
        h.query_cache("SELECT 1; DROP TABLE students")


def test_call_tool_cache_alias_denied_for_default_role():
    # The `default` role has no toolsets → the cache aliases must be denied,
    # even though they are served by a built-in handler (scope-bypass regression).
    from iblai_ontology.backend.mcp_server.toolsets import ScopedTools, ToolsetResolver

    class R(ToolsetResolver):
        def __init__(self):
            pass

        def scope_for(self, p):
            return ScopedTools(toolsets=[], tool_names=[])

    from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers

    perms = Permissions(role="default", display_name="x", mcp_toolsets=[])
    h = MCPHandlers(MCPContext(permissions=perms), resolver=R())
    for alias in ("query-cache", "query-ontology-cache"):
        with pytest.raises(PermissionDenied):
            h.call_tool(alias, {"sql": "SELECT 1"})


def test_call_tool_cache_alias_scoped_reaches_query_cache(monkeypatch):
    # A role that DOES have query-ontology-cache in scope passes the scope gate
    # and reaches query_cache (which we stub to avoid needing a live DB).
    from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers
    from iblai_ontology.backend.mcp_server.toolsets import ScopedTools, ToolsetResolver

    class R(ToolsetResolver):
        def __init__(self):
            pass

        def scope_for(self, p):
            return ScopedTools(
                toolsets=["admin-analytics-tools"],
                tool_names=["query-ontology-cache"],
            )

    perms = Permissions(role="DataAnalyst", display_name="x")
    h = MCPHandlers(MCPContext(permissions=perms), resolver=R())
    seen = {}
    monkeypatch.setattr(
        h, "query_cache", lambda sql, limit=100: seen.update(sql=sql) or [{"ok": 1}]
    )
    out = h.call_tool("query-cache", {"sql": "SELECT 1"})
    assert out == [{"ok": 1}]
    assert seen["sql"] == "SELECT 1"


def test_get_sync_status_requires_admin():
    h = _handlers(
        Permissions(
            role="Student",
            display_name="x",
            mcp_toolsets=["student-self-service-tools"],
        )
    )
    with pytest.raises(PermissionDenied):
        h.get_sync_status()


def test_call_tool_unknown_denied():
    h = _handlers(Permissions(role="x", display_name="x", mcp_toolsets=["t"]))
    with pytest.raises(PermissionDenied):
        h.call_tool("not-in-scope", {})


def _subject_handlers(perms, subject_id):
    """Handler whose resolver scopes get-student-enrollment, with a stubbed proxy."""
    from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers
    from iblai_ontology.backend.mcp_server.toolsets import ScopedTools, ToolsetResolver

    class R(ToolsetResolver):
        def __init__(self):
            pass

        def scope_for(self, p):
            return ScopedTools(toolsets=["t"], tool_names=["get-student-enrollment"])

    h = MCPHandlers(MCPContext(permissions=perms, subject_id=subject_id), resolver=R())
    h._proxy_to_toolbox = lambda name, arguments: {"ok": name, "args": arguments}
    return h


def test_self_service_role_may_query_own_record():
    perms = Permissions(role="Student", display_name="x", self_service=True)
    h = _subject_handlers(perms, subject_id="001234567")
    out = h.call_tool("get-student-enrollment", {"student_id": "001234567"})
    assert out["ok"] == "get-student-enrollment"


def test_self_service_role_cannot_query_another_subject():
    perms = Permissions(role="Student", display_name="x", self_service=True)
    h = _subject_handlers(perms, subject_id="001234567")
    with pytest.raises(PermissionDenied):
        h.call_tool("get-student-enrollment", {"student_id": "999999999"})


def test_self_service_role_without_known_subject_denied():
    # Fail closed: no resolved emplid -> cannot prove ownership.
    perms = Permissions(role="Student", display_name="x", self_service=True)
    h = _subject_handlers(perms, subject_id=None)
    with pytest.raises(PermissionDenied):
        h.call_tool("get-student-enrollment", {"student_id": "001234567"})


def test_staff_role_may_query_any_subject():
    # Non-self-service role: cross-subject access is granted by role.
    perms = Permissions(role="AcademicAdvisor", display_name="x")
    h = _subject_handlers(perms, subject_id="000000001")
    out = h.call_tool("get-student-enrollment", {"student_id": "999999999"})
    assert out["args"]["student_id"] == "999999999"


def test_dispatch_tool_call_read_memory(tmp_path):
    root = tmp_path / "ontology"
    (root / "courses").mkdir(parents=True)
    (root / "courses" / "_index.md").write_text("# Courses")
    perms = Permissions(
        role="default", display_name="x", memory_paths=["/ontology/courses/**"]
    )
    h = _handlers(perms, files_root=str(root))
    resp = dispatch(
        h,
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "read-memory",
                "arguments": {"path": "/ontology/courses/_index.md"},
            },
        },
    )
    assert resp["id"] == 5
    assert "Courses" in resp["result"]["content"][0]["text"]


# --- platform client ------------------------------------------------------
def test_platform_attach_to_agent():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True})

    from iblai_ontology.backend.platform.client import PlatformClient, PlatformConfig

    client = PlatformClient(
        PlatformConfig(base_url="https://x", org="alasu", admin_token="t"),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    out = client.attach_to_agent(agent_id="agent-uuid", server_id=14)
    assert out["ok"] is True
    assert captured["method"] == "PATCH"
    assert captured["body"]["mcp_servers"] == [14]


def test_platform_config_from_env(monkeypatch):
    from iblai_ontology.backend.platform.client import PlatformConfig

    monkeypatch.setenv("IBLAI_ORG", "alasu")
    monkeypatch.setenv("IBLAI_ADMIN_TOKEN", "tok")
    cfg = PlatformConfig.from_env()
    assert cfg.org == "alasu" and cfg.admin_token == "tok"

    monkeypatch.delenv("IBLAI_ORG")
    with pytest.raises(RuntimeError):
        PlatformConfig.from_env()
