"""Gateway transport security: cleartext-token guard + security response headers.

Two defence-in-depth measures for the MCP gateway (Shannon AUTH-VULN-03):

1. **Refuse Bearer tokens over cleartext.** A JWT captured on-path grants full
   access for its validity window (and chains with the no-replay and role-forgery
   findings for total compromise from a single captured token), so a token must
   never traverse a plaintext connection. When a request carries an
   ``Authorization: Bearer`` header but the connection is not secure, the request
   is rejected *before* the token is validated or used. TLS terminates at the
   Caddy edge, so ``SECURE_PROXY_SSL_HEADER`` lets ``request.is_secure()`` trust
   the proxy's ``X-Forwarded-Proto``. This is defence in depth: the primary
   control is that the gateway is only reachable via the TLS proxy in production
   (never directly on ``:8080``).

2. **Set protective response headers** (HSTS, CSP, ``X-Content-Type-Options``,
   ``Referrer-Policy``, ``X-Frame-Options``) on every response. The gateway is a
   JSON-RPC API with no HTML UI, so the CSP is maximally restrictive. HSTS is
   emitted only over HTTPS (it is meaningless — and spec-invalid — over HTTP).

Ordered first in ``MIDDLEWARE`` so the cleartext guard runs before identity
validation and the headers wrap the final response (including 401/403/429 error
responses from the identity and rate-limit middleware). Matching edge-level
headers and the HTTP->HTTPS redirect are configured in ``config/Caddyfile``.
"""

from __future__ import annotations

DEFAULT_HSTS_MAX_AGE = 31536000  # 1 year
DEFAULT_CSP = "default-src 'none'; frame-ancestors 'none'"
DEFAULT_REFERRER_POLICY = "no-referrer"
DEFAULT_FRAME_OPTIONS = "DENY"


class OntologySecurityMiddleware:
    """Reject cleartext-borne tokens and attach security headers to responses."""

    def __init__(self, get_response):
        from django.conf import settings

        self.get_response = get_response
        self.headers_enabled = getattr(settings, "SECURITY_HEADERS_ENABLED", True)
        self.require_https = getattr(settings, "SECURITY_REQUIRE_HTTPS", True)
        self.hsts_max_age = int(
            getattr(settings, "SECURITY_HSTS_MAX_AGE", DEFAULT_HSTS_MAX_AGE)
        )
        self.hsts_include_subdomains = getattr(
            settings, "SECURITY_HSTS_INCLUDE_SUBDOMAINS", True
        )
        self.csp = getattr(settings, "SECURITY_CSP", DEFAULT_CSP)
        self.referrer_policy = getattr(
            settings, "SECURITY_REFERRER_POLICY", DEFAULT_REFERRER_POLICY
        )
        self.frame_options = getattr(
            settings, "SECURITY_FRAME_OPTIONS", DEFAULT_FRAME_OPTIONS
        )

    def __call__(self, request):
        if self.require_https and self._is_cleartext_bearer(request):
            from django.http import JsonResponse

            response = JsonResponse(
                {"error": "bearer token rejected over cleartext connection; use HTTPS"},
                status=403,
            )
            if self.headers_enabled:
                self._apply_headers(request, response)
            return response
        response = self.get_response(request)
        if self.headers_enabled:
            self._apply_headers(request, response)
        return response

    def _is_cleartext_bearer(self, request) -> bool:
        auth = request.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return False
        return not request.is_secure()

    def _apply_headers(self, request, response) -> None:
        # setdefault: never clobber a header a view/proxy already set.
        # HSTS is only meaningful (and only spec-valid) over HTTPS.
        if request.is_secure() and self.hsts_max_age > 0:
            hsts = f"max-age={self.hsts_max_age}"
            if self.hsts_include_subdomains:
                hsts += "; includeSubDomains"
            response.setdefault("Strict-Transport-Security", hsts)
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("Referrer-Policy", self.referrer_policy)
        response.setdefault("Content-Security-Policy", self.csp)
        response.setdefault("X-Frame-Options", self.frame_options)
