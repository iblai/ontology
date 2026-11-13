"""An NVIDIA Auto Ontology server (``backend/services/auto_ontology.py``): its terms, read and kept.

No network here: a host resolves to what ``resolves`` says, and the server is ``nvidia``, an
``httpx.MockTransport`` that answers from ``LAYER`` and records what it was asked.
"""

from __future__ import annotations

import copy
import json
import shutil
import threading
from types import SimpleNamespace

import httpx
import pytest

from iblai_ontology.backend.services import auto_ontology, http_api

BASE = "https://auto-ontology.acme.example"
TOKEN = "auto_ontology_0123456789abcdef"
WORDS = "words of the server that are nobody's to read"
STUDENT = "0a1b2c3d-0000-4000-8000-000000000001"
ENROLLMENT = "0a1b2c3d-0000-4000-8000-000000000002"
BIO = ["campus", "SYSADM", "PS_STDNT_BIO"]
ENRL = ["campus", "SYSADM", "PS_STDNT_ENRL"]


def _table(id, where, *how):
    database, schema, name = where
    return {
        "id": id,
        "name": name,
        "table_type": "BASE TABLE",
        "database_id": "d1",
        "database_name": database,
        "schema_id": "s1",
        "schema_name": schema,
        "relationship_types": list(how),
    }


def _column(id, name, table_id, table):
    return {"id": id, "column_name": name, "table_id": table_id, "table_name": table}


LAYER = {
    ENROLLMENT: {
        "name": "Enrollment",
        "description": "A student's place in a class.",
        "synonyms": ["registration"],
        "certification": "pending",
        "tables": [_table("t-enrl", ENRL, "REPRESENTS", "HAS_ATTRIBUTE")],
        "attributes": [],
        "calculations": [],
    },
    STUDENT: {
        "name": "Student",
        "description": "A person\nenrolled at the institution.",
        "synonyms": ["learner", "pupil"],
        "certification": "certified",
        "tables": [
            _table("t-bio", BIO, "HAS_ATTRIBUTE", "REPRESENTS"),
            # Only points at the term: the join NVIDIA inferred.
            _table("t-enrl", ENRL, "SEMANTIC_FK"),
            _table("t-far", ["warehouse", "dbo", "DIM_STUDENT"], "REPRESENTS"),
        ],
        "attributes": [
            {
                "id": "a1",
                "name": "Student ID",
                "description": "The id of a student.",
                "certified": True,
                "sample_values": ["S0008", "S0009"],
                "primary_column": _column("c1", "EMPLID", "t-bio", "PS_STDNT_BIO"),
                "referenced_columns": [
                    _column("c2", "EMPLID", "t-enrl", "PS_STDNT_ENRL")
                ],
            }
        ],
        "calculations": [
            {
                "id": "q1",
                "name": "Active students",
                "description": "Students with an open career.",
                "expression": "COUNT(*) FILTER (WHERE status = 'A')",
                "certified": False,
            }
        ],
    },
}


@pytest.fixture()
def resolves(monkeypatch):
    """What each host resolves to, instead of asking DNS."""
    hosts = {
        "auto-ontology.acme.example": ["93.184.216.34"],
        "ao.campus.example": ["10.20.3.9"],
        "localhost": ["127.0.0.1"],
    }

    def lookup(host, port, *args, **kwargs):
        if host not in hosts:
            raise OSError("Name or service not known")
        return [(2, 1, 6, "", (address, 0)) for address in hosts[host]]

    monkeypatch.setattr(http_api.socket, "getaddrinfo", lookup)
    return hosts


@pytest.fixture()
def nvidia(monkeypatch, resolves):
    """An Auto Ontology server answering from ``layer``; ``calls`` is every path it was asked."""
    state = SimpleNamespace(
        calls=[], keys=set(), layer=copy.deepcopy(LAYER), fail={}, total=None, wait=None
    )

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        state.calls.append(path)
        state.keys.add(request.headers.get("x-api-key"))
        if request.headers.get("x-api-key") not in (TOKEN, None):
            return httpx.Response(401, text=WORDS)
        for part, status in state.fail.items():
            if part in path:
                return httpx.Response(status, text=WORDS)
        if state.wait is not None and "/exploration/" in path:
            state.wait.wait(5)
        if path == "/api/terms":
            listed = ("name", "description", "synonyms", "certification")
            rows = [
                {"id": id, **{k: t[k] for k in listed}} for id, t in state.layer.items()
            ]
            limit = request.url.params.get("limit")
            return httpx.Response(
                200,
                json={
                    "data": rows[: int(limit)] if limit else rows,
                    "total": state.total or len(rows),
                },
            )
        term = state.layer.get(path.split("/")[-2])
        if term is None:
            return httpx.Response(404, text=WORDS)
        if path.endswith("/details"):
            return httpx.Response(200, json={"data": {"tables": term["tables"]}})
        if path.endswith("/column-attributes"):
            return httpx.Response(200, json={"data": term["attributes"]})
        if path.endswith("/sql-attributes"):
            return httpx.Response(200, json={"data": term["calculations"]})
        return httpx.Response(404, text=WORDS)

    def client(base: str, token: str) -> httpx.Client:
        return httpx.Client(
            base_url=base,
            headers={"x-api-key": token} if token else {},
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
        )

    monkeypatch.setattr(auto_ontology, "_client", client)
    return state


@pytest.fixture()
def backend(tmp_path, monkeypatch, nvidia):
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

    call_command("migrate", run_syncdb=True, verbosity=0)
    call_command("flush", interactive=False, verbosity=0)
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", True)
    return nvidia


def _console(view, method="post", data=None, query="", **kwargs):
    """A request as the dev-anon admin through a console view's whole stack."""
    from rest_framework.test import APIRequestFactory

    factory = getattr(APIRequestFactory(), method)
    path = f"/x{query}"
    raw = factory(path, data, format="json") if data is not None else factory(path)
    raw.ontology = None
    resp = view.as_view()(raw, **kwargs)
    resp.render()
    return resp.data


def _connect(**changed):
    from iblai_ontology.backend.api.views import ServicesView

    body = {"name": "terms", "adapter": "auto_ontology", "host": BASE, "api_key": TOKEN}
    return _console(ServicesView, data={**body, **changed})


def _system(name="terms"):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    return store.first(Service, name=name)


def _kept(name="terms"):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    return [row.payload for row in store.filter(ServiceTable, service=_system(name).pk)]


def _campus():
    """A database system here that holds the database NVIDIA calls ``campus``."""
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.backend.services.registry import save_manifest

    system = store.create(
        Service,
        name="campus-pg",
        display_name="Campus",
        service_type="database",
        adapter="postgresql",
        status="active",
    )
    tables = [
        {"schema_name": "SYSADM", "table_name": name, "row_count": 1, "columns": []}
        for name in ("PS_STDNT_BIO", "PS_STDNT_ENRL")
    ]
    save_manifest(
        system, {"db_type": "postgresql", "database": "Campus", "tables": tables}
    )


@pytest.mark.django
def test_connecting_makes_the_entry_and_reads_its_terms(backend):
    from iblai_ontology.backend.api.views import ServiceDetailView, ServicesView

    said = _connect()
    assert said == {"ok": True, "message": "'terms' is connected: 2 terms read."}
    system = _system()
    assert (system.adapter, system.service_type, system.status) == (
        "auto_ontology",
        "api",
        "active",
    )
    assert system.host == f"{BASE}/" and system.last_discovery_at is not None

    shown = _console(ServiceDetailView, "get", name="terms")
    assert shown["schema_manifest"] == {
        "db_type": "",
        "database": "",
        "total_tables": 0,
        "total_rows": 0,
        "tables": [],
        "terms": 2,
        "of": 2,
        # A term is counted under each database one of its tables is held in.
        "databases": [
            {"name": "campus", "terms": 2},
            {"name": "warehouse", "terms": 1},
        ],
    }
    # The token is in the registry, encrypted, and masked wherever the system is shown.
    listed = json.dumps(_console(ServicesView, "get"))
    assert TOKEN not in listed and TOKEN.encode() not in bytes(
        system.connection_config_encrypted
    )
    assert _connect()["message"] == "Service 'terms' already exists."


@pytest.mark.django
def test_a_reading_keeps_meaning_tables_and_joins_and_no_sample_value(backend):
    assert _connect()["ok"]
    enrollment, student = _kept()
    assert student == {
        "id": STUDENT,
        "name": "Student",
        "description": "A person enrolled at the institution.",
        "synonyms": ["learner", "pupil"],
        "certification": "certified",
        "tables": [
            {
                "database": "campus",
                "schema": "SYSADM",
                "table": "PS_STDNT_BIO",
                "holds": True,
            },
            {
                "database": "campus",
                "schema": "SYSADM",
                "table": "PS_STDNT_ENRL",
                "holds": False,
            },
            {
                "database": "warehouse",
                "schema": "dbo",
                "table": "DIM_STUDENT",
                "holds": True,
            },
        ],
        # From the table whose column points at the term, to the table that column is in.
        "joins": [[ENRL, BIO]],
    }
    assert enrollment["name"] == "Enrollment" and enrollment["joins"] == []
    assert "S0008" not in json.dumps(_kept())
    # Only a term another table points at can carry a join: the other's columns are not asked.
    assert f"/api/terms/{STUDENT}/column-attributes" in backend.calls
    assert f"/api/terms/{ENROLLMENT}/column-attributes" not in backend.calls
    assert backend.keys == {TOKEN}


@pytest.mark.django
def test_a_server_reached_directly_takes_no_token(backend, resolves):
    said = _connect(host="http://ao.campus.example:3001", api_key="")
    assert said["ok"] and backend.keys == {None}
    assert _system().host == "http://ao.campus.example:3001/"


@pytest.mark.django
@pytest.mark.parametrize(
    ("changed", "why"),
    [
        ({"api_key": "another-token"}, "refused the token (401)"),
        ({"host": "https://localhost"}, "this machine or a link-local"),
        ({"host": "http://auto-ontology.acme.example"}, "starts with https://"),
        ({"host": "https://nowhere.example"}, "does not resolve"),
    ],
)
def test_what_is_not_such_a_server_is_not_connected(backend, changed, why):
    said = _connect(**changed)
    assert not said["ok"] and why in said["message"]
    assert _system() is None


@pytest.mark.django
def test_an_error_names_a_status_and_never_the_answer(backend):
    backend.fail = {"/api/terms": 404}
    said = _connect()
    assert not said["ok"] and "answered 404 for api/terms" in said["message"]
    assert WORDS not in said["message"] and _system() is None

    backend.fail = {}
    backend.layer = {}
    assert _connect()["message"] == (
        "'terms' is connected: 0 terms read. Its semantic layer may not be built yet."
    )


@pytest.mark.django
def test_a_first_reading_that_fails_leaves_the_system_connected(backend):
    from iblai_ontology.backend.api.views import ServiceDiscoverView

    backend.fail = {"/details": 500}
    said = _connect()
    assert said["ok"] and "but its terms were not read" in said["message"]
    assert "answered 500" in said["message"] and WORDS not in said["message"]
    assert _system() is not None and _kept() == []

    backend.fail = {}
    again = _console(ServiceDiscoverView, name="terms")
    assert again == {"ok": True, "message": "2 terms read."} and len(_kept()) == 2


@pytest.mark.django
def test_a_reading_that_fails_keeps_the_one_before(backend):
    from iblai_ontology.backend.api.views import ServiceDiscoverView

    assert _connect()["ok"]
    before, read_at = _kept(), _system().last_discovery_at
    backend.fail = {"/column-attributes": 503}
    said = _console(ServiceDiscoverView, name="terms")
    assert not said["ok"] and "answered 503" in said["message"]
    assert "What was read before is kept." in said["message"]
    assert _kept() == before and _system().last_discovery_at == read_at


@pytest.mark.django
def test_a_reading_is_cut_at_the_cap_and_says_so(backend, monkeypatch):
    monkeypatch.setattr(auto_ontology, "TERM_CAP", 1)
    backend.total = 2
    said = _connect()
    assert said["message"] == (
        "'terms' is connected: 1 term read. It holds 2: only the first 1 by name are read."
    )
    assert [term["name"] for term in _kept()] == ["Enrollment"]


@pytest.mark.django
def test_a_reading_that_runs_out_of_time_writes_nothing(backend, monkeypatch):
    from iblai_ontology.backend.api.views import ServiceDiscoverView

    assert _connect()["ok"]
    before = _kept()
    monkeypatch.setattr(auto_ontology, "DEADLINE", 0.05)
    backend.wait = threading.Event()
    try:
        said = _console(ServiceDiscoverView, name="terms")
    finally:
        backend.wait.set()  # lets the calls still out come back
    assert not said["ok"] and "took longer than" in said["message"]
    assert "nothing was changed" in said["message"] and _kept() == before


@pytest.mark.django
def test_an_id_that_is_not_an_id_is_left_out(backend):
    backend.layer["../connections"] = {**LAYER[ENROLLMENT], "name": "Trap"}
    said = _connect()
    assert said["message"] == (
        "'terms' is connected: 2 terms read. "
        "1 carried an id this server cannot use and was left out."
    )
    assert not any("connections" in path for path in backend.calls)


@pytest.mark.django
def test_a_term_is_read_live_for_its_columns_and_calculations(backend):
    from iblai_ontology.backend.api.views import ServiceTermView

    assert _connect()["ok"]
    found = _console(ServiceTermView, "get", name="terms", term=STUDENT)
    assert found == {
        "ok": True,
        "message": "",
        "columns": [
            {
                "name": "Student ID",
                "description": "The id of a student.",
                "certified": True,
                "table": "PS_STDNT_BIO",
                "column": "EMPLID",
            }
        ],
        "calculations": [
            {
                "name": "Active students",
                "description": "Students with an open career.",
                "expression": "COUNT(*) FILTER (WHERE status = 'A')",
                "certified": False,
            }
        ],
    }
    assert "S0008" not in json.dumps(found)

    asked = len(backend.calls)
    trap = _console(ServiceTermView, "get", name="terms", term="..%2Fconnections")
    assert trap == {
        "ok": False,
        "message": "That is not a term's id.",
        "columns": [],
        "calculations": [],
    }
    assert len(backend.calls) == asked  # refused before anything is asked of the server
    backend.fail = {"/sql-attributes": 502}
    down = _console(ServiceTermView, "get", name="terms", term=STUDENT)
    assert (
        not down["ok"] and "answered 502" in down["message"] and down["columns"] == []
    )
    other = _console(ServiceTermView, "get", name="nobody", term=STUDENT)
    assert other["message"] == "'nobody' is not an Auto Ontology server."


@pytest.mark.django
def test_the_status_probe_is_one_real_call_and_nothing_is_mapped(backend):
    from iblai_ontology.backend.api.views import ServiceMapView, ServiceStatusView

    assert _connect()["ok"]
    asked = len(backend.calls)
    health = _console(ServiceStatusView, name="terms")
    assert health["connected"] is True and health["read_only"] is True
    assert backend.calls[asked:] == ["/api/terms"]

    backend.fail = {"/api/terms": 500}
    assert "answered 500" in _console(ServiceStatusView, name="terms")["message"]
    mapped = _console(ServiceMapView, name="terms")
    assert not mapped["ok"] and mapped["message"] == "'terms' holds no tables to map."


@pytest.mark.django
def test_the_map_draws_its_terms_and_not_the_server(backend):
    from iblai_ontology.backend.api.views import GraphRecordsView, GraphView

    assert _connect()["ok"]
    _campus()
    graph = _console(GraphView, "get")
    assert graph["ok"], graph["message"]
    nodes = {node["id"]: node for node in graph["nodes"]}
    assert "service:terms" not in nodes and "service:campus-pg" in nodes
    student = nodes[f"term:terms:{STUDENT}"]
    assert (student["kind"], student["label"], student["health"]) == (
        "term",
        "Student",
        None,
    )
    assert student["meta"] == {
        "service": "terms",
        "description": "A person enrolled at the institution.",
        "synonyms": ["learner", "pupil"],
        "certification": "certified",
        "elsewhere": 1,
    }
    links = {(link["source"], link["target"], link["kind"]) for link in graph["links"]}
    bio, enrl = (
        f"table:campus-pg:SYSADM.{name}" for name in ("PS_STDNT_BIO", "PS_STDNT_ENRL")
    )
    assert (bio, student["id"], "represents") in links
    assert (enrl, f"term:terms:{ENROLLMENT}", "represents") in links
    # The table that only points at Student is joined to its table, not said to hold it.
    assert (enrl, student["id"], "represents") not in links
    assert (enrl, bio, "joins") in links

    # The records view reads the same systems: a term is never read as a table there.
    records = _console(GraphRecordsView, "get", query="?domain=students")
    assert records["message"] == "Unknown domain."
