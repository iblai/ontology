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


def test_disabled_bypasses():
    mw = _mw(RATELIMIT_ENABLED=False)
    for _ in range(10):
        assert mw(_post()) == "OK"
