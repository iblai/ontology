"""Console REST API — auth, serializers, and endpoint contract.

pytest without pytest-django: the ``api`` fixture boots Django and migrates a
throwaway SQLite db (house pattern from ``test_backend_django.py``). Auth
classes are exercised directly with ``APIRequestFactory`` — no live server.
"""

from __future__ import annotations

import pytest

django = pytest.importorskip("django")
pytest.importorskip("cryptography")
pytest.importorskip("rest_framework")

pytestmark = pytest.mark.django


@pytest.fixture()
def api(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0)
    # Django caches settings.DATABASES at first setup(), so every test shares the
    # first test's sqlite file regardless of ONTOLOGY_SQLITE_PATH — flush for a
    # clean slate per test (true isolation without pytest-django transactions).
    call_command("flush", interactive=False, verbosity=0)
    from django.conf import settings
    from django.core.cache import cache

    cache.clear()
    # Bound the dev-anon flag per test so _dispatch's raw mutation can't leak
    # into later tests (monkeypatch restores the module default on teardown).
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", False)
    return tmp_path


# --- helpers -------------------------------------------------------------


def _drf_request(ontology=None, **headers):
    """A DRF Request wrapping a factory request; sets request._request.ontology."""
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    raw = APIRequestFactory().get("/api/health", **headers)
    raw.ontology = ontology
    return Request(raw)


def _resolved(*, admin=True, email="admin@uni.edu", role="administrator"):
    """A fake ResolvedRequest as the identity middleware would attach."""
    from iblai_ontology.backend.identity.entra import EntraIdentity
    from iblai_ontology.backend.identity.middleware import ResolvedRequest
    from iblai_ontology.backend.identity.roles import Permissions

    identity = EntraIdentity(
        user_id="oid-1",
        email=email,
        name="Admin",
        roles=[role],
        groups=[],
        token_jti="jti-1",
        token_exp=None,
        raw_claims={},
    )
    perms = Permissions(role=role, display_name=role, admin_dashboard=admin)
    return ResolvedRequest(identity=identity, permissions=perms, emplid=None)


class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


JANE = {"user_id": 7, "username": "jane", "email": "jane@x.edu"}


def _link(**fields):
    """One of jane's platform memberships, as the DM lists it."""
    return {
        "username": "jane",
        "key": "acme",
        "org": "acme-org",
        "active": True,
        "is_admin": True,
        **fields,
    }


def _dm_auth(monkeypatch, *, user=None, links=None, admin_platforms=()):
    """Point the Token scheme at canned DM answers; returns the calls it makes."""
    from django.conf import settings

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_ADMIN_PLATFORMS", set(admin_platforms))
    answers = {
        "/api/core/token/verify/": user or _FakeResp(200, JANE),
        "/api/core/users/platforms/": links or _FakeResp(200, [_link()]),
    }
    calls: list[tuple] = []

    def _get(url, params=None, headers=None, timeout=None):
        calls.append((url, params, headers))
        return answers[url.removeprefix("http://dm.test")]

    monkeypatch.setattr("iblai_ontology.backend.api.auth.httpx.get", _get)
    return calls


def _token_request(token="dm"):
    return _drf_request(HTTP_AUTHORIZATION=f"Token {token}")


# --- Entra (Bearer) path -------------------------------------------------


def test_entra_auth_lifts_resolved_request(api):
    from iblai_ontology.backend.api.auth import OntologyAuthentication

    principal, auth = OntologyAuthentication().authenticate(_drf_request(_resolved()))
    assert principal.kind == "entra"
    assert principal.admin is True
    assert principal.is_authenticated is True
    assert auth.identity.user_id == "oid-1"  # ResolvedRequest for write_audit


def test_entra_auth_absent_returns_none(api):
    from iblai_ontology.backend.api.auth import OntologyAuthentication

    assert OntologyAuthentication().authenticate(_drf_request(None)) is None


# --- DM (Token) path -----------------------------------------------------


def test_dm_auth_non_token_scheme_ignored(api):
    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    req = _drf_request(HTTP_AUTHORIZATION="Bearer xyz")
    assert DmTokenAuthentication().authenticate(req) is None


def test_dm_auth_unconfigured_rejects(api, monkeypatch):
    from django.conf import settings
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "")
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(_token_request())


def test_dm_auth_takes_the_dm_token_alone(api, monkeypatch):
    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    calls = _dm_auth(monkeypatch)
    principal, auth = DmTokenAuthentication().authenticate(_token_request())
    assert (principal.kind, principal.username) == ("dm", "jane")
    assert principal.admin is True
    assert auth is None
    # The token's user, then that user's own memberships: both with the one token.
    token = {"Authorization": "Token dm"}
    assert calls == [
        ("http://dm.test/api/core/token/verify/", {}, token),
        ("http://dm.test/api/core/users/platforms/", {"username": "jane"}, token),
    ]


def test_dm_auth_non_admin_membership_denies(api, monkeypatch):
    from iblai_ontology.backend.api.auth import (
        AdminDashboardPermission,
        DmTokenAuthentication,
    )

    _dm_auth(monkeypatch, links=_FakeResp(200, [_link(is_admin=False)]))
    req = _token_request()
    principal, _ = DmTokenAuthentication().authenticate(req)
    assert principal.admin is False
    # authenticated but not authorized → permission denies
    req.user = principal
    assert AdminDashboardPermission().has_permission(req, None) is False


def test_dm_auth_counts_only_the_users_own_active_memberships(api, monkeypatch):
    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    links = [_link(active=False), _link(username="bob")]
    _dm_auth(monkeypatch, links=_FakeResp(200, links))
    principal, _ = DmTokenAuthentication().authenticate(_token_request())
    assert principal.admin is False


def test_dm_auth_verify_rejected_raises(api, monkeypatch):
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    calls = _dm_auth(monkeypatch, user=_FakeResp(401, {"detail": "invalid"}))
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(_token_request())
    assert len(calls) == 1  # the memberships are never asked for


def test_dm_auth_memberships_rejected_raises(api, monkeypatch):
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    _dm_auth(monkeypatch, links=_FakeResp(403, {"detail": "no"}))
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(_token_request())


def test_dm_auth_empty_username_rejected(api, monkeypatch):
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    # The DM omits the username.
    _dm_auth(monkeypatch, user=_FakeResp(200, {"user_id": 7, "email": "x@x.edu"}))
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(_token_request())


def test_dm_auth_caches_verdict(api, monkeypatch):
    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    calls = _dm_auth(monkeypatch)
    auth = DmTokenAuthentication()
    auth.authenticate(_token_request())
    auth.authenticate(_token_request())
    assert len(calls) == 2  # the two DM calls once; the second request is cached
    # Another token is another verdict.
    auth.authenticate(_token_request("another"))
    assert len(calls) == 4


# --- permission ----------------------------------------------------------


def test_permission_dev_anon_allows_when_enabled(api, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.api.auth import AdminDashboardPermission

    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", True)
    req = _drf_request(None)
    req.user = None
    assert AdminDashboardPermission().has_permission(req, None) is True


def test_permission_denies_anon_by_default(api, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.api.auth import AdminDashboardPermission

    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", False)
    req = _drf_request(None)
    req.user = None
    assert AdminDashboardPermission().has_permission(req, None) is False


# --- endpoint contract (full dispatch through auth + permission) ---------


def _make_service(name="peoplesoft-main", password="s3cr3t-pw"):
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    return Service.objects.create(
        name=name,
        display_name="PeopleSoft",
        service_type="database",
        adapter="peoplesoft",
        host="db.edu",
        connection_config_encrypted=encrypt_connection_config(
            {
                "db_type": "oracle",
                "host": "db.edu",
                "port": 1521,
                "database": "CSPRD",
                "username": "ro",
                "password": password,
            }
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
                    "columns": [{"name": "EMPLID"}, {"name": "NAME"}],
                }
            ],
        },
    )


def _dispatch(view, method="get", path="/x", ontology=None, anon=True, data=None):
    """Run a request through a view's full auth+permission+handler stack."""
    from django.conf import settings
    from rest_framework.test import APIRequestFactory

    settings.ONTOLOGY_API_DEV_ALLOW_ANON = anon
    factory = APIRequestFactory()
    kwargs = {"format": "json"} if data is not None else {}
    raw = (
        getattr(factory, method)(path, data, **kwargs)
        if data is not None
        else getattr(factory, method)(path)
    )
    raw.ontology = ontology
    return raw


def _run(view, raw, **view_kwargs):
    resp = view.as_view()(raw, **view_kwargs)
    if hasattr(resp, "render"):  # DRF Response; a plain JsonResponse is pre-rendered
        resp.render()
    return resp


def test_get_services_masks_secrets_and_flattens(api, monkeypatch):
    from iblai_ontology.backend.api.views import ServicesView

    _make_service(password="s3cr3t-pw")
    resp = _run(ServicesView, _dispatch(ServicesView, "get", "/services"))
    assert resp.status_code == 200
    body = resp.content.decode()
    # Raw secret and the encrypted column never appear in the payload.
    assert "s3cr3t-pw" not in body
    assert "connection_config_encrypted" not in body
    svc = next(s for s in resp.data if s["name"] == "peoplesoft-main")
    assert svc["connection_config"]["password"] == "********"
    assert svc["port"] == 1521
    assert svc["database"] == "CSPRD"
    assert svc["domain"] == "higher-ed"
    assert svc["schema_manifest"]["tables"][0]["column_count"] == 2


def test_get_service_missing_returns_null(api):
    from iblai_ontology.backend.api.views import ServiceDetailView

    resp = _run(
        ServiceDetailView,
        _dispatch(ServiceDetailView, "get", "/services/nope"),
        name="nope",
    )
    assert resp.status_code == 200
    # Literal JSON null (not an empty body) so the client's res.json() → null.
    assert resp.content == b"null"


def test_add_duplicate_service_is_ok_false(api):
    from iblai_ontology.backend.api.views import ServicesView

    _make_service("dup")
    raw = _dispatch(
        ServicesView,
        "post",
        "/services",
        data={
            "name": "dup",
            "service_type": "database",
            "adapter": "peoplesoft",
            "host": "db.edu",
        },
    )
    resp = _run(ServicesView, raw)
    assert resp.status_code == 200
    assert resp.data["ok"] is False
    assert "already exists" in resp.data["message"]


def test_approve_without_passed_safety_is_ok_false(api):
    from iblai_ontology.backend.api.views import ServiceApproveView

    _make_service("guardme")  # safety_status defaults to "pending"
    raw = _dispatch(ServiceApproveView, "post", "/services/guardme/approve", data={})
    resp = _run(ServiceApproveView, raw, name="guardme")
    assert resp.status_code == 200
    assert resp.data["ok"] is False
    assert "Safety suite must pass" in resp.data["message"]
    assert "runId" not in resp.data


def test_delete_missing_service_is_ok_false(api):
    from iblai_ontology.backend.api.views import ServiceDetailView

    raw = _dispatch(ServiceDetailView, "delete", "/services/ghost")
    resp = _run(ServiceDetailView, raw, name="ghost")
    assert resp.status_code == 200
    assert resp.data["ok"] is False


def test_status_persists_service_health(api, monkeypatch):
    from iblai_ontology.backend.api.views import ServiceStatusView
    from iblai_ontology.backend.services.health import ConnectivityResult
    from iblai_ontology.backend.services.models import ServiceHealth

    _make_service("checkme")
    monkeypatch.setattr(
        "iblai_ontology.backend.services.health.check_connectivity",
        lambda name: ConnectivityResult(connected=True, read_only=True, latency_ms=7),
    )
    raw = _dispatch(ServiceStatusView, "post", "/services/checkme/status", data={})
    resp = _run(ServiceStatusView, raw, name="checkme")
    assert resp.status_code == 200
    assert resp.data["connected"] is True
    assert resp.data["latency_ms"] == 7
    assert resp.data["service_name"] == "checkme"
    assert ServiceHealth.objects.filter(service__name="checkme").count() == 1


def test_sync_history_duration_is_float(api):
    from decimal import Decimal

    from django.utils import timezone

    from iblai_ontology.backend.api.views import SyncHistoryView
    from iblai_ontology.backend.sync.models import SyncRun

    SyncRun.objects.create(
        schedule_name="students-full",
        source_system="peoplesoft",
        started_at=timezone.now(),
        completed_at=timezone.now(),
        status="success",
        records_processed=10,
        duration_seconds=Decimal("1.50"),
    )
    resp = _run(SyncHistoryView, _dispatch(SyncHistoryView, "get", "/sync/history"))
    assert resp.status_code == 200
    assert resp.data[0]["duration_seconds"] == 1.5
    assert isinstance(resp.data[0]["duration_seconds"], float)


def test_roles_and_counts_shapes(api):
    from iblai_ontology.backend.api.views import CountsView, RolesView

    roles = _run(RolesView, _dispatch(RolesView, "get", "/roles"))
    assert roles.status_code == 200
    assert roles.data and "name" in roles.data[0] and "admin_dashboard" in roles.data[0]

    _make_service("c1")
    counts = _run(CountsView, _dispatch(CountsView, "get", "/counts"))
    assert counts.status_code == 200
    assert set(counts.data) == {"services", "tools", "toolsets", "roles", "data_store"}
    assert (counts.data["services"], counts.data["data_store"]) == (1, "local")


def test_mcp_sources_tolerate_env_tokens_and_redact(api):
    from iblai_ontology.backend.api.views import McpSourcesView

    # Reads the repo's real config/tools.yaml, whose sources use ${ENV} tokens
    # (incl. ${...} ports) and a password — must not crash, must mask secrets.
    resp = _run(McpSourcesView, _dispatch(McpSourcesView, "get", "/mcp/sources"))
    assert resp.status_code == 200
    for src in resp.data:
        assert src.get("password") in (None, "********")


def test_sync_schedules_infers_mode(api):
    from iblai_ontology.backend.api.views import SyncSchedulesView

    resp = _run(
        SyncSchedulesView, _dispatch(SyncSchedulesView, "get", "/sync/schedules")
    )
    assert resp.status_code == 200
    assert resp.data
    modes = {s["mode"] for s in resp.data}
    assert modes <= {"full", "delta", "event"}
    assert all(isinstance(s["enabled"], bool) for s in resp.data)


def test_unauthenticated_is_401_without_dev_anon(api):
    from iblai_ontology.backend.api.views import CountsView

    resp = _run(CountsView, _dispatch(CountsView, "get", "/counts", anon=False))
    assert resp.status_code == 401


def test_non_admin_entra_is_403(api):
    from iblai_ontology.backend.api.views import CountsView

    raw = _dispatch(
        CountsView, "get", "/counts", ontology=_resolved(admin=False), anon=False
    )
    resp = _run(CountsView, raw)
    assert resp.status_code == 403


def test_admin_entra_is_200(api):
    from iblai_ontology.backend.api.views import CountsView

    raw = _dispatch(
        CountsView, "get", "/counts", ontology=_resolved(admin=True), anon=False
    )
    resp = _run(CountsView, raw)
    assert resp.status_code == 200


# --- follow-ups from PR review #2179 -------------------------------------


def test_sync_status_returns_latest_per_schedule(api):
    """M1: newest run per schedule, without loading the whole table."""
    from datetime import timedelta

    from django.utils import timezone

    from iblai_ontology.backend.api.views import SyncStatusView
    from iblai_ontology.backend.sync.models import SyncRun

    now = timezone.now()
    for name, hours_ago, status in [
        ("students", 2, "failed"),
        ("students", 0, "success"),  # newest for students
        ("courses", 3, "success"),
        ("courses", 1, "failed"),  # newest for courses
    ]:
        SyncRun.objects.create(
            schedule_name=name,
            source_system="peoplesoft",
            started_at=now - timedelta(hours=hours_ago),
            status=status,
        )
    resp = _run(SyncStatusView, _dispatch(SyncStatusView, "get", "/sync/status"))
    assert resp.status_code == 200
    assert {r["schedule_name"]: r["status"] for r in resp.data} == {
        "students": "success",
        "courses": "failed",
    }
    assert resp.data[0]["schedule_name"] == "students"  # newest overall, first


def test_runs_view_nests_steps_and_service_name(api):
    from iblai_ontology.backend.api.views import ServiceRunsView
    from iblai_ontology.backend.provisioning.models import (
        ProvisioningRun,
        ProvisioningStep,
    )

    svc = _make_service(name="runs-svc")
    run = ProvisioningRun.objects.create(service=svc, status="completed")
    for i, step_type in enumerate(["cache_schema", "mcp_tools"]):
        ProvisioningStep.objects.create(
            run=run, step_type=step_type, status="completed", order=i
        )
    resp = _run(
        ServiceRunsView,
        _dispatch(ServiceRunsView, path="/services/runs-svc/runs"),
        name="runs-svc",
    )
    assert resp.status_code == 200
    (body,) = resp.data
    assert body["service_name"] == "runs-svc"
    assert [(s["step_type"], s["order"]) for s in body["steps"]] == [
        ("cache_schema", 0),
        ("mcp_tools", 1),
    ]
    missing = _run(
        ServiceRunsView,
        _dispatch(ServiceRunsView, path="/services/nope/runs"),
        name="nope",
    )
    assert missing.data == []


def test_sync_history_service_filter_matches_either_column(api):
    from datetime import timedelta

    from django.utils import timezone

    from iblai_ontology.backend.api.views import SyncHistoryView
    from iblai_ontology.backend.sync.models import SyncRun

    now = timezone.now()
    for schedule, source, hours_ago in [
        ("canvas-activity", "canvas", 3),  # both columns match
        ("lms-pull", "canvas", 1),  # the source matches
        ("canvas-mirror", "slate", 2),  # only the schedule name matches
        ("slate-apps", "slate", 0),  # neither
    ]:
        SyncRun.objects.create(
            schedule_name=schedule,
            source_system=source,
            started_at=now - timedelta(hours=hours_ago),
        )
    names = lambda path: [  # noqa: E731
        r["schedule_name"]
        for r in _run(SyncHistoryView, _dispatch(SyncHistoryView, path=path)).data
    ]
    assert names("/sync/history?service=canvas&limit=2") == [
        "lms-pull",
        "canvas-mirror",
    ]
    assert names("/sync/history?service=canvas") == [
        "lms-pull",
        "canvas-mirror",
        "canvas-activity",
    ]


def test_dm_auth_admin_platform_allowlist_is_by_platform_key(api, monkeypatch):
    """M3: with an allowlist, the admin membership must be on a listed platform."""
    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    def admin(token, **link):
        links = _FakeResp(200, [_link(**link)])
        _dm_auth(monkeypatch, links=links, admin_platforms={"acme"})
        return DmTokenAuthentication().authenticate(_token_request(token))[0].admin

    assert admin("allow-yes", key="acme") is True
    assert admin("allow-no", key="other-co") is False
    # A platform whose org, not its key, is listed does not qualify.
    assert admin("allow-org", key="other-co", org="acme") is False


def test_admin_platforms_default_to_this_backends_own(api):
    from iblai_ontology.backend.settings import _admin_platforms

    assert _admin_platforms({"IBLAI_ORG": "acme"}) == {"acme"}
    listed = {"ONTOLOGY_ADMIN_PLATFORMS": "one, two", "IBLAI_ORG": "acme"}
    assert _admin_platforms(listed) == {"one", "two"}
    # No platform of its own and none listed: any platform's admin, as before.
    assert _admin_platforms({}) == set()


def test_add_service_without_service_type_is_accepted(api, monkeypatch):
    """L2: service_type is optional now — omitting it is not a 400."""
    from iblai_ontology.backend.api.views import ServicesView

    def _boom(self, **kw):  # fail fast — exercise validation, not real DB I/O
        raise RuntimeError("no db here")

    monkeypatch.setattr(
        "iblai_ontology.backend.discovery.engine.DiscoveryEngine.run", _boom
    )
    raw = _dispatch(
        ServicesView,
        "post",
        "/services",
        data={"name": "newsvc", "adapter": "peoplesoft", "host": "db.edu"},
    )
    resp = _run(ServicesView, raw)
    assert resp.status_code == 200  # not 400 — service_type no longer required
    assert resp.data["ok"] is False  # engine raised → business-rule envelope


# --- semantic map + console edits -------------------------------------------


@pytest.fixture()
def cfg(tmp_path, monkeypatch):
    """A scratch copy of the repo's config files so writes never touch config/."""
    import shutil

    from tests.conftest import REPO_ROOT

    cfg = tmp_path / "config"
    cfg.mkdir()
    for name in ("roles.yaml", "tools.yaml", "sync-schedules.yaml"):
        shutil.copy(REPO_ROOT / "config" / name, cfg / name)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    return cfg


def _map_service(name="c1", *, analysis=True):
    from iblai_ontology.backend.services.models import Service

    tables = [
        {
            "schema_name": "SYSADM",
            "table_name": "PS_STDNT_ENRL",
            "row_count": 10,
            "columns": [{"name": "EMPLID"}, {"name": "STRM"}, {"name": "CLASS_NBR"}],
        },
        {
            "schema_name": "SYSADM",
            "table_name": "PS_CLASS_TBL",
            "row_count": 5,
            "columns": [{"name": "CRSE_ID"}, {"name": "STRM"}, {"name": "SUBJECT"}],
        },
    ]
    llm = {
        "table_descriptions": [
            {
                "table_name": "SYSADM.PS_STDNT_ENRL",
                "description": "Enrollment",
                "entity_group": "students",
                "suggested_sync_cadence": "1h",
                "sync_rationale": "",
            },
            {
                "table_name": "SYSADM.PS_CLASS_TBL",
                "description": "Classes",
                "entity_group": "courses",
                "suggested_sync_cadence": "6h",
                "sync_rationale": "",
            },
        ],
        "entity_groups": {"students": ["PS_STDNT_ENRL"], "courses": ["PS_CLASS_TBL"]},
    }
    from iblai_ontology.backend.services.registry import save_manifest

    service = Service.objects.create(
        name=name,
        display_name=name,
        service_type="database",
        adapter="peoplesoft",
        host="db.edu",
        connection_config_encrypted=b"",
        llm_analysis=llm if analysis else {"provider": "rule-based"},
    )
    save_manifest(service, {"db_type": "oracle", "tables": tables})
    return service


def test_graph_view_builds_from_registry_and_config(api, cfg):
    from iblai_ontology.backend.api.views import GraphView

    _map_service()
    body = _run(GraphView, _dispatch(GraphView, path="/graph")).data
    assert body["ok"] is True
    kinds = {n["kind"] for n in body["nodes"]}
    assert {
        "service",
        "table",
        "entity_group",
        "role",
        "toolset",
        "tool",
        "source",
        "schedule",
    } <= kinds
    assert "column" not in kinds
    assert any(link["kind"] == "grants" for link in body["links"])
    assert {"hubs", "orphans", "dangling"} <= set(body["stats"])
    # A memory domain names the tables it is cached in, which are not always its own name.
    cached = {
        n["label"]: n["meta"]["cache_tables"]
        for n in body["nodes"]
        if n["kind"] == "memory_domain"
    }
    assert cached["financial-aid"] == ["financial_aid"]
    assert cached["students"] == ["holds", "students"] and cached["hr"] == []
    with_columns = _run(
        GraphView, _dispatch(GraphView, path="/graph?columns=true")
    ).data
    assert sum(n["kind"] == "column" for n in with_columns["nodes"]) == 6


def test_graph_records_view(api, tmp_path):
    import os

    from iblai_ontology.backend.api.views import GraphRecordsView

    root = os.environ["ONTOLOGY_FILES_ROOT"]
    os.makedirs(os.path.join(root, "students"), exist_ok=True)
    with open(os.path.join(root, "students", "S1.md"), "w") as f:
        f.write("# S1\n\n- id: S1\n")
    body = _run(
        GraphRecordsView,
        _dispatch(GraphRecordsView, path="/graph/records?domain=students"),
    ).data
    assert body["ok"] is True and body["total"] == 1
    assert body["nodes"][0]["id"] == "memory_record:students:S1"
    body = _run(
        GraphRecordsView, _dispatch(GraphRecordsView, path="/graph/records?domain=nope")
    ).data
    assert body["ok"] is False and body["message"] == "Unknown domain."
    resp = _run(
        GraphRecordsView, _dispatch(GraphRecordsView, path="/graph/records?domain=Bad!")
    )
    assert resp.status_code == 400


def test_patch_tables_moves_group_and_rewrites_files(api, tmp_path, monkeypatch):
    import yaml

    from iblai_ontology.backend.api.views import ServiceTablesView
    from iblai_ontology.backend.identity.models import AuditLog
    from iblai_ontology.backend.services.models import Service

    monkeypatch.chdir(tmp_path)
    (tmp_path / "config" / "generated" / "c1").mkdir(parents=True)
    _map_service()
    raw = _dispatch(
        ServiceTablesView,
        "patch",
        "/services/c1/tables",
        data={"tables": ["SYSADM.PS_STDNT_ENRL"], "entity_group": "alumni"},
    )
    body = _run(ServiceTablesView, raw, name="c1").data
    assert body == {"ok": True, "message": "Updated 1 table(s).", "updated": 1}
    analysis = Service.objects.get(name="c1").llm_analysis
    assert analysis["table_descriptions"][0]["entity_group"] == "alumni"
    assert analysis["entity_groups"] == {
        "courses": ["PS_CLASS_TBL"],
        "alumni": ["PS_STDNT_ENRL"],
    }
    assert analysis["overrides"] == {"SYSADM.PS_STDNT_ENRL": {"entity_group": "alumni"}}
    groups = yaml.safe_load(
        (tmp_path / "config/generated/c1/entity-groups.yaml").read_text()
    )
    assert groups["entity_groups"]["alumni"] == ["PS_STDNT_ENRL"]
    assert AuditLog.objects.filter(action="service.tables", resource="c1").exists()


def test_patch_tables_unknown_table_and_missing_field(api):
    from iblai_ontology.backend.api.views import ServiceTablesView

    _map_service()
    raw = _dispatch(
        ServiceTablesView,
        "patch",
        "/services/c1/tables",
        data={"tables": ["SYSADM.NOPE"], "description": "x"},
    )
    body = _run(ServiceTablesView, raw, name="c1").data
    assert body["ok"] is False and "Unknown tables: SYSADM.NOPE" in body["message"]
    raw = _dispatch(
        ServiceTablesView,
        "patch",
        "/services/c1/tables",
        data={"tables": ["SYSADM.PS_X"]},
    )
    assert _run(ServiceTablesView, raw, name="c1").status_code == 400
    raw = _dispatch(
        ServiceTablesView,
        "patch",
        "/services/zz/tables",
        data={"tables": ["a"], "description": "x"},
    )
    assert _run(ServiceTablesView, raw, name="zz").data["ok"] is False


def test_role_crud_roundtrip(api, cfg):
    from iblai_ontology.backend.api.views import RoleDetailView, RolesView

    body = {
        "display_name": "Auditor",
        "mcp_toolsets": ["*"],
        "memory_paths": ["/ontology/students/by-id/${USER_EMPLID}.md"],
    }
    raw = _dispatch(RoleDetailView, "put", "/roles/Auditor", data=body)
    assert _run(RoleDetailView, raw, name="Auditor").data["ok"] is True
    names = [r["name"] for r in _run(RolesView, _dispatch(RolesView)).data]
    assert "Auditor" in names
    assert (
        "${USER_EMPLID}" in (cfg / "roles.yaml").read_text()
    )  # literal, never expanded

    raw = _dispatch(
        RoleDetailView, "put", "/roles/Auditor", data={"display_name": "Audit"}
    )
    assert _run(RoleDetailView, raw, name="Auditor").data["ok"] is True
    role = next(
        r for r in _run(RolesView, _dispatch(RolesView)).data if r["name"] == "Auditor"
    )
    assert role["display_name"] == "Audit" and role["mcp_toolsets"] == ["*"]

    raw = _dispatch(
        RoleDetailView, "put", "/roles/Auditor", data={"mcp_toolsets": ["nope"]}
    )
    body = _run(RoleDetailView, raw, name="Auditor").data
    assert body["ok"] is False and "nope" in body["message"]

    assert _run(
        RoleDetailView, _dispatch(RoleDetailView, "delete"), name="Auditor"
    ).data["ok"]
    assert "Auditor" not in [
        r["name"] for r in _run(RolesView, _dispatch(RolesView)).data
    ]
    assert (
        _run(RoleDetailView, _dispatch(RoleDetailView, "delete"), name="Auditor").data[
            "ok"
        ]
        is False
    )
    assert (
        _run(RoleDetailView, _dispatch(RoleDetailView, "delete"), name="default").data[
            "ok"
        ]
        is False
    )
    raw = _dispatch(RoleDetailView, "put", "/roles/x", data={})
    assert (
        _run(RoleDetailView, raw, name="x").status_code == 400
    )  # display_name required


def test_schedule_toggle_preserves_fields_and_validates(api, cfg):
    from iblai_ontology.backend.api.views import (
        SyncScheduleDetailView,
        SyncSchedulesView,
    )

    before = _run(SyncSchedulesView, _dispatch(SyncSchedulesView)).data
    name = before[0]["name"]
    raw = _dispatch(
        SyncScheduleDetailView,
        "put",
        f"/sync/schedules/{name}",
        data={"enabled": False},
    )
    assert _run(SyncScheduleDetailView, raw, name=name).data["ok"] is True
    after = _run(SyncSchedulesView, _dispatch(SyncSchedulesView)).data
    assert after[0]["name"] == name and after[0]["enabled"] is False
    assert (
        after[0]["output"] == before[0]["output"]
        and after[0]["cron"] == before[0]["cron"]
    )

    raw = _dispatch(
        SyncScheduleDetailView,
        "put",
        f"/sync/schedules/{name}",
        data={"cron": "not a cron"},
    )
    assert _run(SyncScheduleDetailView, raw, name=name).status_code == 400
    raw = _dispatch(
        SyncScheduleDetailView,
        "put",
        "/sync/schedules/new-one",
        data={"source": "s", "cron": "0 * * * *"},
    )
    assert (
        _run(SyncScheduleDetailView, raw, name="new-one").status_code == 400
    )  # tool required
    raw = _dispatch(
        SyncScheduleDetailView,
        "put",
        "/sync/schedules/new-one",
        data={"source": "s", "tool": "t", "cron": "0 * * * *", "mode": "full"},
    )
    assert _run(SyncScheduleDetailView, raw, name="new-one").data["ok"] is True
    assert _run(
        SyncScheduleDetailView,
        _dispatch(SyncScheduleDetailView, "delete"),
        name="new-one",
    ).data["ok"]
    assert "new-one" not in (cfg / "sync-schedules.yaml").read_text()
    assert (
        _run(
            SyncScheduleDetailView,
            _dispatch(SyncScheduleDetailView, "delete"),
            name="new-one",
        ).data["ok"]
        is False
    )


def test_mcp_tool_upsert_delete_and_guards(api, cfg):
    from iblai_ontology.backend.api.views import McpResourceView

    raw = _dispatch(
        McpResourceView,
        "put",
        "/mcp/tools/ping",
        data={
            "type": "postgres-sql",
            "source": "ontology-cache",
            "statement": "SELECT 1",
        },
    )
    body = _run(McpResourceView, raw, name="ping", kind="tool").data
    assert body["ok"] is True and "name: ping" in (cfg / "tools.yaml").read_text()

    text = (cfg / "tools.yaml").read_text()
    body = _run(
        McpResourceView,
        _dispatch(McpResourceView, "delete"),
        name="ontology-cache",
        kind="source",
    ).data
    assert body["ok"] is False and "undefined source" in body["message"]
    assert (cfg / "tools.yaml").read_text() == text  # referenced: untouched

    raw = _dispatch(
        McpResourceView,
        "put",
        "/mcp/sources/x",
        data={"type": "postgres", "host": "h", "password": "hunter2"},
    )
    body = _run(McpResourceView, raw, name="x", kind="source").data
    assert body["ok"] is False and "literal 'password'" in body["message"]
    assert (cfg / "tools.yaml").read_text() == text

    body = _run(
        McpResourceView, _dispatch(McpResourceView, "delete"), name="ping", kind="tool"
    ).data
    assert body["ok"] is True and "name: ping" not in (cfg / "tools.yaml").read_text()
    body = _run(
        McpResourceView, _dispatch(McpResourceView, "delete"), name="ping", kind="tool"
    ).data
    assert body["ok"] is False


def test_mcp_config_get_masks_and_put_validates(api, cfg, monkeypatch):
    from iblai_ontology.backend.api.views import McpConfigView

    monkeypatch.setenv("ONTOLOGY_DB_PASSWORD", "xyz-secret")
    original = (cfg / "tools.yaml").read_text()
    text = _run(McpConfigView, _dispatch(McpConfigView)).data["text"]
    assert "${ONTOLOGY_DB_PASSWORD}" in text and "xyz-secret" not in text
    assert text == original  # unexpanded and comment-complete

    (cfg / "tools.yaml").write_text(
        original + "---\nkind: source\nname: lit\ntype: postgres\npassword: hunter2\n"
    )
    masked = _run(McpConfigView, _dispatch(McpConfigView)).data["text"]
    assert "hunter2" not in masked and "password: ********" in masked
    (cfg / "tools.yaml").write_text(original)

    raw = _dispatch(McpConfigView, "put", "/mcp/config", data={"text": "kind: [\n"})
    body = _run(McpConfigView, raw).data
    assert body["ok"] is False and "parse error" in body["message"]
    assert (cfg / "tools.yaml").read_text() == original

    raw = _dispatch(
        McpConfigView,
        "put",
        "/mcp/config",
        data={"text": original + "\n# trailing note\n"},
    )
    body = _run(McpConfigView, raw).data
    assert body["ok"] is True and body["report"]["tools"] >= 5
    assert (cfg / "tools.yaml").read_text().endswith("# trailing note\n")


def test_config_sends_the_config_files_with_secrets_masked(api, cfg):
    from iblai_ontology.backend.api.views import ConfigFilesView

    (cfg / "ontology.yaml").write_text(
        "llm:\n"
        "  api_key: sk-live-123\n"
        "  token: ${LLM_TOKEN}\n"
        "cache:\n"
        "  url: postgres://ro:hunter2@db.edu/x\n"
        "  replica: postgres://ro:${DB_PASSWORD}@db.edu/x\n"
    )
    data = _run(ConfigFilesView, _dispatch(ConfigFilesView, path="/config")).data
    assert data["root"] == str(cfg)
    files = {f["id"]: f for f in data["files"]}
    assert list(files) == [
        "ontology",
        "schedules",
        "roles",
        "tools",
        "caddyfile",
        "catalog",
    ]
    # A literal secret never leaves the host; a ${VAR} is configuration and stays.
    assert files["ontology"]["content"] == (
        "llm:\n"
        "  api_key: ••••••••\n"
        "  token: ${LLM_TOKEN}\n"
        "cache:\n"
        "  url: postgres://ro:••••••••@db.edu/x\n"
        "  replica: postgres://ro:${DB_PASSWORD}@db.edu/x\n"
    )
    assert files["roles"]["modified_at"] and "roles:" in files["roles"]["content"]
    # Absent is said, not skipped; the catalog ships with the package.
    absent = {"id": "caddyfile", "content": None, "modified_at": None}
    assert dict(files["caddyfile"]) == absent
    assert "entries:" in files["catalog"]["content"]
