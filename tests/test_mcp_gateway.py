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


def _read(name, description):
    """A tool the gateway knows to read: one fixed SELECT."""
    return {
        "kind": "tool",
        "name": name,
        "type": "postgres-sql",
        "source": "cache",
        "description": description,
        "parameters": [],
        "statement": "SELECT 1",
    }


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
            _read("get-student-enrollment", "enroll"),
            _read("search-students", "search"),
            _read("get-aid-package", "aid"),
        ]


class WritingReader(FakeReader):
    """The same, plus a write account: a toolset marked as writing, and one that forgot to be."""

    def get_toolsets(self):
        return {
            **super().get_toolsets(),
            "registrar-writes": {"write": True, "tools": ["release-hold", "add-note"]},
            "unmarked": {"tools": ["release-hold", "search-students"]},
        }

    def get_tools(self):
        return [
            *super().get_tools(),
            {
                "kind": "tool",
                "name": "release-hold",
                "type": "postgres-sql",
                "source": "sis-rw",
                "parameters": [{"name": "hold_id", "type": "integer"}],
                "statement": "UPDATE holds SET released = true WHERE id = $1",
            },
            {
                "kind": "tool",
                "name": "add-note",
                "type": "http",
                "source": "crm-rw",
                "method": "POST",
                "path": "/notes/{{.person}}",
                "pathParams": [{"name": "person", "type": "string"}],
                "bodyParams": [{"name": "body", "type": "string"}],
            },
        ]


def _resolver():
    return ToolsetResolver(reader=FakeReader())


def _writing_handlers(toolsets, **ctx):
    perms = Permissions(role="Registrar", display_name="x", mcp_toolsets=toolsets)
    handlers = MCPHandlers(
        MCPContext(permissions=perms, **ctx),
        resolver=ToolsetResolver(reader=WritingReader()),
    )
    sent = []
    handlers._proxy_to_toolbox = lambda name, arguments: sent.append(name) or [{}]
    return handlers, sent


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


def test_wildcard_never_reaches_a_toolset_that_writes():
    resolver = ToolsetResolver(reader=WritingReader())
    perms = Permissions(role="Executive", display_name="x", mcp_toolsets=["*"])
    scoped = resolver.scope_for(perms)
    assert "registrar-writes" not in scoped.toolsets
    assert not {"release-hold", "add-note"} & set(scoped.tool_names)
    assert {"search-students", "get-aid-package"} <= set(scoped.tool_names)

    # Named, alone or beside the wildcard, it is held; the wildcard still adds the rest.
    perms = Permissions(
        role="Registrar", display_name="x", mcp_toolsets=["*", "registrar-writes"]
    )
    scoped = resolver.scope_for(perms)
    assert {"release-hold", "add-note", "get-aid-package"} <= set(scoped.tool_names)
    perms = Permissions(
        role="Registrar", display_name="x", mcp_toolsets=["registrar-writes"]
    )
    assert resolver.scope_for(perms).tool_names == ["release-hold", "add-note"]


def test_a_toolset_not_marked_as_writing_never_lends_a_tool_that_writes():
    # A hand-edited or merged tools.yaml skips the validator: the gateway is the guard.
    resolver = ToolsetResolver(reader=WritingReader())
    perms = Permissions(role="x", display_name="x", mcp_toolsets=["unmarked"])
    assert resolver.scope_for(perms).tool_names == ["search-students"]
    assert set(resolver.writing) == {"release-hold", "add-note"}


def test_a_write_runs_only_after_it_is_recorded():
    recorded = []
    handlers, sent = _writing_handlers(
        ["registrar-writes"],
        before_write=lambda name, arguments: recorded.append((name, arguments)),
    )
    handlers.call_tool("release-hold", {"hold_id": 7})
    assert recorded == [("release-hold", {"hold_id": 7})] and sent == ["release-hold"]

    # A recorder that fails stops the write.
    def refuse(name, arguments):
        raise PermissionDenied("not recorded")

    handlers, sent = _writing_handlers(["registrar-writes"], before_write=refuse)
    with pytest.raises(PermissionDenied):
        handlers.call_tool("release-hold", {"hold_id": 7})
    assert sent == []

    # No recorder at all (a context that is not the gateway's): no write.
    handlers, sent = _writing_handlers(["registrar-writes"])
    with pytest.raises(PermissionDenied, match="records the call first"):
        handlers.call_tool("release-hold", {"hold_id": 7})
    assert sent == []

    # A tool that reads asks for no record.
    handlers, sent = _writing_handlers(["enrollment-tools"])
    handlers.call_tool("search-students", {})
    assert sent == ["search-students"]


def test_list_tools_says_which_tools_write_and_what_an_http_tool_takes():
    handlers, _ = _writing_handlers(["*", "registrar-writes"])
    tools = {t["name"]: t for t in handlers.list_tools()}
    assert tools["search-students"]["annotations"] == {"readOnlyHint": True}
    assert tools["read-memory"]["annotations"] == {"readOnlyHint": True}
    assert tools["release-hold"]["annotations"] == {
        "readOnlyHint": False,
        "destructiveHint": True,
    }
    # An http tool declares its arguments in four lists of its own.
    assert tools["add-note"]["inputSchema"] == {
        "type": "object",
        "properties": {
            "person": {"type": "string", "description": ""},
            "body": {"type": "string", "description": ""},
        },
        "required": ["person", "body"],
    }
    assert [p["name"] for p in tools["add-note"]["parameters"]] == ["person", "body"]


def test_list_tools_handler():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    tools = handlers.list_tools()
    names = {t["name"] for t in tools}
    # The role's toolset, plus the gateway's own memory reader (no cache or admin scope here).
    assert names == {"get-student-enrollment", "search-students", "read-memory"}
    assert all(t["inputSchema"]["type"] == "object" for t in tools)


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


def test_read_memory_resolves_dot_dot_before_the_role_check(tmp_path):
    root = tmp_path / "ontology"
    (root / "students" / "by-id").mkdir(parents=True)
    (root / "courses" / "by-dept").mkdir(parents=True)
    (root / "students" / "by-id" / "1.md").write_text("# Student 1")
    (root / "courses" / "by-dept" / "cs.md").write_text("# CS")
    perms = Permissions(
        role="default", display_name="x", memory_paths=["/ontology/courses/by-dept/**"]
    )
    handlers = MCPHandlers(
        MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
    )
    # Inside the granted folder, however the path is spelled.
    assert handlers.read_memory("/ontology/courses/by-dept/x/../cs.md") == "# CS"
    # Climbing out of it would read another domain's record.
    with pytest.raises(PermissionDenied):
        handlers.read_memory("/ontology/courses/by-dept/../../students/by-id/1.md")


def test_read_memory_lists_a_folder_as_far_as_the_role_reaches(tmp_path):
    root = tmp_path / "ontology"
    for folder, name in (("persons", "1.md"), ("persons", "2.md"), ("deals", "9.md")):
        (root / folder).mkdir(parents=True, exist_ok=True)
        (root / folder / name).write_text("#")

    def as_role(*paths):
        perms = Permissions(role="crm", display_name="x", memory_paths=list(paths))
        return MCPHandlers(
            MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
        )

    handlers = as_role("/ontology/persons/**")
    # The top shows the folder the role reads, and not the one beside it.
    assert handlers.read_memory("/ontology") == "/ontology/persons/"
    assert handlers.read_memory("/ontology/persons/").split("\n") == [
        "/ontology/persons/1.md",
        "/ontology/persons/2.md",
    ]
    # A folder that shows the role nothing is refused as a file is: no telling it is there.
    with pytest.raises(PermissionDenied, match="cannot read /ontology/deals"):
        handlers.read_memory("/ontology/deals")
    with pytest.raises(PermissionDenied, match="cannot read /ontology/nowhere"):
        handlers.read_memory("/ontology/nowhere")
    # One granted file is enough to show the way to it, and nothing else in its folder.
    (root / "deals" / "8.md").write_text("#")
    one = as_role("/ontology/deals/9.md")
    assert one.read_memory("/ontology") == "/ontology/deals/"
    assert one.read_memory("/ontology/deals") == "/ontology/deals/9.md"
    # A long folder is cut, and says by how much.
    for n in range(3, 204):
        (root / "persons" / f"{n}.md").write_text("#")
    listed = handlers.read_memory("/ontology/persons").split("\n")
    assert len(listed) == 201 and listed[-1].startswith("... and 3 more")


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


def test_read_memory_blocks_symlink_escape(tmp_path):
    # A symlink inside the root pointing outside it must not escape the root.
    root = tmp_path / "ontology"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("SECRET: outside the root")
    (root / "link").symlink_to(outside, target_is_directory=True)
    perms = Permissions(
        role="Executive", display_name="x", memory_paths=["/ontology/**"]
    )
    handlers = MCPHandlers(
        MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
    )
    with pytest.raises(PermissionDenied):
        handlers._physical_path("/ontology/link/secret.txt")
    with pytest.raises(PermissionDenied):
        handlers.read_memory("/ontology/link/secret.txt")


def test_read_memory_allows_symlink_within_root(tmp_path):
    # A symlink that stays inside the root is fine (resolved path still contained).
    root = tmp_path / "ontology"
    (root / "real").mkdir(parents=True)
    (root / "real" / "f.md").write_text("OK inside root")
    (root / "link").symlink_to(root / "real", target_is_directory=True)
    perms = Permissions(
        role="Executive", display_name="x", memory_paths=["/ontology/**"]
    )
    handlers = MCPHandlers(
        MCPContext(permissions=perms, files_root=str(root)), resolver=_resolver()
    )
    assert handlers.read_memory("/ontology/link/f.md") == "OK inside root"


def test_dispatch_tools_list():
    perms = Permissions(
        role="AcademicAdvisor", display_name="x", mcp_toolsets=["enrollment-tools"]
    )
    handlers = MCPHandlers(MCPContext(permissions=perms), resolver=_resolver())
    resp = dispatch(handlers, {"jsonrpc": "2.0", "method": "tools/list", "id": 1})
    assert resp["id"] == 1
    assert {t["name"] for t in resp["result"]["tools"]} == {
        "get-student-enrollment",
        "search-students",
        "read-memory",
    }


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

    from iblai_ontology.backend.platform.client import (
        PlatformClient,
        PlatformConfig,
    )

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
