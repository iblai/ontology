"""The DM half of backend/store.py (ONTOLOGY_DATA_STORE=dm): what goes to the ibl.ai platform's
records API, what comes back as model instances, and what never leaves this host."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

import pytest

pytest.importorskip("django")
httpx = pytest.importorskip("httpx")
pytestmark = pytest.mark.django

RECORDS = "/v1/ontology/kinds/"


def _service(name="ps", **kw):
    from iblai_ontology.backend.services.models import Service

    return Service(
        name=name,
        display_name="PeopleSoft",
        service_type="database",
        adapter="peoplesoft",
        **kw,
    )


def _body(request):
    return json.loads(request.content)


def test_a_row_round_trips_as_a_record_and_never_reaches_the_local_db(dm):
    from django.utils.connection import ConnectionDoesNotExist

    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    token = b"gAAAAABk-not-a-real-fernet-token"
    svc = _service(connection_config_encrypted=token)
    store.save(svc)
    post = dm.calls[-1]
    assert (post.method, post.url.path) == (
        "POST",
        RECORDS + "services_service/records",
    )
    # Bytes with a length: the DM answers 411 to a chunked body.
    assert int(post.headers["content-length"]) == len(post.content)
    sent = _body(post)
    assert (sent["key"], sent["unique_key"]) == (str(svc.pk), "ps")
    assert sent["data"]["id"] == str(svc.pk)
    assert sent["data"]["connection_config_encrypted"] == token.decode()
    # auto_now_add as the ORM sets it, at a fixed width so it orders as text.
    assert datetime.fromisoformat(sent["data"]["created_at"]).tzinfo is not None
    assert len(sent["data"]["created_at"]) == len("2026-11-10T09:00:00.000000+00:00")
    assert not Service.objects.exists()

    got = store.first(Service, name="ps")
    params = dm.calls[-1].url.params
    assert json.loads(params["where"]) == {"name": "ps"}
    assert (params["order"], params["page_size"]) == ("name", "1")
    assert got.pk == svc.pk and got.connection_config_encrypted == token
    assert got.created_at.tzinfo is not None
    assert got._state.db == store.DM_ALIAS and not got._state.adding
    with pytest.raises(ConnectionDoesNotExist):
        # A missed related lookup fails instead of reading SQLite.
        list(got.health_checks.all())


def test_save_merges_the_named_fields_and_a_missing_record_is_gone(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    svc = store.create(
        Service, name="ps", adapter="peoplesoft", service_type="database"
    )
    svc.llm_analysis = {"overrides": {}}
    svc.display_name = "not saved"
    store.save(svc, ["llm_analysis"])
    patch = dm.calls[-1]
    assert (patch.method, patch.url.path) == (
        "PATCH",
        f"{RECORDS}services_service/records/{svc.pk}",
    )
    assert _body(patch) == {"data": {"llm_analysis": {"overrides": {}}}}
    stored = dm.records["services_service", str(svc.pk)]["data"]
    assert (stored["llm_analysis"], stored["display_name"]) == ({"overrides": {}}, "")

    # The unique field travels as the record's unique key too, when it is saved.
    svc.name = "peoplesoft"
    store.save(svc, ["name"])
    assert _body(dm.calls[-1]) == {
        "data": {"name": "peoplesoft"},
        "unique_key": "peoplesoft",
    }

    del dm.records["services_service", str(svc.pk)]
    with pytest.raises(Service.DoesNotExist):
        store.save(svc, ["status"])  # as Django raises on a 0-row update_fields save


def test_a_new_instance_is_inserted_even_with_update_fields(dm):
    """What the discovery engine does: ``first(...) or Service(name=...)``, then a partial save."""
    from iblai_ontology.backend import store

    svc = _service()
    store.save(svc, ["display_name", "updated_at"])
    assert dm.calls[-1].method == "POST"
    assert (
        dm.records["services_service", str(svc.pk)]["data"]["adapter"] == "peoplesoft"
    )


def test_filters_are_equals_null_and_a_foreign_key_by_pk(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.provisioning.models import ProvisioningRun
    from iblai_ontology.backend.services.models import Service, ServiceHealth

    svc = _service()
    store.save(svc)
    run = store.create(ProvisioningRun, service=svc)
    found = store.filter(
        ProvisioningRun, service=svc.pk, status="pending", completed_at=None
    )
    params = dm.calls[-1].url.params
    assert json.loads(params["where"]) == {
        "service_id": str(svc.pk),
        "status": "pending",
        "completed_at": None,
    }
    assert params["order"] == "-started_at"
    assert [r.pk for r in found] == [run.pk]
    # A model instance is its pk, and a boolean stays one.
    assert [r.service_id for r in store.filter(ProvisioningRun, service=svc)] == [
        svc.pk
    ]
    store.create(ServiceHealth, service=svc, connected=True)
    assert len(store.filter(ServiceHealth, connected=True)) == 1
    assert json.loads(dm.calls[-1].url.params["where"]) == {"connected": True}
    assert store.filter(ServiceHealth, connected=False) == []
    assert store.count(Service, name="ps") == 1 and store.count(Service, name="x") == 0
    assert dm.calls[-1].url.params["page_size"] == "1"  # the count is the envelope's
    with pytest.raises(Service.DoesNotExist):
        store.get(Service, name="nope")
    # Only the ORM answers these, and no registry model is asked them.
    for lookup in ("name__icontains", "created_at__gte", "created_at__gt"):
        with pytest.raises(ValueError, match="not answered"):
            store.filter(Service, **{lookup: "x"})


def test_order_is_the_models_own_unless_given_and_columns_are_named(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.provisioning.models import (
        ProvisioningRun,
        ProvisioningStep,
    )

    svc = _service()
    store.save(svc)
    run = store.create(ProvisioningRun, service=svc)
    for order, step in ((2, "mcp_tools"), (1, "cache_schema"), (3, "validation")):
        store.create(ProvisioningStep, run=run, step_type=step, order=order)
    assert [s.step_type for s in store.filter(ProvisioningStep, run=run.pk)] == [
        "cache_schema",
        "mcp_tools",
        "validation",
    ]
    assert dm.calls[-1].url.params["order"] == "position"  # the column, not the field
    newest = store.filter(ProvisioningStep, run=run.pk, order="-order")
    assert [s.order for s in newest] == [3, 2, 1]


def test_reads_page_until_the_dm_says_there_is_no_next_page(dm, monkeypatch):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    svc = _service()
    store.save(svc)
    store.bulk_create(
        ServiceTable,
        [ServiceTable(service=svc, position=i, payload={"n": i}) for i in range(5)],
    )
    monkeypatch.setattr(store, "_PAGE", 2)
    dm.calls.clear()
    tables = store.filter(ServiceTable, service=svc.pk)
    assert [t.position for t in tables] == [0, 1, 2, 3, 4]
    assert [r.url.params["page"] for r in dm.calls] == ["1", "2", "3"]
    assert {r.url.params["page_size"] for r in dm.calls} == {"2"}
    # A limit stops at the page that fills it.
    dm.calls.clear()
    assert len(store.filter(ServiceTable, service=svc.pk, limit=3)) == 3
    assert len(dm.calls) == 2


def test_bulk_create_batches_under_the_body_cap(dm, monkeypatch):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    svc = _service()
    store.save(svc)
    monkeypatch.setattr(store, "_BODY_MAX", 900)
    tables = [
        ServiceTable(
            service=svc,
            position=i,
            payload={"table_name": f"T{i}", "columns": ["c"] * 9},
        )
        for i in range(6)
    ]
    dm.calls.clear()
    store.bulk_create(ServiceTable, tables)
    assert len(dm.calls) > 1 and all(len(r.content) <= 900 for r in dm.calls)
    sent = [record for r in dm.calls for record in _body(r)]
    assert [record["data"]["position"] for record in sent] == list(range(6))
    assert {record["data"]["service_id"] for record in sent} == {str(svc.pk)}
    assert {record["unique_key"] for record in sent} == {None}
    assert all(not t._state.adding for t in tables)


def test_delete_takes_the_rows_that_point_at_it_children_first(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.discovery.models import SafetyReport
    from iblai_ontology.backend.provisioning.models import (
        ProvisioningRun,
        ProvisioningStep,
    )
    from iblai_ontology.backend.services.models import (
        Service,
        ServiceHealth,
        ServiceTable,
    )

    keep, gone = _service("keep"), _service("gone")
    for svc in (keep, gone):
        store.save(svc)
        store.create(ServiceHealth, service=svc, connected=True, read_only=True)
        store.bulk_create(ServiceTable, [ServiceTable(service=svc, payload={})])
        run = store.create(ProvisioningRun, service=svc)
        store.create(ProvisioningStep, run=run, step_type="cache_schema", order=1)
    store.create(SafetyReport, service_name="gone", status="passed", port=5432)

    dm.calls.clear()
    store.delete(Service, name="gone")
    deletes = [r.url.path.split("/")[4] for r in dm.calls if r.method == "DELETE"]
    # Steps before their runs, and the service last.
    assert deletes.index("provisioning_provisioningstep") < deletes.index(
        "provisioning_provisioningrun"
    )
    assert deletes[-1] == "services_service" and len(deletes) == 5
    # One of each for the service kept; the report names no service row, so it stays.
    assert Counter(kind for kind, _ in dm.records) == {
        "services_service": 1,
        "services_servicehealth": 1,
        "services_servicetable": 1,
        "provisioning_provisioningrun": 1,
        "provisioning_provisioningstep": 1,
        "discovery_safetyreport": 1,
    }
    assert store.count(ServiceHealth, service=keep.pk) == 1

    # Deleting a model outright sends an empty ``where``, which is the whole kind.
    store.delete(Service)
    assert [k for k, _ in dm.records] == ["discovery_safetyreport"]
    assert _body(dm.calls[-1]) == {"where": {}}


def test_a_child_delete_names_its_parents_by_key(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    svc = _service()
    store.save(svc)
    store.bulk_create(ServiceTable, [ServiceTable(service=svc, payload={})])
    dm.calls.clear()
    store.delete(ServiceTable, service=svc.pk)
    # No model points at a table, so nothing is read first.
    assert [(r.method, _body(r)) for r in dm.calls] == [
        ("DELETE", {"where": {"service_id": str(svc.pk)}})
    ]


def test_a_field_newer_than_the_record_reads_as_its_default(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    svc = _service()
    store.save(svc)
    data = dm.records["services_service", str(svc.pk)]["data"]
    for column in ("status", "llm_analysis", "last_discovery_at"):
        del data[column]
    got = store.get(Service, name="ps")
    assert (got.status, got.llm_analysis, got.last_discovery_at) == (
        Service._meta.get_field("status").get_default(),
        Service._meta.get_field("llm_analysis").get_default(),
        None,
    )


def test_sync_runs_and_the_audit_log_stay_in_the_local_database(dm):
    from django.utils import timezone as django_timezone

    from iblai_ontology.backend import store
    from iblai_ontology.backend.identity.models import AuditLog
    from iblai_ontology.backend.sync.models import SyncRun

    run = store.create(
        SyncRun,
        schedule_name="canvas-activity",
        source_system="canvas",
        started_at=django_timezone.now(),
    )
    store.create(
        AuditLog, user_id="u1", user_role="admin", action="tools/call", resource="t"
    )
    assert SyncRun.objects.get().pk == run.pk and AuditLog.objects.count() == 1
    since = datetime(2020, 1, 1, tzinfo=timezone.utc)
    assert store.count(SyncRun, started_at__gte=since) == 1
    found = store.filter(
        SyncRun, order="-started_at", limit=5, schedule_name__icontains="canvas"
    )
    assert [r.pk for r in found] == [run.pk]
    store.delete(SyncRun)
    assert not SyncRun.objects.exists()
    assert dm.calls == [] and dm.records == {}


def test_dm_errors_are_loud_and_carry_the_dm_message(dm):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    svc = _service()
    store.save(svc)
    with pytest.raises(RuntimeError, match="409.*already has that key"):
        store.bulk_create(Service, [_service("other", id=svc.pk)])
    dm.down = (503, {"error": "not available on this instance yet"})
    with pytest.raises(RuntimeError, match="503.*not available"):
        store.filter(Service)
    # The first call a delete makes is the read of the parents' keys.
    with pytest.raises(RuntimeError, match="DM GET v1/ontology/kinds/services_service"):
        store.delete(Service, name="ps")
    with pytest.raises(RuntimeError, match="DM PUT v1/ontology/kinds/sync_schedule"):
        store.put_record("sync_schedule", "nightly", {})


def test_schedules_and_raw_records_share_the_store_helpers(dm):
    from iblai_ontology.backend import store

    store.put_record("sync_schedule", "nightly", {"cron": "0 2 * * *"})
    assert dm.sent("PUT") == [RECORDS + "sync_schedule/records/nightly"]
    assert _body(dm.calls[-1]) == {"data": {"cron": "0 2 * * *"}, "unique_key": None}
    assert [r["key"] for r in store.records("sync_schedule")] == ["nightly"]
    assert store.delete_record("sync_schedule", "nightly") is True
    assert store.delete_record("sync_schedule", "nightly") is False


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
