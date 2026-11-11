"""The MCP gateway as a standard client sees it: the handshake, ``inputSchema``, the
platform service token, the public-URL probe, and the platform client's DM contract."""

from __future__ import annotations

import json
import shutil

import httpx
import pytest

django = pytest.importorskip("django")
pytest.importorskip("cryptography")

pytestmark = pytest.mark.django

TOKEN = "s" * 40


@pytest.fixture()
def backend(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    from tests.conftest import REPO_ROOT

    cfg = tmp_path / "config"
    cfg.mkdir()
    for name in ("roles.yaml", "tools.yaml"):
        shutil.copy(REPO_ROOT / "config" / name, cfg / name)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0)
    from iblai_ontology.backend.identity.models import AuditLog

    AuditLog.objects.all().delete()  # one SQLite per process
    return tmp_path


def _resolved(role="Executive"):
    from iblai_ontology.backend.identity.middleware import resolve_service_request

    return resolve_service_request(role)


def _post(body, resolved=None, **extra):
    from django.test import RequestFactory

    from iblai_ontology.backend.mcp_server.server import mcp_view

    req = RequestFactory().post(
        "/mcp", data=json.dumps(body), content_type="application/json", **extra
    )
    if resolved is not None:
        req.ontology = resolved
    return mcp_view(req)


def test_handshake_and_transport_rules(backend):
    from django.test import RequestFactory

    from iblai_ontology.backend.mcp_server.server import mcp_view

    resolved = _resolved()
    init = _post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}},
        },
        resolved,
    )
    result = json.loads(init.content)["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    assert result["serverInfo"]["name"] == "iblai-ontology"

    note = _post({"jsonrpc": "2.0", "method": "notifications/initialized"}, resolved)
    assert (note.status_code, note.content) == (202, b"")

    ping = _post({"jsonrpc": "2.0", "id": 2, "method": "ping"}, resolved)
    assert json.loads(ping.content)["result"] == {}

    batch = _post(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "ping"},
            {"jsonrpc": "2.0", "id": 2, "method": "nope"},
        ],
        resolved,
    )
    answers = json.loads(batch.content)
    assert [a["id"] for a in answers] == [1, 2]
    assert answers[1]["error"]["code"] == -32601

    get = RequestFactory().get("/mcp")
    get.ontology = resolved
    resp = mcp_view(get)
    assert (resp.status_code, resp["Allow"]) == (405, "POST")
    assert (
        mcp_view(
            RequestFactory().post("/mcp", data="{}", content_type="application/json")
        ).status_code
        == 401
    )


def test_tools_list_carries_input_schema_and_the_builtins(backend):
    listing = _post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, _resolved())
    tools = {t["name"]: t for t in json.loads(listing.content)["result"]["tools"]}
    assert {
        "query-ontology-cache",
        "read-memory",
        "get-sync-status",
        "search-students",
    } <= set(tools)
    assert all(t["inputSchema"]["type"] == "object" for t in tools.values())
    assert (
        tools["search-students"]["inputSchema"]["properties"]["search_term"]["type"]
        == "string"
    )
    assert tools["search-students"]["inputSchema"]["required"] == ["search_term"]
    assert tools["query-ontology-cache"]["inputSchema"]["required"] == ["sql"]
    assert (
        tools["query-ontology-cache"]["inputSchema"]["properties"]["limit"]["type"]
        == "integer"
    )

    # The default role has no toolset: only the memory reader shows.
    listing = _post(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, _resolved("default")
    )
    assert [t["name"] for t in json.loads(listing.content)["result"]["tools"]] == [
        "read-memory"
    ]


def test_tools_call_writes_an_audit_row(backend):
    from iblai_ontology.backend.identity.models import AuditLog

    ok = _post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get-sync-status", "arguments": {}},
        },
        _resolved(),
        HTTP_X_FORWARDED_FOR="203.0.113.9",
    )
    assert "result" in json.loads(ok.content)
    row = AuditLog.objects.get(action="mcp.tools/call", resource="get-sync-status")
    assert (row.user_id, row.user_role, row.allowed, row.ip_address) == (
        "platform-service",
        "Executive",
        True,
        "203.0.113.9",
    )

    denied = _post(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "read-memory",
                "arguments": {"path": "/ontology/students/S1.md"},
            },
        },
        _resolved("default"),
    )
    assert json.loads(denied.content)["error"]["code"] == -32003
    assert AuditLog.objects.get(resource="read-memory").allowed is False


WRITE_DOCS = (
    "---\nkind: source\nname: sis-rw\ntype: postgres\nhost: db\npassword: ${SIS_RW}\n"
    "---\nkind: tool\nname: release-hold\ntype: postgres-sql\nsource: sis-rw\n"
    "parameters:\n  - name: hold_id\n    type: integer\n"
    "statement: UPDATE holds SET released = true WHERE id = $1\n"
    "---\nkind: toolset\nname: registrar-writes\nwrite: true\ntools:\n  - release-hold\n"
)
RELEASE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {"name": "release-hold", "arguments": {"hold_id": 7}},
}


def _edit_roles(backend, change):
    import yaml

    path = backend / "config" / "roles.yaml"
    roles = yaml.safe_load(path.read_text())
    change(roles["roles"])
    path.write_text(yaml.safe_dump(roles))


def _with_writes(backend, monkeypatch):
    """A toolset that writes, a role that names it, and a Toolbox that notes what it is sent."""
    from iblai_ontology.backend.identity.models import AuditLog

    tools = backend / "config" / "tools.yaml"
    tools.write_text(tools.read_text() + WRITE_DOCS)
    registrar = {
        "display_name": "Registrar",
        "mcp_toolsets": ["*", "registrar-writes"],
    }
    _edit_roles(backend, lambda roles: roles.update(Registrar=registrar))
    sent = []

    def toolbox(url, name, arguments=None, **kwargs):
        recorded = AuditLog.objects.filter(action="mcp.tools/call.write").count()
        sent.append((name, arguments, recorded))
        return [{"released": 1}]

    monkeypatch.setattr(
        "iblai_ontology.backend.mcp_server.toolbox_client.call_tool", toolbox
    )
    return sent


def test_a_write_is_recorded_with_its_arguments_before_it_runs(backend, monkeypatch):
    from iblai_ontology.backend.identity.models import AuditLog

    sent = _with_writes(backend, monkeypatch)
    # `*` is every toolset that only reads: the stock Executive cannot make the change.
    denied = _post(RELEASE, _resolved("Executive"))
    assert json.loads(denied.content)["error"]["code"] == -32003
    assert sent == []
    assert not AuditLog.objects.filter(action="mcp.tools/call.write").exists()

    listing = _post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, _resolved())
    assert "release-hold" not in {
        t["name"] for t in json.loads(listing.content)["result"]["tools"]
    }
    listing = _post(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, _resolved("Registrar")
    )
    tools = {t["name"]: t for t in json.loads(listing.content)["result"]["tools"]}
    assert tools["release-hold"]["annotations"] == {
        "readOnlyHint": False,
        "destructiveHint": True,
    }
    assert tools["search-students"]["annotations"] == {"readOnlyHint": True}

    ok = _post(RELEASE, _resolved("Registrar"))
    assert "result" in json.loads(ok.content)
    # The Toolbox was called once, and the row was already there when it was.
    assert sent == [("release-hold", {"hold_id": 7}, 1)]
    before = AuditLog.objects.get(action="mcp.tools/call.write")
    assert (before.resource, before.user_role, before.allowed) == (
        "release-hold",
        "Registrar",
        True,
    )
    assert before.details == {"arguments": '{"hold_id": 7}'}
    after = AuditLog.objects.get(action="mcp.tools/call", user_role="Registrar")
    assert (after.allowed, after.details) == (True, {"isError": False})


def test_a_write_that_cannot_be_recorded_is_not_made(backend, monkeypatch):
    from iblai_ontology.backend import store

    sent = _with_writes(backend, monkeypatch)

    def down(model, **values):
        raise RuntimeError("the audit log is down")

    monkeypatch.setattr(store, "create", down)
    refused = _post(RELEASE, _resolved("Registrar"))
    error = json.loads(refused.content)["error"]
    assert "could not be recorded" in error["message"]
    assert sent == []


def test_the_row_after_a_call_says_whether_the_tool_failed(backend, monkeypatch):
    from iblai_ontology.backend.identity.models import AuditLog

    def failing(url, name, arguments=None, **kwargs):
        raise ValueError("relation students does not exist")

    monkeypatch.setattr(
        "iblai_ontology.backend.mcp_server.toolbox_client.call_tool", failing
    )
    answer = _post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "search-students", "arguments": {"search_term": "a"}},
        },
        _resolved(),
    )
    assert json.loads(answer.content)["result"]["isError"] is True
    row = AuditLog.objects.get(action="mcp.tools/call", resource="search-students")
    # Allowed is the gateway's answer to "may this role call it"; the outcome is beside it.
    assert (row.allowed, row.details) == (True, {"isError": True})


def test_a_cache_query_returns_at_most_the_roles_rows(backend):
    limit = {"max_records_per_query": 2, "max_export_rows": 500}
    _edit_roles(
        backend, lambda roles: roles["Executive"].update(concurrency_limits=limit)
    )

    def rows(role, **arguments):
        sql = "SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3"
        call = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "query-ontology-cache",
                "arguments": {"sql": sql, **arguments},
            },
        }
        answer = json.loads(_post(call, _resolved(role)).content)
        return json.loads(answer["result"]["content"][0]["text"])

    assert rows("Executive") == [{"n": 1}, {"n": 2}]
    assert rows("Executive", limit=50) == [{"n": 1}, {"n": 2}]
    assert rows("Executive", limit=1) == [{"n": 1}]
    # A role with no limit stored returns what the agent asks for.
    assert len(rows("DataAnalyst")) == 3

    # Only a whole number above zero is a limit.
    for unusable in (0, -5, "2", 2.5, True, None):
        stored = {"max_records_per_query": unusable}
        _edit_roles(
            backend,
            lambda roles, stored=stored: roles["Executive"].update(
                concurrency_limits=stored
            ),
        )
        assert len(rows("Executive")) == 3, unusable


# --- a person's own ibl.ai credential ------------------------------------------

ADMIN, MEMBER, OUTSIDER, KEY = "a" * 64, "m" * 64, "o" * 64, "k" * 64
VERIFY, PLATFORMS = "/api/core/token/verify/", "/api/core/users/platforms/"


def _platform(monkeypatch, roles_of=None):
    """The ibl.ai platform as the gateway asks it about a credential; returns what it was asked."""
    from django.conf import settings
    from django.core.cache import cache

    from iblai_ontology.backend.identity import role_source

    known = {
        ("Token", ADMIN): {"username": "ada", "is_admin": True},
        ("Token", MEMBER): {"username": "max"},
        ("Token", OUTSIDER): {"username": "eve", "key": "other-co"},
        ("Api-Token", KEY): {"username": "ada", "is_admin": True},
    }
    cache.clear()  # verdicts are kept per credential
    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_ADMIN_PLATFORMS", {"acme"})
    monkeypatch.setattr(settings, "SECURITY_REQUIRE_HTTPS", False)
    asked = []

    def get(url, params=None, headers=None, timeout=None):
        path = url.removeprefix("http://dm.test")
        asked.append((path, headers["Authorization"]))
        scheme, _, credential = headers["Authorization"].partition(" ")
        who = known.get((scheme, credential))
        if who is None:  # the DM answers every bad credential the same way
            return httpx.Response(403, json={"detail": "Invalid token."})
        name = who["username"]
        if path == VERIFY:
            user = {"user_id": 7, "username": name, "email": f"{name}@uni.edu"}
            return httpx.Response(200, json=user)
        link = {"username": name, "key": "acme", "active": True, "is_admin": False}
        return httpx.Response(200, json=[{**link, **who}])

    monkeypatch.setattr("iblai_ontology.backend.api.auth.httpx.get", get)
    held = roles_of or {}
    monkeypatch.setattr(role_source, "roles_of", lambda name: held.get(name, []))
    return asked


def _call(authorization, role=None, **extra):
    """tools/list with a credential of the caller's own: the status and the body."""
    headers = {"HTTP_AUTHORIZATION": authorization, **extra}
    if role:
        headers["HTTP_X_IBLAI_ROLE"] = role
    resp = _post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, **headers)
    return resp.status_code, json.loads(resp.content)


def _tools(authorization, role=None):
    status, body = _call(authorization, role)
    assert status == 200, body
    return {t["name"] for t in body["result"]["tools"]}


def test_a_persons_own_credential_runs_as_a_role_the_platform_gives_them(
    backend, monkeypatch
):
    asked = _platform(monkeypatch, roles_of={"max": ["DataAnalyst"]})

    # An admin of the platform names any defined role, and without a header is the default.
    assert "search-students" in _tools(f"Token {ADMIN}", "Executive")
    assert _tools(f"Token {ADMIN}") == {"read-memory"}
    # A member runs as the one role their policy gives them, named or not.
    assert "search-students" in _tools(f"Token {MEMBER}")
    assert "search-students" in _tools(f"Token {MEMBER}", "DataAnalyst")
    assert _tools(f"Token {MEMBER}", "default") == {"read-memory"}
    # A platform API key acts as its owner.
    assert "search-students" in _tools(f"Api-Token {KEY}", "Executive")

    # Behind Bearer the gateway finds out which of the two it was given.
    del asked[:]
    assert "search-students" in _tools(f"Bearer {MEMBER}")
    assert asked == []  # a token it already verified: asked nothing
    from django.core.cache import cache

    cache.clear()
    assert "search-students" in _tools(f"Bearer {KEY}", "Executive")
    assert asked == [
        (VERIFY, f"Token {KEY}"),
        (VERIFY, f"Api-Token {KEY}"),
        (PLATFORMS, f"Api-Token {KEY}"),
    ]


def test_the_audit_log_names_the_person_behind_a_credential(backend, monkeypatch):
    from iblai_ontology.backend.identity.models import AuditLog

    _platform(monkeypatch)
    call = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "get-sync-status", "arguments": {}},
    }
    answer = _post(
        call, HTTP_AUTHORIZATION=f"Api-Token {KEY}", HTTP_X_IBLAI_ROLE="Executive"
    )
    assert "result" in json.loads(answer.content)
    row = AuditLog.objects.get(resource="get-sync-status")
    # Prefixed: no member's name can pass for the service account's.
    assert (row.user_id, row.user_email, row.user_role) == (
        "ibl:ada",
        "ada@uni.edu",
        "Executive",
    )


def test_a_credential_the_gateway_does_not_take_is_refused_with_the_reason(
    backend, monkeypatch
):
    from django.conf import settings

    from iblai_ontology.backend.identity import middleware, role_source
    from iblai_ontology.backend.identity.roles import RolesUnavailable

    held = {"max": ["DataAnalyst", "IblaiOntologyAdmin"]}
    asked = _platform(monkeypatch, roles_of=held)

    # A credential the platform rejects: 401, and Bearer has tried it both ways.
    assert _call("Token nope")[0] == 401
    status, body = _call("Api-Token nope")
    assert status == 401 and "limited to its own policies" in body["error"]
    assert _call("Bearer nope")[0] == 401
    assert asked[-2:] == [(VERIFY, "Token nope"), (VERIFY, "Api-Token nope")]
    # A token under the other scheme is rejected: the scheme says what it is.
    assert _call(f"Api-Token {ADMIN}")[0] == 401
    # A JWT behind Bearer is Entra's, and no other scheme is anyone's.
    assert _call("Bearer a.b.c") == (401, {"error": "authentication required"})
    assert _call("Basic abc") == (401, {"error": "authentication required"})

    # A member of another platform.
    status, body = _call(f"Token {OUTSIDER}")
    assert status == 403 and "not a member of this platform" in body["error"]
    # A role the member does not hold, and one nobody defined.
    assert _call(f"Token {MEMBER}", "Executive")[0] == 403
    assert _call(f"Token {ADMIN}", "NoSuchRole")[0] == 403
    # Two roles and none named: the default one, never a pick.
    assert _tools(f"Token {MEMBER}") == {"read-memory"}
    assert "search-students" in _tools(f"Token {MEMBER}", "DataAnalyst")

    # The platform not saying which roles a member holds is a 503, never the default role.
    def silent(username):
        raise RolesUnavailable("down")

    monkeypatch.setattr(role_source, "roles_of", silent)
    assert _call(f"Token {MEMBER}") == (503, {"error": middleware.ROLES_UNAVAILABLE})
    assert (
        _call(f"Token {ADMIN}", "Executive")[0] == 200
    )  # an admin's roles are not asked

    # Over cleartext a credential is refused before it is looked at.
    monkeypatch.setattr(settings, "SECURITY_REQUIRE_HTTPS", True)
    status, body = _call(f"Token {ADMIN}", "Executive")
    assert status == 403 and "cleartext" in body["error"]
    assert _call(f"Token {ADMIN}", "Executive", secure=True)[0] == 200

    # A backend that does not know its platform takes no personal credential at all.
    monkeypatch.setattr(settings, "ONTOLOGY_ADMIN_PLATFORMS", set())
    status, body = _call(f"Token {ADMIN}", "Executive", secure=True)
    assert status == 401 and "IBLAI_ORG" in body["error"]


def test_a_platform_that_does_not_answer_is_a_503_not_a_bad_credential(
    backend, monkeypatch
):
    _platform(monkeypatch)

    def down(url, params=None, headers=None, timeout=None):
        raise httpx.ConnectError("no route to the platform")

    monkeypatch.setattr("iblai_ontology.backend.api.auth.httpx.get", down)
    status, body = _call(f"Bearer {'z' * 64}")
    assert status == 503 and "unavailable" in body["error"]


def test_service_token_resolves_the_role_from_the_header(backend, monkeypatch):
    from django.conf import settings
    from django.test import RequestFactory

    from iblai_ontology.backend.identity.middleware import OntologyIdentityMiddleware

    monkeypatch.setattr(settings, "SERVICE_TOKEN", TOKEN)
    mw = OntologyIdentityMiddleware(get_response=lambda req: req)
    assert mw.validator is None  # no Entra configured in tests

    req = mw(
        RequestFactory().post(
            "/mcp", HTTP_AUTHORIZATION=f"Bearer {TOKEN}", HTTP_X_IBLAI_ROLE="Executive"
        )
    )
    assert req.ontology.permissions.role == "Executive"
    assert req.ontology.identity.user_id == "platform-service"
    assert req.ontology.emplid is None

    req = mw(RequestFactory().post("/mcp", HTTP_AUTHORIZATION=f"Bearer {TOKEN}"))
    assert req.ontology.permissions.role == "default"

    forbidden = mw(
        RequestFactory().post(
            "/mcp", HTTP_AUTHORIZATION=f"Bearer {TOKEN}", HTTP_X_IBLAI_ROLE="Nope"
        )
    )
    assert forbidden.status_code == 403

    other = mw(RequestFactory().post("/mcp", HTTP_AUTHORIZATION="Bearer " + "x" * 40))
    assert (
        other.ontology is None
    )  # not the token: the Entra path, which has no validator here


def test_short_service_token_is_refused(backend, monkeypatch):
    from django.conf import settings
    from django.core.exceptions import ImproperlyConfigured

    from iblai_ontology.backend.identity.middleware import OntologyIdentityMiddleware

    monkeypatch.setattr(settings, "SERVICE_TOKEN", "short")
    with pytest.raises(ImproperlyConfigured):
        OntologyIdentityMiddleware(get_response=lambda req: req)


def test_check_mcp_gateway_probes_the_public_url(backend, monkeypatch):
    from iblai_ontology.backend.health.checks import check_mcp_gateway

    seen = {}

    def fake_post(url, *, json, timeout):
        seen["url"], seen["json"] = url, json
        return httpx.Response(401, json={"error": "authentication required"})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("ONTOLOGY_GATEWAY_URL", "https://demo.ngrok-free.app/mcp")
    health = check_mcp_gateway()
    assert (health.running, health.url) == (True, "https://demo.ngrok-free.app/mcp")
    assert seen["json"]["method"] == "ping"

    def down(url, *, json, timeout):
        raise httpx.ConnectError("tunnel down")

    monkeypatch.setattr(httpx, "post", down)
    assert check_mcp_gateway().running is False

    monkeypatch.delenv("ONTOLOGY_GATEWAY_URL")
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: pytest.fail("no probe without a URL")
    )
    local = check_mcp_gateway()
    assert (local.running, local.url) == (False, "")


def test_platform_client_speaks_the_dm_contract():
    from iblai_ontology.backend.platform.client import PlatformClient, PlatformConfig

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(
                200, json={"tool_slugs": ["web-search"], "mcp_servers": [{"id": 3}]}
            )
        return httpx.Response(201, json={"id": 14})

    client = PlatformClient(
        PlatformConfig(
            base_url="https://dm.example",
            org="demo",
            admin_token="k",
            auth_scheme="Api-Token",
        ),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    client.register_mcp_server(
        name="iblai-ontology",
        url="https://demo.ngrok-free.app/mcp",
        auth_type="none",
        credentials="Bearer tok",
        extra_headers={"X-Iblai-Role": "Executive"},
    )
    client.create_connection(
        server=14,
        scope="mentor",
        mentor="m-1",
        role="DataAnalyst",
        auth_type="token",
        credentials="tok",
    )
    client.attach_to_agent(agent_id="m-1", server_id=14)

    register, connect, settings_get, settings_put = calls
    assert register.url.path == "/api/ai-agent/orgs/demo/users/admin/mcp-servers/"
    assert register.headers["Authorization"] == "Api-Token k"
    body = json.loads(register.content)
    assert (body["auth_type"], body["auth_scope"], body["transport"]) == (
        "none",
        "platform",
        "streamable_http",
    )
    assert body["credentials"] == "Bearer tok" and body["extra_headers"] == {
        "X-Iblai-Role": "Executive"
    }

    body = json.loads(connect.content)
    assert body["mentor"] == "m-1" and "agent" not in body
    assert (body["credentials"], body["authorization_scheme"]) == ("tok", "Bearer")
    assert body["extra_headers"] == {"X-Iblai-Role": "DataAnalyst"}

    assert settings_get.method == "GET"
    assert settings_put.method == "PUT"
    assert (
        settings_put.url.path
        == "/api/ai-agent/orgs/demo/users/admin/mentors/m-1/settings/"
    )
    assert json.loads(settings_put.content) == {
        "tool_slugs": ["mcp", "web-search"],
        "can_use_tools": True,
        "mcp_servers": [3, 14],
    }
