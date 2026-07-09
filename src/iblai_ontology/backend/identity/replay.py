"""JWT replay protection for the gateway (Component 3).

Entra ID **access tokens are bearer tokens designed for reuse** within their
(~1 hour) lifetime — the ibl.ai platform legitimately forwards the same token
across many MCP requests. So blind single-use enforcement would break the
documented integration. The strongest true anti-replay defences are short token
lifetimes and *sender-constrained* tokens (DPoP / mTLS); those are the real fix
and are recommended in the deployment docs.

This guard is the best-effort layer that fits the current architecture. It keys
a replay store on the token ``jti`` (now a required claim, see
:mod:`~iblai_ontology.backend.identity.entra`) and supports two modes:

* ``bind`` (default) — on first sight, bind the ``jti`` to the request's client
  IP; a later presentation of the *same* ``jti`` from a *different* IP is
  rejected as replay. Legitimate reuse from the platform's stable egress passes;
  a token stolen and replayed from elsewhere is caught.
* ``strict`` — single-use: any second presentation of a ``jti`` is rejected.
  Only appropriate for deployments that mint one-time tokens.
* ``off`` — no replay checking (construct with ``mode="off"`` or simply do not
  wire the guard in).

The store is the Django cache with an entry TTL of ``exp - now`` so entries
expire exactly when the token does — no unbounded growth, no manual cleanup. A
shared cache (``ONTOLOGY_CACHE_URL`` → Redis) enforces the check across worker
processes; on the default per-process ``LocMemCache`` each worker tracks a
``jti`` independently, so a replay is only caught if it lands on a worker that
already saw the token (documented caveat, same as the rate limiter).

A dedicated cache store — rather than a ``unique=True`` constraint on
``AuditLog.entra_token_id`` — is used deliberately: the audit log must record
*every* access (the same ``jti`` appears on many allowed and denied rows in
``bind`` mode), so a DB uniqueness constraint there would break auditing.

The core :func:`ReplayGuard.check` raises
:class:`~iblai_ontology.backend.identity.entra.EntraTokenError` on a detected
replay, which the gateway middleware maps to ``401``. The cache backend and time
source are injectable so this is unit-testable without Django or a real clock.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional

from iblai_ontology.backend.identity.entra import EntraIdentity, EntraTokenError

VALID_MODES = ("off", "bind", "strict")

_KEY_PREFIX = "jwt:jti:"


def _django_cache() -> Any:
    from django.core.cache import cache

    return cache


class ReplayGuard:
    """Detects replay of a token ``jti`` via a TTL-bounded cache store."""

    def __init__(
        self,
        mode: str = "bind",
        *,
        cache: Any | None = None,
        ttl_fallback: int = 3600,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        self.mode = (mode or "off").lower()
        if self.mode not in VALID_MODES:
            # Fail safe: an unrecognised mode disables enforcement rather than
            # silently rejecting every request.
            self.mode = "off"
        self._cache = cache
        self.ttl_fallback = ttl_fallback
        self._now = now or time.time

    def _ttl(self, identity: EntraIdentity) -> int:
        """Seconds until the token expires, bounding the store entry lifetime."""
        exp = identity.token_exp
        if not exp:
            return self.ttl_fallback
        return int(exp - self._now())

    def check(self, identity: EntraIdentity, client_ip: Optional[str]) -> None:
        """Raise :class:`EntraTokenError` if this token is being replayed.

        No-op in ``off`` mode. Best-effort: any cache backend failure is swallowed
        (fail-open) so an unavailable cache degrades availability, not security of
        the primary signature/audience checks that already passed.
        """
        if self.mode == "off":
            return

        jti = identity.token_jti
        if not jti:
            # entra.validate requires jti, but stay defensive if a caller wires a
            # guard around a hand-built identity.
            raise EntraTokenError("token replay check failed: missing jti")

        ttl = self._ttl(identity)
        if ttl <= 0:
            # Token already expired — validate() would have rejected it; nothing
            # to store (a 0/negative cache timeout would never expire).
            return

        cache = self._cache or _django_cache()
        key = f"{_KEY_PREFIX}{jti}"

        try:
            if self.mode == "strict":
                # add() sets the key only if absent: the first caller wins.
                first = cache.add(key, "1", ttl)
                if not first:
                    raise EntraTokenError("token replay detected")
                return

            # bind mode: remember the first-seen sender fingerprint.
            fingerprint = client_ip or "unknown"
            if cache.add(key, fingerprint, ttl):
                return  # first sighting of this jti
            seen = cache.get(key)
        except EntraTokenError:
            raise
        except Exception:  # pragma: no cover - cache backend failure ⇒ fail open
            return

        if seen is not None and seen != fingerprint:
            raise EntraTokenError("token replay detected")
