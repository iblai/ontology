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
        key, limit, weight = self._bucket(request)
        if self._over_limit(key, limit, weight):
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
        subject = getattr(identity, "user_id", None)
        if subject:
            return subject
        # Console requests all come from the Ontology Frontend's one address, and a person's
        # own credential on /mcp is resolved after this middleware: count a credential the
        # platform has verified by the credential, not by the address.
        # ponytail: a credential not yet verified still counts by address; the edge limits floods.
        word, _, token = request.META.get("HTTP_AUTHORIZATION", "").partition(" ")
        schemes = {
            "token": ("Token",),
            "api-token": ("Api-Token",),
            "bearer": ("Token", "Api-Token"),
        }.get(word.lower(), ())
        if schemes and token.strip():
            from django.core.cache import cache

            from iblai_ontology.backend.api.auth import verdict_key

            for scheme in schemes:
                key = verdict_key(token.strip(), scheme)
                if cache.get(key) is not None:
                    return key
        return None

    def _tools_calls(self, request) -> int:
        """How many ``tools/call`` messages the request carries: a batch counts each one."""
        if request.method != "POST":
            return 0
        try:
            body = json.loads(request.body or b"{}")
        except (ValueError, TypeError):
            return 0
        messages = body if isinstance(body, list) else [body]
        return sum(
            isinstance(m, dict) and m.get("method") == "tools/call" for m in messages
        )

    def _bucket(self, request) -> tuple[str, int, int]:
        """Return the (cache key, limit, weight) for this request."""
        subject = self._subject(request)
        who = f"sub:{subject}" if subject else f"ip:{self._client_ip(request)}"
        calls = self._tools_calls(request)
        if calls:
            return f"rl:tools_call:{who}", self.tools_call_max, calls
        return f"rl:req:{who}", self.max_requests, 1

    def _over_limit(self, key: str, limit: int, weight: int = 1) -> bool:
        """Add ``weight`` to the fixed-window counter for ``key``; True if over ``limit``."""
        from django.core.cache import cache

        # add() starts a new window only if the key is absent; incr() is atomic
        # on a shared backend (Redis). A race on the very first request of a
        # window resolves to at most one extra allowed request, which is fine.
        if cache.add(key, weight, self.window):
            return weight > limit
        try:
            count = cache.incr(key, weight)
        except ValueError:
            # Expired between add and incr — treat as the start of a new window.
            cache.add(key, weight, self.window)
            return weight > limit
        return count > limit
