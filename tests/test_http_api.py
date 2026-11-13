"""A custom API (``backend/services/http_api.py``): any HTTP API, called by the MCP Toolbox.

No network and no Toolbox here: a host resolves to what ``resolves`` says, and the Toolbox
takes or refuses a file as the ``backend`` fixture's ``toolbox`` says.
"""

from __future__ import annotations

import shutil
from types import SimpleNamespace

import pytest
import yaml

from iblai_ontology.backend.services import http_api

BASE = "https://api.acme.example/v1"
TOKEN = "s3cret-token-0123456789"
KEY = f"Bearer {TOKEN}"
REFUSED = "the MCP Toolbox did not take it (its own log says why)"


@pytest.fixture()
def resolves(monkeypatch):
    """What each host resolves to, instead of asking DNS."""
    hosts = {
        "api.acme.example": ["93.184.216.34"],
        "erp.campus.example": ["10.20.3.7"],
        "localhost": ["127.0.0.1"],
        "metadata.example": ["169.254.169.254"],
    }

    def lookup(host, port, *args, **kwargs):
        if host not in hosts:
            raise OSError("Name or service not known")
        return [(2, 1, 6, "", (address, 0)) for address in hosts[host]]

    monkeypatch.setattr(http_api.socket, "getaddrinfo", lookup)
    return hosts


@pytest.fixture()
def backend(tmp_path, monkeypatch, resolves):
    for needed in ("django", "cryptography", "rest_framework"):
        pytest.importorskip(needed)
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
    monkeypatch.chdir(tmp_path)
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.conf import settings
    from django.core.management import call_command

    from iblai_ontology.backend.mcp_server import toolbox_client

    call_command("migrate", run_syncdb=True, verbosity=0)
    call_command("flush", interactive=False, verbosity=0)
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", True)
    # A Toolbox that takes every file, until a test says why it does not.
    toolbox = {"why": None, "marks": []}

    def loaded(url, mark, **kwargs):
        toolbox["marks"].append(mark)
        if isinstance(toolbox["why"], Exception):
            raise toolbox["why"]
        return toolbox["why"]

    monkeypatch.setenv("MCP_TOOLBOX_URL", "http://toolbox.test:5000")
    monkeypatch.setattr(toolbox_client, "loaded", loaded)
    return SimpleNamespace(
        tools=cfg / "tools.yaml",
        served=cfg / "generated" / "toolbox.yaml",
        toolbox=toolbox,
    )


def _console(view, method="post", data=None, **kwargs):
    """A request as the dev-anon admin through a console view's whole stack."""
    from rest_framework.test import APIRequestFactory

    factory = getattr(APIRequestFactory(), method)
    raw = factory("/x", data, format="json") if data is not None else factory("/x")
    raw.ontology = None
    resp = view.as_view()(raw, **kwargs)
    resp.render()
    return resp.data


def _connect(**changed):
    from iblai_ontology.backend.api.views import ServicesView

    body = {
        "name": "acme",
        "adapter": "http_api",
        "host": BASE,
        "api_key": KEY,
        "options": {"header": "Authorization"},
    }
    return _console(ServicesView, data={**body, **changed})


def _save(endpoint, system="acme", **fields):
    from iblai_ontology.backend.api.views import ServiceEndpointView

    body = {"description": "Open invoices of a client.", "method": "GET", **fields}
    return _console(ServiceEndpointView, "put", body, name=system, endpoint=endpoint)


def _docs(path):
    return [doc for doc in yaml.safe_load_all(path.read_text()) if doc]


def _doc(path, kind, name):
    return next(d for d in _docs(path) if d["kind"] == kind and d["name"] == name)


def _two_endpoints():
    assert _connect()["ok"]
    listed = _save(
        "list-invoices", path="/clients/{client_id}/invoices", query=["status", "limit"]
    )
    noted = _save(
        "add-note",
        method="POST",
        path="/invoices/{invoice_id}/notes",
        description="Add a note to an invoice.",
        body=True,
    )
    assert listed["ok"] and noted["ok"], (listed, noted)


def test_an_address_is_https_or_inside_a_private_network(resolves):
    # Kept ending in "/": the Toolbox resolves an endpoint's path against it.
    assert http_api.address(BASE) == (f"{BASE}/", False)
    assert http_api.address("https://api.acme.example/") == (
        "https://api.acme.example/",
        False,
    )
    inside = http_api.address("http://erp.campus.example:8080/api")
    assert inside == ("http://erp.campus.example:8080/api/", True)

    for refused, why in (
        ("http://api.acme.example", "starts with https://"),
        ("https://localhost/v1", "this machine or a link-local"),
        ("https://metadata.example", "this machine or a link-local"),
        ("https://nowhere.example", "does not resolve"),
        ("ftp://api.acme.example", "not an address"),
        ("api.acme.example/v1", "not an address"),
        ("https://user:pw@api.acme.example", "nothing else"),
        ("https://api.acme.example/v1?key=1", "nothing else"),
        # The Toolbox reads ${...} anywhere in its file as a setting of its own.
        ("https://api.acme.example/${HOME}", "nothing else"),
    ):
        with pytest.raises(http_api.ApiError, match=why):
            http_api.address(refused)
    # An Auto Ontology server's address goes through the same rules: neither names the Toolbox.
    for refused in ("https://localhost/v1", "http://api.acme.example"):
        with pytest.raises(http_api.ApiError) as said:
            http_api.address(refused)
        assert "Toolbox" not in str(said.value)


@pytest.mark.django
def test_connecting_makes_the_entry_two_sources_two_toolsets_and_the_role(backend):
    from iblai_ontology.backend.api.views import ServiceDetailView
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml
    from iblai_ontology.backend.services.models import Service

    connected = _connect()
    assert connected == {
        "ok": True,
        "message": "'acme' is connected. Add the endpoints agents may call.",
    }
    service = Service.objects.get(name="acme")
    assert (service.status, service.service_type, service.adapter) == (
        "active",
        "api",
        "http_api",
    )
    assert service.host == f"{BASE}/"

    # The key is in the registry alone, encrypted, and masked in what the console is told.
    shown = _console(ServiceDetailView, "get", name="acme")
    assert shown["connection_config"]["api_key"] == "********"
    assert shown["connection_config"]["header"] == "Authorization"
    assert TOKEN not in str(shown)
    assert TOKEN not in backend.tools.read_text()
    assert TOKEN not in backend.served.read_text()

    for source in ("acme-reads", "acme-writes"):
        assert _doc(backend.tools, "source", source) == {
            "kind": "source",
            "name": source,
            "type": "http",
            "baseUrl": f"{BASE}/",
            "timeout": "20s",
            "returnFullError": True,
        }
    assert _doc(backend.tools, "toolset", "acme-reads")["tools"] == []
    assert _doc(backend.tools, "toolset", "acme-writes") == {
        "kind": "toolset",
        "name": "acme-writes",
        "write": True,
        "tools": [],
    }
    assert validate_tools_yaml(backend.tools).ok
    # The role an agent is connected as holds both, from now on.
    assert role_source.load_roles()["acme"]["mcp_toolsets"] == [
        "acme-reads",
        "acme-writes",
    ]

    # A system inside a private network may reach one; no other is allowed to.
    assert _connect(name="erp", host="http://erp.campus.example:8080")["ok"]
    assert _doc(backend.tools, "source", "erp-reads")["allowedIpRanges"] == list(
        http_api.PRIVATE
    )
    # No key is asked of an API that takes none.
    assert _connect(name="open", api_key="", options={})["ok"]

    assert "already exists" in _connect()["message"]
    refused = _connect(name="far", host="http://api.acme.example")
    assert refused["ok"] is False and "starts with https://" in refused["message"]
    assert not Service.objects.filter(name="far").exists()


@pytest.mark.django
def test_a_name_whose_toolsets_exist_already_is_refused_and_leaves_nothing(backend):
    from iblai_ontology.backend.services.models import Service

    before = backend.tools.read_text()
    backend.tools.write_text(
        before + "\n---\nkind: toolset\nname: billing-reads\ntools: []\n"
    )
    refused = _connect(name="billing")
    assert refused["ok"] is False
    assert "already holds billing-reads" in refused["message"]
    assert not Service.objects.filter(name="billing").exists()


@pytest.mark.django
def test_an_endpoint_is_one_tool_on_the_source_and_in_the_toolset_of_its_kind(backend):
    from iblai_ontology.backend.api.views import ServiceEndpointsView
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.mcp_server.toolbox_compat import (
        validate_tools_yaml,
        writing_tools,
    )

    _two_endpoints()
    hidden = {
        "name": "Authorization",
        "type": "string",
        "description": "Added by the gateway: the system's key.",
    }
    assert _doc(backend.tools, "tool", "acme-list-invoices") == {
        "kind": "tool",
        "name": "acme-list-invoices",
        "type": "http",
        "source": "acme-reads",
        "service": "acme",
        "method": "GET",
        # Under the address, and the value escaped: "1/notes" stays one value.
        "path": "clients/{{pathEscape .client_id}}/invoices",
        "description": "Open invoices of a client.",
        "pathParams": [
            {"name": "client_id", "type": "string", "description": "client id"}
        ],
        "queryParams": [
            {
                "name": "status",
                "type": "string",
                "description": "status",
                "required": False,
            },
            {
                "name": "limit",
                "type": "string",
                "description": "limit",
                "required": False,
            },
        ],
        "headerParams": [hidden],
    }
    note = _doc(backend.tools, "tool", "acme-add-note")
    assert (note["source"], note["method"]) == ("acme-writes", "POST")
    assert note["path"] == "invoices/{{pathEscape .invoice_id}}/notes"
    assert note["headers"] == {"Content-Type": "application/json"}
    assert note["requestBody"] == "{{json .body}}"
    assert [p["type"] for p in note["bodyParams"]] == ["map"]
    assert _doc(backend.tools, "toolset", "acme-reads")["tools"] == [
        "acme-list-invoices"
    ]
    assert _doc(backend.tools, "toolset", "acme-writes")["tools"] == ["acme-add-note"]
    assert validate_tools_yaml(backend.tools).ok
    assert set(writing_tools(_docs(backend.tools))) >= {"acme-add-note"}
    assert "acme-list-invoices" not in writing_tools(_docs(backend.tools))
    assert TOKEN not in backend.tools.read_text()

    # What the Toolbox is handed: the tools without the gateway's word, on both sources.
    served = yaml.safe_load(backend.served.read_text())
    assert "service" not in served["tools"]["acme-list-invoices"]
    assert served["tools"]["acme-list-invoices"]["headerParams"] == [hidden]
    assert {"acme-reads", "acme-writes"} <= set(served["sources"])
    assert backend.toolbox["marks"][-1] in served["toolsets"]
    assert TOKEN not in backend.served.read_text()

    # Read back as they were entered.
    assert _console(ServiceEndpointsView, "get", name="acme") == [
        {
            "name": "list-invoices",
            "tool": "acme-list-invoices",
            "description": "Open invoices of a client.",
            "method": "GET",
            "path": "/clients/{client_id}/invoices",
            "query": ["status", "limit"],
            "body": False,
            "write": False,
        },
        {
            "name": "add-note",
            "tool": "acme-add-note",
            "description": "Add a note to an invoice.",
            "method": "POST",
            "path": "/invoices/{invoice_id}/notes",
            "query": [],
            "body": True,
            "write": True,
        },
    ]
    assert _console(ServiceEndpointsView, "get", name="nope") == []

    # An endpoint whose method changes moves to the other source and toolset, and no
    # role changes with it: not even one an admin took a toolset from.
    spec = role_source.load_roles()["acme"]
    role_source.put_role("acme", {**spec, "mcp_toolsets": ["acme-reads"]})
    moved = _save("list-invoices", method="DELETE", path="/invoices/{invoice_id}")
    assert moved["ok"] and "acme-writes" in moved["message"]
    assert _doc(backend.tools, "tool", "acme-list-invoices")["source"] == "acme-writes"
    assert _doc(backend.tools, "toolset", "acme-reads")["tools"] == []
    assert _doc(backend.tools, "toolset", "acme-writes")["tools"] == [
        "acme-add-note",
        "acme-list-invoices",
    ]
    assert role_source.load_roles()["acme"]["mcp_toolsets"] == ["acme-reads"]


@pytest.mark.django
@pytest.mark.parametrize(
    "endpoint, fields, why",
    [
        ("List Invoices", {"path": "/invoices"}, "lowercase letters"),
        ("x" * 70, {"path": "/invoices"}, "64 characters"),
        ("costs", {"path": "/costs", "description": "Costs ${amount}"}, "without"),
        ("list", {"path": "invoices"}, "starts with /"),
        ("list", {"path": "/"}, "starts with /"),
        ("list", {"path": "/a/../b"}, "starts with /"),
        ("list", {"path": "/a?x=1"}, "starts with /"),
        ("list", {"path": "/a/{{.x}}"}, "starts with /"),
        ("list", {"path": "/a/{id}", "query": ["id"]}, "repeats no name"),
        ("list", {"path": "/a", "query": ["Authorization"]}, "repeats no name"),
        ("list", {"path": "/a", "query": ["$top"]}, "repeats no name"),
        (
            "add",
            {"path": "/a", "method": "POST", "body": True, "query": ["body"]},
            "repeats no name",
        ),
        ("list", {"path": "/a", "method": "TRACE"}, "method is one of"),
    ],
)
def test_an_endpoint_that_would_stop_the_toolbox_is_refused_unwritten(
    backend, endpoint, fields, why
):
    assert _connect()["ok"]
    before = backend.tools.read_text()
    refused = _save(endpoint, **fields)
    assert refused["ok"] is False and why in refused["message"], refused
    assert backend.tools.read_text() == before


@pytest.mark.django
def test_an_endpoint_takes_no_other_tools_name(backend):
    assert _connect()["ok"]
    assert _connect(name="acme-list")["ok"]
    assert _save("list-invoices", path="/invoices")["ok"]
    # acme-list + invoices spells the tool acme + list-invoices already is.
    clash = _save("invoices", system="acme-list", path="/invoices")
    assert (
        clash["ok"] is False and "acme-list-invoices exists already" in clash["message"]
    )
    # The gateway's own tools answer first: an endpoint named like one would never be reached.
    assert _connect(name="read")["ok"]
    own = _save("memory", system="read", path="/memory")
    assert own["ok"] is False and "read-memory exists already" in own["message"]
    assert _save("anything", system="nope", path="/x") == {
        "ok": False,
        "message": "'nope' is not a custom API.",
    }


@pytest.mark.django
def test_a_save_the_toolbox_does_not_take_is_undone(backend, monkeypatch):
    from iblai_ontology.backend.mcp_server.toolbox_client import ToolboxError

    assert _connect()["ok"]
    assert _save("list-invoices", path="/invoices")["ok"]
    tools, served = backend.tools.read_text(), backend.served.read_text()

    backend.toolbox["why"] = REFUSED
    refused = _save("get-invoice", path="/invoices/{invoice_id}")
    assert refused == {"ok": False, "message": f"Not saved: {REFUSED}."}
    # Both files are as they were: what the Toolbox refused would stop it at its next start.
    assert backend.tools.read_text() == tools
    assert backend.served.read_text() == served

    # An endpoint needs the Toolbox: one that does not answer keeps nothing either.
    backend.toolbox["why"] = ToolboxError("the MCP Toolbox does not answer (refused)")
    silent = _save("get-invoice", path="/invoices/{invoice_id}")
    assert silent["ok"] is False and "does not answer" in silent["message"]
    assert backend.tools.read_text() == tools

    monkeypatch.delenv("MCP_TOOLBOX_URL")
    none = _save("get-invoice", path="/invoices/{invoice_id}")
    assert none["ok"] is False and "runs no MCP Toolbox" in none["message"]
    assert backend.tools.read_text() == tools


@pytest.mark.django
def test_the_gateway_adds_the_key_and_keeps_it_from_the_list_the_log_and_the_answer(
    backend, monkeypatch
):
    from iblai_ontology.backend.identity.roles import Permissions
    from iblai_ontology.backend.mcp_server.handlers import (
        MCPContext,
        MCPError,
        MCPHandlers,
    )

    _two_endpoints()
    recorded, sent = [], []

    def toolbox(self, name, arguments):
        sent.append((name, arguments))
        # An API that echoes what it was sent, whole and without its scheme word.
        return [{"sent": arguments.get("Authorization"), "token": TOKEN, "rows": 3}]

    monkeypatch.setattr(MCPHandlers, "_proxy_to_toolbox", toolbox)
    perms = Permissions(
        role="acme", display_name="acme", mcp_toolsets=["acme-reads", "acme-writes"]
    )
    handlers = MCPHandlers(
        MCPContext(
            permissions=perms,
            before_write=lambda name, arguments: recorded.append((name, arguments)),
        )
    )

    # An agent is shown what it gives, never the header the gateway fills.
    listed = {tool["name"]: tool for tool in handlers.list_tools()}
    assert [p["name"] for p in listed["acme-list-invoices"]["parameters"]] == [
        "client_id",
        "status",
        "limit",
    ]
    note = listed["acme-add-note"]
    assert note["inputSchema"]["properties"]["body"]["type"] == "object"
    assert "Authorization" not in note["inputSchema"]["properties"]
    assert note["annotations"] == {"readOnlyHint": False, "destructiveHint": True}

    # The system's key goes in, whatever the caller put there, and comes back masked.
    answer = handlers.call_tool(
        "acme-list-invoices", {"client_id": "7", "Authorization": "Bearer mine"}
    )
    assert sent[-1] == (
        "acme-list-invoices",
        {"client_id": "7", "Authorization": KEY},
    )
    assert answer == [{"sent": "********", "token": "********", "rows": 3}]

    # A change is recorded as the agent asked for it, before the key is added.
    handlers.call_tool("acme-add-note", {"invoice_id": "9", "body": {"text": "paid"}})
    assert recorded == [
        ("acme-add-note", {"invoice_id": "9", "body": {"text": "paid"}})
    ]
    assert sent[-1][1]["Authorization"] == KEY

    # A refusal that quotes the key is masked too.
    def refuses(self, name, arguments):
        raise MCPError(f"unexpected status code: 401, response body: bad {KEY}")

    monkeypatch.setattr(MCPHandlers, "_proxy_to_toolbox", refuses)
    with pytest.raises(MCPError) as failed:
        handlers.call_tool("acme-list-invoices", {"client_id": "7"})
    assert TOKEN not in str(failed.value) and "401" in str(failed.value)

    # A source moved by hand: the key is sent nowhere but where the registry says.
    monkeypatch.setattr(MCPHandlers, "_proxy_to_toolbox", toolbox)
    backend.tools.write_text(
        backend.tools.read_text().replace(f"{BASE}/", "https://elsewhere.example/")
    )
    calls = len(sent)
    moved = MCPHandlers(MCPContext(permissions=perms))
    with pytest.raises(MCPError, match="sent nowhere else"):
        moved.call_tool("acme-list-invoices", {"client_id": "7"})
    assert len(sent) == calls


def test_a_key_is_masked_whole_and_after_its_scheme_word_and_a_short_one_is_left():
    assert http_api.without(KEY, f"got {KEY}") == "got ********"
    assert http_api.without(KEY, {"a": [TOKEN, 1]}) == {"a": ["********", 1]}
    assert http_api.without("", {"a": 1}) == {"a": 1}
    # Too short to tell from ordinary text.
    assert http_api.without("abc", "abc def") == "abc def"


@pytest.mark.django
def test_a_schedule_the_status_probe_and_the_test_call_know_a_custom_api(backend):
    from iblai_ontology.backend.mcp_server.handlers import PermissionDenied
    from iblai_ontology.backend.mcp_server.tester import ToolTester
    from iblai_ontology.backend.services.health import check_connectivity
    from iblai_ontology.backend.sync.engine import SyncRunner

    _two_endpoints()
    # The sync would call it without the key: only the gateway adds one.
    assert "called when an agent asks" in SyncRunner.refuses("acme-list-invoices")
    assert "a schedule only reads" in SyncRunner.refuses("acme-add-note")
    with pytest.raises(RuntimeError, match="no check of its own"):
        check_connectivity("acme")
    with pytest.raises(PermissionDenied, match="not run as a test"):
        ToolTester().call("acme-add-note", {"invoice_id": "9", "body": {}})


@pytest.mark.django
def test_removing_an_endpoint_then_the_system_takes_everything_back(backend):
    from iblai_ontology.backend.api.views import ServiceDetailView, ServiceEndpointView
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.services.models import Service

    stock = backend.tools.read_text()
    _two_endpoints()
    role_source.extend_role("Auditor", {"mcp_toolsets": ["acme-reads"]}, "Auditor")

    gone = _console(ServiceEndpointView, "delete", name="acme", endpoint="add-note")
    assert gone == {"ok": True, "message": "acme-add-note is removed."}
    missing = _console(ServiceEndpointView, "delete", name="acme", endpoint="add-note")
    assert missing["ok"] is False and "no endpoint named add-note" in missing["message"]
    names = {doc["name"] for doc in _docs(backend.tools) if doc["kind"] == "tool"}
    assert "acme-add-note" not in names and "acme-list-invoices" in names
    # Its toolset stays, empty, and so does every role's hold on it.
    assert _doc(backend.tools, "toolset", "acme-writes")["tools"] == []
    assert "acme-writes" in role_source.load_roles()["acme"]["mcp_toolsets"]

    removed = _console(ServiceDetailView, "delete", name="acme")
    assert removed["ok"] is True
    assert not Service.objects.exists()
    left = _docs(backend.tools)
    assert not [doc for doc in left if doc.get("service") == "acme"]
    assert not [doc for doc in left if str(doc["name"]).startswith("acme-")]
    assert left == [doc for doc in yaml.safe_load_all(stock) if doc]
    # The role of its name reached nothing else and went; another only lost the toolset.
    roles = role_source.load_roles()
    assert "acme" not in roles
    assert "acme-reads" not in roles["Auditor"]["mcp_toolsets"]
    assert "acme-list-invoices" not in backend.served.read_text()
