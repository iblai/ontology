"""A server installed with no platform: locked until the frontend sets it up with its install's code."""

from __future__ import annotations

import pytest

django = pytest.importorskip("django")
pytest.importorskip("cryptography")
pytest.importorskip("rest_framework")
httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.django

CODE = "0123456789abcdef0123456789abcdef"
SIGN_IN = "Token jane-session"
ROOT = "/custom/ontology/"


class _Resp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class Platform:
    """The ibl.ai platform as setting a server up asks it: who a sign-in is, what it holds, a key made."""

    def __init__(self):
        self.user = {"user_id": 7, "username": "jane", "email": "jane@x.edu"}
        self.links = [
            {"username": "jane", "key": "acme", "active": True, "is_admin": True}
        ]
        self.signed_in_to = "acme"  # the platform jane's sign-in belongs to
        self.actions = [
            "*",
            "Ibl.*",
        ]  # what an administrator holds on /custom/ontology/
        self.made: list[tuple[str, str]] = []  # (key, name) of each key made
        self.refused: set[str] = set()  # keys the platform no longer takes
        self.calls: list[tuple[str, str, str]] = []  # (method, path, authorization)

    def get(self, url, params=None, headers=None, timeout=None):
        path = url.removeprefix("http://dm.test")
        sent = headers["Authorization"]
        self.calls.append(("GET", path, sent))
        scheme, _, credential = sent.partition(" ")
        if path == "/api/core/token/verify/":
            if sent != SIGN_IN:
                return _Resp(403, {"detail": "Invalid token."})
            return _Resp(200, self.user)
        if path == "/api/core/users/platforms/":
            return _Resp(200, self.links)
        assert path == "/v1/rbac/permissions/", path
        known = credential in [key for key, _ in self.made]
        if scheme == "Api-Token" and (not known or credential in self.refused):
            return _Resp(403, {"detail": "Invalid token."})
        if headers.get("iblai-org") != self.signed_in_to:
            words = "iblai-org does not match the token's platform."
            return _Resp(403, {"detail": words})
        held = {"actions": self.actions, "data_actions": self.actions}
        return _Resp(200, {ROOT: held})

    def post(self, url, json=None, headers=None, timeout=None):
        path = url.removeprefix("http://dm.test")
        assert path == "/api/core/platform/api-tokens/", path
        self.calls.append(("POST", path, headers["Authorization"]))
        key = f"key-{len(self.made) + 1}"
        self.made.append((key, json["name"]))
        return _Resp(201, {"key": key, "unique_id": f"id-{len(self.made)}"})


@pytest.fixture()
def server(tmp_path, monkeypatch):
    """A fresh server as the install leaves it: rbac, a setup code, no platform and no key."""
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    # Before the switch below: settings load once a process, and must load as local.
    bootstrap()
    from django.conf import settings
    from django.core.cache import cache
    from django.core.management import call_command

    from iblai_ontology.backend import store

    call_command("migrate", run_syncdb=True, verbosity=0)
    call_command("flush", interactive=False, verbosity=0)
    cache.clear()
    monkeypatch.setenv("ONTOLOGY_DATA_STORE", "rbac")
    monkeypatch.setattr(settings, "ONTOLOGY_DATA_STORE", "rbac")
    monkeypatch.setenv("ONTOLOGY_SETUP_CODE", CODE)
    monkeypatch.delenv("IBLAI_ORG", raising=False)
    monkeypatch.delenv("IBLAI_ADMIN_TOKEN", raising=False)
    monkeypatch.setattr(settings, "IBLAI_ORG", "")
    monkeypatch.setattr(settings, "ONTOLOGY_ADMIN_PLATFORMS", set())
    monkeypatch.setattr(settings, "ONTOLOGY_DM_URL", "http://dm.test")
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", False)
    monkeypatch.setattr(store, "_client", None)
    platform = Platform()
    monkeypatch.setattr(httpx, "get", platform.get)
    monkeypatch.setattr(httpx, "post", platform.post)
    yield platform
    cache.clear()


def _call(view, method="get", body=None, authorization=SIGN_IN):
    from rest_framework.test import APIRequestFactory

    extra = {"HTTP_AUTHORIZATION": authorization} if authorization else {}
    factory = APIRequestFactory()
    if body is None:
        raw = getattr(factory, method)("/x", **extra)
    else:
        raw = getattr(factory, method)("/x", body, format="json", **extra)
    resp = view.as_view()(raw)
    resp.render()
    return resp


def _set_up(body=None, authorization=SIGN_IN):
    from iblai_ontology.backend.api.views import SetupView

    body = {"platform": "acme", "code": CODE} if body is None else body
    return _call(SetupView, "post", body, authorization).data


def test_a_fresh_server_refuses_the_console_and_the_gateway(server, monkeypatch):
    from iblai_ontology.backend.api.views import CountsView, SetupView
    from iblai_ontology.backend.identity.middleware import (
        CredentialRefused,
        resolve_platform_request,
    )
    from iblai_ontology.backend.platform import setup
    from iblai_ontology.backend.sync import schedules, tasks

    assert setup.pending()
    assert _call(SetupView).data == {"set_up": False}

    refused = _call(CountsView)
    assert refused.status_code == 503
    assert "not set up yet" in refused.data["detail"]
    with pytest.raises(CredentialRefused) as gateway:
        resolve_platform_request("Token", "jane-session")
    assert gateway.value.status == 503
    # No sign-in was judged: with no platform yet, any platform's administrator would pass.
    assert server.calls == []

    def unread():
        raise AssertionError("the schedules were read")

    monkeypatch.setattr(schedules, "all", unread)
    assert tasks.tick() == []


@pytest.mark.parametrize(
    ("change", "body", "authorization", "words"),
    [
        ({}, {"platform": "acme", "code": "f" * 32}, SIGN_IN, "not its code"),
        ({}, {"platform": "acme"}, SIGN_IN, "not its code"),
        ({}, {"platform": "", "code": CODE}, SIGN_IN, "Choose the platform"),
        ({}, None, "Bearer jane-session", "needs your ibl.ai sign-in"),
        ({}, None, "Token someone-else", "does not take your sign-in"),
        ({}, {"platform": "other", "code": CODE}, SIGN_IN, "administrator of other"),
        ({"admin": False}, None, SIGN_IN, "Only an administrator of acme"),
        ({"signed_in_to": "other"}, None, SIGN_IN, "for another platform than acme"),
        ({"actions": ["Ibl.*"]}, None, SIGN_IN, "cannot grant ontology roles yet"),
    ],
)
def test_what_does_not_set_a_server_up_makes_no_key(
    server, change, body, authorization, words
):
    from iblai_ontology.backend.platform import setup

    if "admin" in change:
        server.links[0]["is_admin"] = change["admin"]
    server.signed_in_to = change.get("signed_in_to", server.signed_in_to)
    server.actions = change.get("actions", server.actions)

    answer = _set_up(body, authorization)
    assert answer["ok"] is False and words in answer["message"]
    assert server.made == [] and setup.pending()


def test_setting_it_up_makes_its_key_in_the_callers_name_and_keeps_it_encrypted(server):
    from iblai_ontology.backend.api.auth import DmTokenAuthentication
    from iblai_ontology.backend.api.views import SetupView
    from iblai_ontology.backend.identity.models import AuditLog
    from iblai_ontology.backend.platform import setup
    from iblai_ontology.backend.platform.client import PlatformConfig
    from iblai_ontology.backend.services.models import Record

    assert _set_up() == {"ok": True, "message": "This server is set up for acme."}

    # One key, asked for with the administrator's own sign-in.
    assert [key for key, _ in server.made] == ["key-1"]
    assert server.calls[-1] == ("POST", "/api/core/platform/api-tokens/", SIGN_IN)
    assert not setup.pending() and setup.platform() == "acme"
    assert setup.admin_platforms() == {"acme"}
    assert _call(SetupView).data == {"set_up": True}

    row = Record.objects.get(kind=setup.KIND, key=setup.KEY).data
    assert row["platform"] == "acme" and row["by"] == "jane"
    assert "key-1" not in row["key"]
    assert setup.credentials() == ("acme", "key-1")
    config = PlatformConfig.from_env()
    assert (config.org, config.admin_token, config.auth_scheme) == (
        "acme",
        "key-1",
        "Api-Token",
    )

    # The console now judges a sign-in for the platform the server was set up for.
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    raw = APIRequestFactory().get("/x", HTTP_AUTHORIZATION=SIGN_IN)
    principal, _ = DmTokenAuthentication().authenticate(Request(raw))
    assert principal.admin is True

    logged = AuditLog.objects.get(action="server.setup")
    assert (logged.user_id, logged.resource, logged.allowed) == ("jane", "acme", True)


def test_a_server_that_is_set_up_is_its_own_platforms_alone(server):
    from iblai_ontology.backend.platform import setup

    assert _set_up()["ok"] is True

    # The code opens nothing more: another platform is refused, whoever asks.
    server.links.append(
        {"username": "jane", "key": "other", "active": True, "is_admin": True}
    )
    moved = _set_up({"platform": "other", "code": CODE})
    assert moved["ok"] is False and "another platform than other" in moved["message"]
    assert setup.platform() == "acme"

    # Connect by one of its own administrators finds a key that works, and makes none.
    assert _set_up({})["ok"] is True
    assert len(server.made) == 1

    server.links[0]["is_admin"] = False
    stranger = _set_up({})
    assert stranger["ok"] is False and "administrator of acme" in stranger["message"]


def test_connect_gives_a_server_a_new_key_when_the_platform_refuses_its_own(server):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.platform import setup

    assert _set_up()["ok"] is True
    before = store.client()
    assert before.config.admin_token == "key-1"

    server.refused.add("key-1")
    assert _set_up({})["ok"] is True
    assert [key for key, _ in server.made] == ["key-1", "key-2"]
    assert setup.credentials() == ("acme", "key-2")
    # Every process reads the row, so the worker's client follows without a restart.
    assert store.client().config.admin_token == "key-2"
    assert store.client() is not before


def test_two_callers_at_once_leave_the_first_ones_platform(server, monkeypatch):
    from iblai_ontology.backend.platform import setup
    from iblai_ontology.backend.services.models import Record

    make_key = setup._make_key

    def overtaken(token):
        # Someone else finishes while this caller's key is being made.
        first = {"platform": "first", "key": ""}
        Record.objects.create(kind=setup.KIND, key=setup.KEY, data=first)
        return make_key(token)

    monkeypatch.setattr(setup, "_make_key", overtaken)
    answer = _set_up()
    assert answer["ok"] is False and "a moment ago" in answer["message"]
    assert setup.platform() == "first"


def test_a_backend_with_its_platform_in_its_environment_has_nothing_to_set_up(
    server, monkeypatch
):
    from django.conf import settings

    from iblai_ontology.backend.platform import setup

    monkeypatch.delenv("ONTOLOGY_SETUP_CODE")
    monkeypatch.setattr(settings, "IBLAI_ORG", "acme")

    assert not setup.pending() and setup.held() == {}
    # Connect asks every backend; this one says yes and asks the platform nothing.
    assert _set_up({"platform": "other", "code": CODE}) == {"ok": True, "message": ""}
    assert server.calls == [] and setup.platform() == "acme"
