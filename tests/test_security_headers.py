"""Gateway security-middleware tests (no DB, no network).

Covers the cleartext-Bearer guard and the security response headers set by
:class:`~iblai_ontology.backend.security_headers.OntologySecurityMiddleware`.
"""

from __future__ import annotations

import pytest

pytest.importorskip("django")

pytestmark = pytest.mark.django


@pytest.fixture(autouse=True)
def _django(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    yield


def _mw(**overrides):
    from django.test import override_settings

    from iblai_ontology.backend.security_headers import OntologySecurityMiddleware

    settings = {
        "SECURITY_HEADERS_ENABLED": True,
        "SECURITY_REQUIRE_HTTPS": True,
        # Django respects X-Forwarded-Proto for is_secure() via this setting.
        "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
        **overrides,
    }
    with override_settings(**settings):
        return OntologySecurityMiddleware(get_response=lambda req: _ok())


def _ok():
    from django.http import HttpResponse

    return HttpResponse("OK")


def _req(*, secure=False, bearer=False):
    from django.test import RequestFactory

    headers = {}
    if secure:
        headers["HTTP_X_FORWARDED_PROTO"] = "https"
    if bearer:
        headers["HTTP_AUTHORIZATION"] = "Bearer abc.def.ghi"
    return RequestFactory().post("/mcp", **headers)


def test_headers_present_on_response():
    resp = _mw()(_req())
    assert resp["X-Content-Type-Options"] == "nosniff"
    assert resp["Referrer-Policy"] == "no-referrer"
    assert (
        resp["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"
    )
    assert resp["X-Frame-Options"] == "DENY"


def test_hsts_only_over_https():
    # HTTP: no HSTS (spec-invalid / meaningless over cleartext).
    resp_http = _mw()(_req(secure=False))
    assert not resp_http.has_header("Strict-Transport-Security")
    # HTTPS (via X-Forwarded-Proto): HSTS present with subdomains + max-age.
    resp_https = _mw()(_req(secure=True))
    assert (
        resp_https["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    )


def test_cleartext_bearer_rejected():
    resp = _mw()(_req(secure=False, bearer=True))
    assert resp.status_code == 403
    # Rejected responses still carry the security headers.
    assert resp["X-Content-Type-Options"] == "nosniff"


def test_bearer_over_https_allowed():
    resp = _mw()(_req(secure=True, bearer=True))
    assert resp.status_code == 200
    assert resp.content == b"OK"


def test_plain_request_over_http_passes():
    # No Bearer token → cleartext is allowed (e.g. health checks).
    resp = _mw()(_req(secure=False, bearer=False))
    assert resp.status_code == 200


def test_require_https_disabled_allows_cleartext_bearer():
    resp = _mw(SECURITY_REQUIRE_HTTPS=False)(_req(secure=False, bearer=True))
    assert resp.status_code == 200


def test_headers_disabled_bypasses():
    resp = _mw(SECURITY_HEADERS_ENABLED=False)(_req(secure=True))
    assert not resp.has_header("X-Content-Type-Options")
    assert not resp.has_header("Strict-Transport-Security")


def test_hsts_max_age_zero_disables_hsts():
    resp = _mw(SECURITY_HSTS_MAX_AGE=0)(_req(secure=True))
    assert not resp.has_header("Strict-Transport-Security")


def test_custom_csp_and_referrer():
    resp = _mw(SECURITY_CSP="default-src 'self'", SECURITY_REFERRER_POLICY="origin")(
        _req()
    )
    assert resp["Content-Security-Policy"] == "default-src 'self'"
    assert resp["Referrer-Policy"] == "origin"
