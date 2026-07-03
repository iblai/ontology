"""Unit tests for the MCP outbound gateway (toolset scoping, handlers, dispatch)."""

from __future__ import annotations

import json

import pytest

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.handlers import (
    MCPContext,
    MCPHandlers,
    PermissionDenied,
    dispatch,
)
from iblai_ontology.backend.mcp_server.toolsets import ToolsetResolver


class FakeReader:
    """Stand-in ConfigReader with two toolsets and three tools."""

    def get_toolsets(self):
        return {
            "enrollment-tools": {
                "tools": ["get-student-enrollment", "search-students"]
            },
            "financial-aid-tools": {"tools": ["get-aid-package"]},
        }

    def get_tools(self):
        return [
            {
                "name": "get-student-enrollment",
                "description": "enroll",
                "parameters": [],
            },
            {"name": "search-students", "description": "search", "parameters": []},
            {"name": "get-aid-package", "description": "aid", "parameters": []},
        ]


def _resolver():
    return ToolsetResolver(reader=FakeReader())


def test_scope_limits_tools_to_role():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    scoped = _resolver().scope_for(perms)
    assert scoped.toolsets == ["enrollment-tools"]
    assert "get-student-enrollment" in scoped.tool_names
    assert "get-aid-package" not in scoped.tool_names


def test_wildcard_role_sees_all():
    perms = Permissions(role="Executive", display_name="x", mcp_toolsets=["*"])
    scoped = _resolver().scope_for(perms)
    assert set(scoped.toolsets) == {"enrollment-tools", "financial-aid-tools"}
    assert "get-aid-package" in scoped.tool_names


def test_list_tools_handler():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    tools = handlers.list_tools()
    names = {t["name"] for t in tools}
    assert names == {"get-student-enrollment", "search-students"}


def test_call_disallowed_tool_denied():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    with pytest.raises(PermissionDenied):
        handlers.call_tool("get-aid-package", {})


def test_read_memory_scoping(tmp_path):
    root = tmp_path / "ontology"
    (root / "students" / "by-id").mkdir(parents=True)
    (root / "students" / "by-id" / "1.md").write_text("# Student 1")
    perms = Permissions(
        role="Student",
        display_name="x",
        memory_paths=["/ontology/students/by-id/1.md"],
    )
    handlers = MCPHandlers(
        MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
    )
    assert "Student 1" in handlers.read_memory("/ontology/students/by-id/1.md")
    with pytest.raises(PermissionDenied):
        handlers.read_memory("/ontology/students/by-id/2.md")


def test_read_memory_blocks_traversal(tmp_path):
    root = tmp_path / "ontology"
    root.mkdir()
    perms = Permissions(
        role="Executive", display_name="x", memory_paths=["/ontology/**"]
    )
    handlers = MCPHandlers(
        MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
    )
    with pytest.raises(PermissionDenied):
        handlers._physical_path("/ontology/../../etc/passwd")


def test_dispatch_tools_list():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    resp = dispatch(handlers, {"jsonrpc": "2.0", "method": "tools/list", "id": 1})
    assert resp["id"] == 1
    assert len(resp["result"]["tools"]) == 2


def test_dispatch_unknown_method_errors():
    perms = Permissions(role="default", display_name="x")
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    resp = dispatch(handlers, {"jsonrpc": "2.0", "method": "nope", "id": 9})
    assert resp["error"]["code"] == -32601


def test_platform_client_register_and_connect():
    import httpx

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured[request.url.path] = json.loads(request.content)
        return httpx.Response(200, json={"id": 14, "ok": True})

    from iblai_ontology.backend.platform.client import PlatformClient, PlatformConfig

    transport = httpx.MockTransport(handler)
    client = PlatformClient(
        PlatformConfig(base_url="https://x", org="alasu", admin_token="t"),
        client=httpx.Client(transport=transport),
    )
    reg = client.register_mcp_server(name="iblai-ontology", url="https://o/mcp")
    assert reg["id"] == 14
    client.create_connection(server=14, scope="user", role="Student", user="jdoe")
    assert any("mcp-server-connections" in p for p in captured)
    # role is forwarded via extra_headers
    body = next(v for p, v in captured.items() if "mcp-server-connections" in p)
    assert body["extra_headers"]["X-Iblai-Role"] == "Student"
