"""The DM half of backend/store.py (ONTOLOGY_DATA_STORE=dm): request shapes against a fake DM."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

pytest.importorskip("django")
httpx = pytest.importorskip("httpx")
pytestmark = pytest.mark.django

BASE = "https://dm.test/api/ai-mentor/orgs/acme/providers/supabase/databases/"
EMPTY_PAGE = {"count": 0, "next_page": None, "previous_page": None, "results": []}


@pytest.fixture
def dm(tmp_path, monkeypatch):
    """The store in dm mode against a scripted DM: (requests seen, replies to give in order)."""
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.conf import settings

    from iblai_ontology.backend import store
    from iblai_ontology.backend.platform.client import PlatformClient, PlatformConfig

    monkeypatch.setattr(settings, "ONTOLOGY_DATA_STORE", "dm")
    requests: list = []
    replies: list = []

    def handler(request):
        requests.append(request)
        return replies.pop(0)

    client = PlatformClient(
        PlatformConfig(
            base_url="https://dm.test",
            org="acme",
            admin_token="key",
            auth_scheme="Api-Token",
        ),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(store, "_client", lambda: client)
    return requests, replies


def _rows(*rows, total=None):
    last = max(len(rows) - 1, 0)
    span = f"0-{last}" if rows else "*"
    return httpx.Response(
        200, json=list(rows), headers={"content-range": f"{span}/{total or len(rows)}"}
    )


def _service(**kw):
    from iblai_ontology.backend.services.models import Service

    return Service(
        name="ps",
        display_name="PeopleSoft",
        service_type="database",
        adapter="peoplesoft",
        **kw,
    )


def test_ensure_schema_creates_the_database_then_objects_in_relation_order(dm):
    from iblai_ontology.backend import store

    requests, replies = dm
    replies += [
        httpx.Response(404),
        httpx.Response(201),
        httpx.Response(200, json=EMPTY_PAGE),
    ]
    replies += [httpx.Response(201) for _ in range(8)]
    created = store.ensure_schema()
    assert created[0] == "ontology" and len(created) == 9
    assert {r.headers["authorization"] for r in requests} == {"Api-Token key"}
    assert [(r.method, str(r.url).removeprefix(BASE)) for r in requests[:3]] == [
        ("GET", "ontology/"),
        ("POST", ""),
        ("GET", "ontology/objects/?page=1"),
    ]
    assert json.loads(requests[1].content) == {"name": "ontology"}
    objects = [json.loads(r.content) for r in requests[3:]]
    names = [o["name"] for o in objects]
    for o in objects:  # a relation's target exists before the object that points at it
        for f in o["fields"]:
            if f["type"] == "RELATION":
                assert names.index(f["relation"]["target"]) < names.index(o["name"])
    fields = {o["name"]: {f["name"]: f for f in o["fields"]} for o in objects}
    svc = fields["services_service"]
    assert svc["name"]["is_unique"] is True and "default" not in svc["name"]
    assert svc["connection_config_encrypted"]["type"] == "TEXT"
    assert svc["status"]["default"] == "pending"
    assert not {"id", "created_at", "updated_at"} & set(
        svc
    )  # the DM's own system fields
    step = fields["provisioning_provisioningstep"]
    assert "order" not in step and step["position"]["type"] == "NUMBER"
    assert step["run_id"]["relation"] == {
        "target": "provisioning_provisioningrun",
        "on_delete": "cascade",
    }
    assert fields["identity_auditlog"]["ip_address"]["type"] == "TEXT"


def test_ensure_schema_adds_only_what_is_missing(dm):
    from iblai_ontology.backend import store

    requests, replies = dm
    existing = []
    for model in store._models():
        names = [
            store.field_spec(f)["name"]
            for f in model._meta.concrete_fields
            if f.column not in store._SYSTEM
        ]
        if model._meta.db_table == "sync_syncrun":
            names.remove("error_message")
        existing.append(
            {"name": model._meta.db_table, "fields": [{"name": n} for n in names]}
        )
    page = {**EMPTY_PAGE, "count": len(existing), "results": existing}
    replies += [
        httpx.Response(200),
        httpx.Response(200, json=page),
        httpx.Response(201),
    ]
    assert store.ensure_schema() == ["sync_syncrun.error_message"]
    assert str(requests[-1].url) == BASE + "ontology/objects/sync_syncrun/fields/"
    assert json.loads(requests[-1].content)["name"] == "error_message"


def test_rows_round_trip_and_dm_rows_never_reach_the_local_db(dm):
    from django.utils.connection import ConnectionDoesNotExist

    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    requests, replies = dm
    token = b"gAAAAABk-not-a-real-fernet-token"
    replies.append(httpx.Response(201))
    svc = _service(connection_config_encrypted=token)
    store.save(svc)
    post = requests[-1]
    assert (
        post.method == "POST"
        and str(post.url) == BASE + "ontology/rest/v1/services_service"
    )
    assert (
        post.headers["prefer"] == "return=minimal" and "content-length" in post.headers
    )
    (sent,) = json.loads(post.content)
    assert (
        sent["id"] == str(svc.pk)
        and sent["connection_config_encrypted"] == token.decode()
    )
    assert sent["created_at"]  # auto_now_add, as the ORM would set it

    replies.append(_rows({**sent, "updated_at": "2026-11-07T10:00:00+00:00"}))
    got = store.first(Service, name="ps")
    params = requests[-1].url.params
    assert (params["name"], params["order"], params["limit"]) == (
        "eq.ps",
        "name.asc,id.asc",
        "1",
    )
    assert got.pk == svc.pk and got.connection_config_encrypted == token
    assert got.updated_at.tzinfo is not None
    assert got._state.db == store.DM_ALIAS and not got._state.adding
    with pytest.raises(ConnectionDoesNotExist):
        list(
            got.health_checks.all()
        )  # a missed related lookup fails instead of reading SQLite

    replies.append(httpx.Response(200, json=[{"id": str(got.pk)}]))
    got.llm_analysis = {"overrides": {}}
    store.save(got, ["llm_analysis"])
    patch = requests[-1]
    assert patch.method == "PATCH" and patch.url.params["id"] == f"eq.{got.pk}"
    assert json.loads(patch.content) == {"llm_analysis": {"overrides": {}}}

    replies.append(httpx.Response(200, json=[]))
    with pytest.raises(Service.DoesNotExist):
        store.save(got, ["status"])  # no row updated

    replies.append(httpx.Response(204))
    store.delete(Service)
    assert requests[-1].method == "DELETE"
    assert (
        requests[-1].url.params["id"] == "not.is.null"
    )  # an unfiltered delete still filters


def test_count_lookups_and_the_timezone_offset(dm):
    from django.utils import timezone

    from iblai_ontology.backend import store
    from iblai_ontology.backend.sync.models import SyncRun

    requests, replies = dm
    since = timezone.now() - timedelta(hours=24)
    replies.append(httpx.Response(200, headers={"content-range": "*/3"}))
    assert store.count(SyncRun, status="failed", started_at__gte=since) == 3
    head = requests[-1]
    assert head.method == "HEAD" and head.headers["prefer"] == "count=exact"
    assert head.url.params["status"] == "eq.failed"
    assert head.url.params["started_at"] == f"gte.{since.isoformat()}"
    assert "%2B00%3A00" in str(head.url)  # the offset's + survives the query string

    replies.append(_rows())
    store.filter(
        SyncRun, order="-started_at", limit=5, schedule_name__icontains="canvas"
    )
    assert requests[-1].url.params["schedule_name"] == "ilike.*canvas*"
    with pytest.raises(ValueError):
        store.filter(SyncRun, schedule_name__in=["a"])


def test_unbounded_reads_page_by_content_range(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.sync.models import SyncRun

    requests, replies = dm
    row = {
        "schedule_name": "s",
        "source_system": "x",
        "started_at": "2026-11-07T10:00:00Z",
    }
    replies.append(
        httpx.Response(
            200,
            json=[{**row, "id": "00000000-0000-0000-0000-000000000001"}],
            headers={"content-range": "0-0/2"},
        )
    )
    replies.append(
        httpx.Response(
            200,
            json=[{**row, "id": "00000000-0000-0000-0000-000000000002"}],
            headers={"content-range": "1-1/2"},
        )
    )
    runs = store.filter(SyncRun)
    assert len(runs) == 2 and runs[1].started_at.tzinfo is not None
    assert [r.url.params["offset"] for r in requests] == ["0", "1"]
    assert {r.headers["prefer"] for r in requests} == {"count=exact"}


def test_bulk_create_batches_under_the_body_cap(dm, monkeypatch):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    requests, replies = dm
    replies.append(httpx.Response(201))
    svc = _service()
    store.save(svc)
    monkeypatch.setattr(store, "_BODY_MAX", 600)
    tables = [
        ServiceTable(
            service=svc,
            position=i,
            payload={"table_name": f"T{i}", "columns": ["c"] * 9},
        )
        for i in range(6)
    ]
    replies += [httpx.Response(201) for _ in range(6)]
    store.bulk_create(ServiceTable, tables)
    posts = [r for r in requests[1:] if r.method == "POST"]
    assert len(posts) > 1 and all(len(p.content) <= 600 for p in posts)
    sent = [row for p in posts for row in json.loads(p.content)]
    assert [r["position"] for r in sent] == list(range(6))
    assert {r["service_id"] for r in sent} == {str(svc.pk)}


def test_dm_errors_are_loud_and_carry_the_dm_message(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.sync.models import SyncRun

    _, replies = dm
    replies.append(httpx.Response(413, text='{"error": "Request body too large"}'))
    with pytest.raises(RuntimeError, match="413.*too large"):
        store.create(
            SyncRun,
            schedule_name="s",
            source_system="x",
            started_at="2026-11-07T10:00Z",
        )


def test_platform_config_scheme_and_empty_base_url(monkeypatch):
    from iblai_ontology.backend.platform.client import DEFAULT_BASE, PlatformConfig

    monkeypatch.setenv("IBLAI_ORG", "acme")
    monkeypatch.setenv("IBLAI_ADMIN_TOKEN", "key")
    monkeypatch.setenv("IBLAI_BASE_URL", "")
    monkeypatch.setenv("IBLAI_AUTH_SCHEME", "Api-Token")
    cfg = PlatformConfig.from_env()
    assert (cfg.base_url, cfg.auth_scheme) == (DEFAULT_BASE, "Api-Token")
    monkeypatch.setenv("IBLAI_AUTH_SCHEME", "Bearer")
    with pytest.raises(RuntimeError, match="IBLAI_AUTH_SCHEME"):
        PlatformConfig.from_env()
