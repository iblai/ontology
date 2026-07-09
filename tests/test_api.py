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


def _install_httpx(monkeypatch, *, dm, lms, counter):
    """Route httpx.get by path to canned DM-verify / LMS-platform responses."""

    def _get(url, headers=None, timeout=None):
        counter.append(url)
        if "token/verify" in url:
            return dm
        if "manage/platform" in url:
            return lms
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr("iblai_ontology.backend.api.auth.httpx.get", _get)


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
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "")
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(req)


def test_dm_auth_missing_jwt_header_rejects(api, monkeypatch):
    from django.conf import settings
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    req = _drf_request(HTTP_AUTHORIZATION="Token dm")  # no X-Edx-Jwt
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(req)


def test_dm_auth_admin_membership_grants(api, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(200, {"user_id": 7, "username": "jane", "email": "jane@x.edu"}),
        lms=_FakeResp(
            200,
            [{"username": "jane", "org": "acme", "active": True, "is_admin": True}],
        ),
        counter=[],
    )
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    principal, auth = DmTokenAuthentication().authenticate(req)
    assert principal.kind == "dm"
    assert principal.username == "jane"
    assert principal.admin is True
    assert auth is None


def test_dm_auth_non_admin_membership_denies(api, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.api.auth import (
        AdminDashboardPermission,
        DmTokenAuthentication,
    )

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", False)
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(200, {"user_id": 7, "username": "jane", "email": "jane@x.edu"}),
        lms=_FakeResp(
            200,
            [{"username": "jane", "org": "acme", "active": True, "is_admin": False}],
        ),
        counter=[],
    )
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    principal, _ = DmTokenAuthentication().authenticate(req)
    assert principal.admin is False
    # authenticated but not authorized → permission denies
    req.user = principal
    assert AdminDashboardPermission().has_permission(req, None) is False


def test_dm_auth_verify_rejected_raises(api, monkeypatch):
    from django.conf import settings
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(401, {"detail": "invalid"}),
        lms=_FakeResp(200, []),
        counter=[],
    )
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(req)


def test_dm_auth_username_mismatch_raises(api, monkeypatch):
    from django.conf import settings
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(200, {"user_id": 7, "username": "jane", "email": "jane@x.edu"}),
        lms=_FakeResp(
            200,
            [{"username": "bob", "org": "acme", "active": True, "is_admin": True}],
        ),
        counter=[],
    )
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(req)


def test_dm_auth_empty_username_rejected(api, monkeypatch):
    from django.conf import settings
    from rest_framework.exceptions import AuthenticationFailed

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(200, {"user_id": 7, "email": "x@x.edu"}),  # DM omits username
        lms=_FakeResp(200, [{"username": "", "active": True, "is_admin": True}]),
        counter=[],
    )
    req = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    with pytest.raises(AuthenticationFailed):
        DmTokenAuthentication().authenticate(req)


def test_dm_auth_caches_verdict(api, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.api.auth import DmTokenAuthentication

    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_LMS_URL", "http://lms.test")
    calls: list[str] = []
    _install_httpx(
        monkeypatch,
        dm=_FakeResp(200, {"user_id": 7, "username": "jane", "email": "jane@x.edu"}),
        lms=_FakeResp(
            200,
            [{"username": "jane", "org": "acme", "active": True, "is_admin": True}],
        ),
        counter=calls,
    )
    auth = DmTokenAuthentication()
    r1 = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    r2 = _drf_request(HTTP_AUTHORIZATION="Token dm", HTTP_X_EDX_JWT="jwt")
    auth.authenticate(r1)
    auth.authenticate(r2)
    assert len(calls) == 2  # DM + LMS once; second request served from cache


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
    raw = getattr(factory, method)(path, data, **kwargs) if data is not None else getattr(factory, method)(path)
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
        ServiceDetailView, _dispatch(ServiceDetailView, "get", "/services/nope"), name="nope"
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
    assert set(counts.data) == {"services", "tools", "toolsets", "roles"}
    assert counts.data["services"] == 1


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

    resp = _run(SyncSchedulesView, _dispatch(SyncSchedulesView, "get", "/sync/schedules"))
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
