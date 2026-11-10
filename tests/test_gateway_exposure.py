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
