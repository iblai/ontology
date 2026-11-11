"""Gateway rate-limit middleware tests (LocMemCache, no DB, no network)."""

from __future__ import annotations

import json as _json

import pytest

pytest.importorskip("django")

pytestmark = pytest.mark.django


@pytest.fixture(autouse=True)
def _django_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


def _mw(**overrides):
    from django.test import override_settings

    from iblai_ontology.backend.ratelimit import OntologyRateLimitMiddleware

    settings = {
        "RATELIMIT_ENABLED": True,
        "RATELIMIT_WINDOW_SECONDS": 60,
        "RATELIMIT_MAX_REQUESTS": 3,
        "RATELIMIT_TOOLS_CALL_MAX": 2,
        **overrides,
    }
    with override_settings(**settings):
        return OntologyRateLimitMiddleware(get_response=lambda req: "OK")


def _post(body=None, ip="1.2.3.4", ontology=None):
    from django.test import RequestFactory

    data = _json.dumps(body) if body is not None else "{}"
    req = RequestFactory().post(
        "/mcp", data=data, content_type="application/json", REMOTE_ADDR=ip
    )
    req.ontology = ontology
    return req


class _Resolved:
    def __init__(self, user_id):
        self.identity = type("I", (), {"user_id": user_id})()


def test_under_limit_passes():
    mw = _mw()
    for _ in range(3):
        assert mw(_post()) == "OK"


def test_over_limit_returns_429_with_retry_after():
    mw = _mw()
    for _ in range(3):
        assert mw(_post()) == "OK"
    resp = mw(_post())
    assert resp.status_code == 429
    assert resp["Retry-After"] == "60"


def test_tools_call_has_stricter_bucket():
    mw = _mw()
    body = {"jsonrpc": "2.0", "method": "tools/call", "id": 1}
    assert mw(_post(body)) == "OK"  # 1st
    assert mw(_post(body)) == "OK"  # 2nd (limit 2)
    assert mw(_post(body)).status_code == 429  # 3rd over


def test_separate_ips_have_separate_buckets():
    mw = _mw()
    for _ in range(3):
        assert mw(_post(ip="10.0.0.1")) == "OK"
    assert mw(_post(ip="10.0.0.1")).status_code == 429
    assert mw(_post(ip="10.0.0.2")) == "OK"  # different IP unaffected


def test_authenticated_subject_keys_separately_from_ip():
    mw = _mw()
    resolved = _Resolved("oid-1")
    for _ in range(3):
        assert mw(_post(ip="10.0.0.9", ontology=resolved)) == "OK"
    assert mw(_post(ip="10.0.0.9", ontology=resolved)).status_code == 429
    # Unauthenticated request from the same IP uses a separate (IP) bucket.
    assert mw(_post(ip="10.0.0.9")) == "OK"


def test_a_verified_dm_token_has_its_own_bucket_behind_one_address():
    """Console requests all arrive from the Ontology Frontend's one address."""
    pytest.importorskip("rest_framework")
    from django.core.cache import cache
    from django.test import RequestFactory

    from iblai_ontology.backend.api.auth import verdict_key

    def get(token):
        req = RequestFactory().get(
            "/roles", REMOTE_ADDR="10.0.0.5", HTTP_AUTHORIZATION=f"Token {token}"
        )
        req.ontology = None
        return req

    mw = _mw()
    for token in ("jane", "john"):  # the console API verified these two
        cache.set(verdict_key(token), {"admin": True}, 300)
    for _ in range(3):
        assert mw(get("jane")) == "OK"
    assert mw(get("jane")).status_code == 429
    assert mw(get("john")) == "OK"  # another user, the same address
    # A token nobody has verified is counted by the address.
    for _ in range(3):
        assert mw(get("unverified")) == "OK"
    assert mw(get("another-unverified")).status_code == 429


def test_a_verified_api_key_and_a_credential_behind_bearer_share_one_bucket():
    """A person's own credential on /mcp is resolved after this middleware runs."""
    pytest.importorskip("rest_framework")
    from django.core.cache import cache
    from django.test import RequestFactory

    from iblai_ontology.backend.api.auth import verdict_key

    def post(authorization):
        req = RequestFactory().post(
            "/mcp",
            data="{}",
            content_type="application/json",
            REMOTE_ADDR="10.0.0.6",
            HTTP_AUTHORIZATION=authorization,
        )
        req.ontology = None
        return req

    mw = _mw()
    cache.set(verdict_key("the-key", "Api-Token"), {"admin": True}, 300)
    for _ in range(3):
        assert mw(post("Api-Token the-key")) == "OK"
    assert mw(post("Api-Token the-key")).status_code == 429
    # Behind Bearer it is the same credential, so the same bucket.
    assert mw(post("Bearer the-key")).status_code == 429
    # Verified as an API key is not verified as a token: under Token it counts by address.
    assert mw(post("Token the-key")) == "OK"


def test_a_batch_counts_once_for_each_tools_call_it_carries():
    mw = _mw()  # two tools/call a window
    call = {"jsonrpc": "2.0", "method": "tools/call", "id": 1}
    ping = {"jsonrpc": "2.0", "method": "ping", "id": 2}
    assert mw(_post([call, ping])) == "OK"  # one call
    assert mw(_post([call, ping, call])).status_code == 429  # two more: three
    # A batch over the limit is refused whole, even as the first request of a window.
    assert mw(_post([call, call, call], ip="10.0.0.3")).status_code == 429
    # A batch with no tools/call is one ordinary request.
    assert mw(_post([ping, ping], ip="10.0.0.4")) == "OK"
    assert mw(_post(["not a message"], ip="10.0.0.4")) == "OK"


def test_disabled_bypasses():
    mw = _mw(RATELIMIT_ENABLED=False)
    for _ in range(10):
        assert mw(_post()) == "OK"
