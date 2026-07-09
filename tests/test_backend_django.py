"""Django-backed coverage for command bodies, sync engine, registry, tasks."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

django = pytest.importorskip("django")
pytest.importorskip("cryptography")

pytestmark = pytest.mark.django

runner = CliRunner()


@pytest.fixture()
def backend(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0)
    return tmp_path


def _make_service(name="peoplesoft-main"):
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    return Service.objects.create(
        name=name,
        display_name="PeopleSoft",
        service_type="database",
        adapter="peoplesoft",
        host="db.edu",
        connection_config_encrypted=encrypt_connection_config(
            {"host": "db.edu", "port": 1521, "username": "ro", "password": "secret"}
        ),
        schema_manifest={
            "db_type": "oracle",
            "total_tables": 1,
            "total_rows": 100,
            "tables": [
                {
                    "schema_name": "SYSADM",
                    "table_name": "PS_X",
                    "row_count": 100,
                    "columns": [{"name": "EMPLID"}],
                }
            ],
        },
    )


def test_service_list_schema_connection(backend):
    _make_service()
    assert runner.invoke(app_(), ["service", "list"]).exit_code == 0
    r = runner.invoke(app_(), ["service", "schema", "peoplesoft-main"])
    assert r.exit_code == 0 and "PS_X" in r.stdout
    r = runner.invoke(app_(), ["service", "connection", "peoplesoft-main"])
    assert r.exit_code == 0 and "********" in r.stdout  # password redacted
    assert "secret" not in r.stdout


def test_service_schema_missing(backend):
    assert runner.invoke(app_(), ["service", "schema", "nope"]).exit_code == 1


def test_sync_status_history(backend):
    from django.utils import timezone

    from iblai_ontology.backend.sync.models import SyncRun

    SyncRun.objects.create(
        schedule_name="students-full",
        source_system="peoplesoft",
        started_at=timezone.now(),
        status="success",
        records_processed=42,
    )
    assert runner.invoke(app_(), ["sync", "status"]).exit_code == 0
    assert runner.invoke(app_(), ["sync", "history"]).exit_code == 0


def test_health_db_and_storage(backend):
    assert runner.invoke(app_(), ["health", "db"]).exit_code == 0
    assert runner.invoke(app_(), ["health", "storage"]).exit_code == 0


def test_sync_engine_run_schedule(backend, monkeypatch):
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.backend.sync.models import SyncRun

    runner_obj = SyncRunner()
    monkeypatch.setattr(
        runner_obj, "pull", lambda tool, args=None: [{"id": "1", "name": "A"}]
    )
    # cache table 'demo' doesn't exist -> _write upsert fails -> run recorded failed
    sched = {
        "name": "demo-sync",
        "source": "peoplesoft",
        "tool": "get-demo",
        "output": {"text_memories": "/ontology/demo/", "structured_cache": "demo"},
    }
    result = runner_obj._run_schedule(sched, force_full=False)
    assert result.schedule_name == "demo-sync"
    assert SyncRun.objects.filter(schedule_name="demo-sync").exists()


def test_sync_engine_run_all_due(backend, monkeypatch):
    from iblai_ontology.config.initializer import Initializer

    Initializer(backend / "dep").run(with_samples=True)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(backend / "dep" / "config"))
    from iblai_ontology.backend.sync.engine import SyncRunner

    r = SyncRunner()
    monkeypatch.setattr(r, "pull", lambda tool, args=None: [])
    results = r.run_all_due()
    assert isinstance(results, list)


def test_registry_export(backend):
    _make_service("svc-x")
    from iblai_ontology.backend.services.registry import export_services_yaml

    out = export_services_yaml()
    assert "svc-x" in out


def test_sync_task_run_schedule_not_found(backend, monkeypatch, tmp_path):
    from iblai_ontology.config.initializer import Initializer

    Initializer(tmp_path / "c").run(with_samples=True)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path / "c" / "config"))
    from iblai_ontology.backend.sync.tasks import run_schedule

    assert run_schedule("does-not-exist")["status"] == "not_found"


def app_():
    from iblai_ontology.cli import app

    return app


def test_more_command_bodies(backend, monkeypatch):
    # health mcp/sync + mcp status + data stats run against the sqlite backend.
    assert runner.invoke(app_(), ["health", "mcp"]).exit_code == 0
    assert runner.invoke(app_(), ["health", "sync"]).exit_code == 0
    assert runner.invoke(app_(), ["mcp", "status"]).exit_code == 0
    assert runner.invoke(app_(), ["data", "stats"]).exit_code == 0


def test_data_search_monkeypatched(backend, monkeypatch):
    from iblai_ontology.backend.search.vector import SearchResult

    class FakeVS:
        def query(self, term, domain=None, limit=10):
            return [
                SearchResult(path="/ontology/students/1.md", score=0.9, snippet="hi")
            ]

    monkeypatch.setattr("iblai_ontology.backend.search.vector.VectorSearch", FakeVS)
    r = runner.invoke(app_(), ["data", "search", "struggling"])
    assert r.exit_code == 0 and "0.9" in r.stdout


def test_platform_commands(backend, monkeypatch):
    monkeypatch.setenv("IBLAI_ORG", "alasu")
    monkeypatch.setenv("IBLAI_ADMIN_TOKEN", "tok")

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def register_mcp_server(self, **kw):
            return {"id": 14}

        def create_connection(self, **kw):
            return {"id": 77}

        def attach_to_agent(self, **kw):
            return {"ok": True}

    monkeypatch.setattr(
        "iblai_ontology.backend.platform.client.PlatformClient", FakeClient
    )
    assert (
        runner.invoke(
            app_(), ["platform", "register", "--url", "https://o/mcp"]
        ).exit_code
        == 0
    )
    assert (
        runner.invoke(
            app_(),
            [
                "platform",
                "connect",
                "--server",
                "14",
                "--scope",
                "user",
                "--role",
                "Student",
            ],
        ).exit_code
        == 0
    )
    assert (
        runner.invoke(
            app_(), ["platform", "attach", "agent-uuid", "--server", "14"]
        ).exit_code
        == 0
    )


def test_services_health_monkeypatched(backend, monkeypatch):
    _make_service("svc-h")
    import iblai_ontology.backend.services.health as health_mod
    from iblai_ontology.backend.discovery.safety import (
        SafetyTestResult,
        SafetyVerificationResult,
        TestResult,
    )

    class FakeConn:
        def close(self):
            pass

    monkeypatch.setattr(health_mod, "_connection_for", lambda svc: FakeConn())

    class FakeVerifier:
        def __init__(self, conn):
            pass

        def run_all_tests(self):
            return SafetyVerificationResult(
                overall_status=TestResult.PASSED,
                db_type="oracle",
                tests=[SafetyTestResult("INSERT", "x", TestResult.PASSED)],
            )

    monkeypatch.setattr(
        "iblai_ontology.backend.discovery.safety.SafetyVerifier", FakeVerifier
    )
    conn_result = health_mod.check_connectivity("svc-h")
    assert conn_result.connected and conn_result.read_only
    report = health_mod.full_safety_report("svc-h")
    assert report.all_passed


def test_mcp_view_requires_auth(backend):
    from django.test import RequestFactory

    from iblai_ontology.backend.mcp_server.server import mcp_view

    rf = RequestFactory()
    req = rf.post("/mcp", data="{}", content_type="application/json")
    # No request.ontology attached -> 401.
    resp = mcp_view(req)
    assert resp.status_code == 401


def test_identity_middleware_no_token(backend):
    from iblai_ontology.backend.identity.middleware import OntologyIdentityMiddleware

    mw = OntologyIdentityMiddleware(get_response=lambda req: "OK")
    from django.test import RequestFactory

    req = RequestFactory().get("/mcp")
    assert mw(req) == "OK"
    assert req.ontology is None


def test_identity_middleware_role_escalation_forbidden(backend):
    from django.test import RequestFactory

    from iblai_ontology.backend.identity.entra import EntraIdentity
    from iblai_ontology.backend.identity.middleware import OntologyIdentityMiddleware

    mw = OntologyIdentityMiddleware(get_response=lambda req: "OK")

    class FakeValidator:
        # Token validates but grants no elevated role.
        def validate(self, token):
            return EntraIdentity(
                user_id="oid-1",
                email="u@x.edu",
                name="U",
                roles=[],
                groups=[],
                token_jti="j",
                token_exp=None,
                raw_claims={},
            )

    mw.validator = FakeValidator()
    req = RequestFactory().get(
        "/mcp", HTTP_AUTHORIZATION="Bearer x", HTTP_X_IBLAI_ROLE="Executive"
    )
    resp = mw(req)
    assert resp.status_code == 403


def test_service_mutating_commands(backend, monkeypatch):
    _make_service("svc-m")
    import iblai_ontology.backend.discovery.engine as engine_mod
    import iblai_ontology.backend.provisioning.pipeline as pipe_mod
    import iblai_ontology.backend.services.health as health_mod
    import iblai_ontology.backend.sync.engine as sync_mod

    class FakeEngine:
        def run(self, **kw):
            pass

        def rediscover(self, name, use_llm=True):
            pass

    class FakeProv:
        def provision(self, name):
            pass

        def teardown(self, name):
            pass

    class FakeSync:
        def run_service(self, *a, **k):
            return []

    from iblai_ontology.backend.services.health import (
        ConnectivityResult,
        SafetyCheck,
        SafetyReport,
    )

    monkeypatch.setattr(engine_mod, "DiscoveryEngine", FakeEngine)
    monkeypatch.setattr(pipe_mod, "ProvisioningEngine", FakeProv)
    monkeypatch.setattr(sync_mod, "SyncRunner", FakeSync)
    monkeypatch.setattr(
        health_mod, "check_connectivity", lambda n: ConnectivityResult(True, True, 5)
    )
    monkeypatch.setattr(
        health_mod,
        "full_safety_report",
        lambda n: SafetyReport(checks=[SafetyCheck("INSERT blocked", True)]),
    )

    assert runner.invoke(app_(), ["service", "status", "svc-m"]).exit_code == 0
    assert runner.invoke(app_(), ["service", "test", "svc-m"]).exit_code == 0
    assert runner.invoke(app_(), ["service", "discover", "svc-m"]).exit_code == 0
    assert runner.invoke(app_(), ["service", "approve", "svc-m"]).exit_code == 0
    assert runner.invoke(app_(), ["service", "sync", "svc-m"]).exit_code == 0
    assert runner.invoke(app_(), ["service", "remove", "svc-m", "--yes"]).exit_code == 0


def test_sync_run_and_mcp_test(backend, monkeypatch):
    import iblai_ontology.backend.mcp_server.tester as tester_mod
    import iblai_ontology.backend.sync.engine as sync_mod

    class FakeSync:
        def run_service(self, *a, **k):
            return []

        def run_all_due(self, *a, **k):
            return []

    class FakeTester:
        def call(self, tool, params):
            return {"tool": tool, "ok": True}

    monkeypatch.setattr(sync_mod, "SyncRunner", FakeSync)
    monkeypatch.setattr(tester_mod, "ToolTester", FakeTester)
    assert runner.invoke(app_(), ["sync", "run"]).exit_code == 0
    assert runner.invoke(app_(), ["sync", "run", "peoplesoft"]).exit_code == 0
    r = runner.invoke(app_(), ["mcp", "test", "get-x", "--params", '{"id":"1"}'])
    assert r.exit_code == 0 and "ok" in r.stdout


def test_health_bare_runs_all(backend):
    assert runner.invoke(app_(), ["health"]).exit_code == 0


def test_mcp_view_success(backend):
    from django.test import RequestFactory

    from iblai_ontology.backend.identity.roles import Permissions
    from iblai_ontology.backend.mcp_server import server as server_mod

    class Resolved:
        permissions = Permissions(
            role="Executive", display_name="x", mcp_toolsets=["*"]
        )
        emplid = None

    req = RequestFactory().post(
        "/mcp",
        data='{"jsonrpc":"2.0","method":"tools/list","id":1}',
        content_type="application/json",
    )
    req.ontology = Resolved()
    resp = server_mod.mcp_view(req)
    assert resp.status_code == 200
