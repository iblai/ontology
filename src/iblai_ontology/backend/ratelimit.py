"""Gateway rate limiting (fixed-window throttle).

Bounds request rate to the gateway, keyed on the authenticated subject when
available (falling back to the client IP), with a stricter limit on the
high-value ``tools/call`` operation. Backed by the Django cache, so a shared
cache (Redis) enforces the limit across worker processes; the per-process
LocMemCache still throttles a single worker.

Ordered after :class:`~iblai_ontology.backend.identity.middleware.OntologyIdentityMiddleware`
so ``request.ontology`` (the resolved identity) is available for per-subject
keying. Coarse per-IP limiting at the TLS edge (Caddy) is the documented
defence-in-depth for pre-auth floods.
"""

from __future__ import annotations

import json

DEFAULT_WINDOW_SECONDS = 60
DEFAULT_MAX_REQUESTS = 120
DEFAULT_TOOLS_CALL_MAX = 30


class OntologyRateLimitMiddleware:
    """Fixed-window per-identity / per-IP rate limiting for the gateway."""

    def __init__(self, get_response):
        from django.conf import settings

        self.get_response = get_response
        self.enabled = getattr(settings, "RATELIMIT_ENABLED", True)
        self.window = int(
            getattr(settings, "RATELIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS)
        )
        self.max_requests = int(
            getattr(settings, "RATELIMIT_MAX_REQUESTS", DEFAULT_MAX_REQUESTS)
        )
        self.tools_call_max = int(
            getattr(settings, "RATELIMIT_TOOLS_CALL_MAX", DEFAULT_TOOLS_CALL_MAX)
        )

    def __call__(self, request):
        if not self.enabled:
            return self.get_response(request)
        key, limit = self._bucket(request)
        if self._over_limit(key, limit):
            from django.http import JsonResponse

            response = JsonResponse({"error": "rate limit exceeded"}, status=429)
            response["Retry-After"] = str(self.window)
            return response
        return self.get_response(request)

    def _client_ip(self, request) -> str:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

    def _subject(self, request):
        resolved = getattr(request, "ontology", None)
        identity = getattr(resolved, "identity", None) if resolved else None
        return getattr(identity, "user_id", None)

    def _is_tools_call(self, request) -> bool:
        if request.method != "POST":
            return False
        try:
            body = json.loads(request.body or b"{}")
        except (ValueError, TypeError):
            return False
        return isinstance(body, dict) and body.get("method") == "tools/call"

    def _bucket(self, request) -> tuple[str, int]:
        """Return the (cache key, limit) for this request."""
        subject = self._subject(request)
        who = f"sub:{subject}" if subject else f"ip:{self._client_ip(request)}"
        if self._is_tools_call(request):
            return f"rl:tools_call:{who}", self.tools_call_max
        return f"rl:req:{who}", self.max_requests

    def _over_limit(self, key: str, limit: int) -> bool:
        """Increment the fixed-window counter for ``key``; True if over ``limit``."""
        from django.core.cache import cache

        # add() starts a new window only if the key is absent; incr() is atomic
        # on a shared backend (Redis). A race on the very first request of a
        # window resolves to at most one extra allowed request, which is fine.
        if cache.add(key, 1, self.window):
            return False
        try:
            count = cache.incr(key)
        except ValueError:
            # Expired between add and incr — treat as the start of a new window.
            cache.add(key, 1, self.window)
            return False
        return count > limit
