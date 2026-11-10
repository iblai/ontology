"""Authentication & authorization for the console REST API.

Two Authorization schemes (wired in ``settings.REST_FRAMEWORK``):

* ``Bearer <entra-jwt>`` — validated by ``OntologyIdentityMiddleware`` before
  DRF runs; :class:`OntologyAuthentication` lifts the middleware's
  ``request.ontology`` into a principal. Access requires the resolved role's
  ``admin_dashboard`` flag.
* ``Token <dm_token>`` — the ibl.ai path. :class:`DmTokenAuthentication` verifies
  the token against ``{ONTOLOGY_DM_URL}/api/core/token/verify/`` and reads the
  caller's own platform memberships from ``…/api/core/users/platforms/`` with the
  same token. Admin = a membership with ``active && is_admin`` on a platform in
  ``ONTOLOGY_ADMIN_PLATFORMS`` (by ``key``; this backend's own ``IBLAI_ORG`` by
  default), or on any platform when that set is empty. Verdicts are cached for
  ``ONTOLOGY_DM_VERIFY_TTL`` seconds, so an upstream revocation takes effect
  within the TTL.

No Django ``User`` rows in either path: ``request.user`` is a small
:class:`OntologyPrincipal` and ``UNAUTHENTICATED_USER`` is ``None``.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass

import httpx
from django.conf import settings
from django.core.cache import cache
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

DM_VERIFY_PATH = "/api/core/token/verify/"
DM_PLATFORMS_PATH = "/api/core/users/platforms/"
HTTP_TIMEOUT = 10.0


def verdict_key(dm_token: str) -> str:
    """Where a DM token's verdict is cached; a value there says the token was verified."""
    return "dmauth:" + hashlib.sha256(dm_token.encode()).hexdigest()


@dataclass(frozen=True)
class OntologyPrincipal:
    """The authenticated caller (``request.user``) for either scheme."""

    kind: str  # "entra" | "dm"
    user_id: str
    username: str
    email: str
    role: str
    admin: bool

    is_authenticated = True  # class attr, not a field: never anonymous


class OntologyAuthentication(BaseAuthentication):
    """Entra path — trust the identity middleware's ``request.ontology``."""

    def authenticate(self, request):
        resolved = getattr(request._request, "ontology", None)
        if resolved is None:
            return None
        principal = OntologyPrincipal(
            kind="entra",
            user_id=resolved.identity.user_id,
            username=resolved.identity.email,
            email=resolved.identity.email,
            role=resolved.permissions.role,
            admin=resolved.permissions.admin_dashboard,
        )
        # request.auth = the ResolvedRequest so views can reuse write_audit().
        return principal, resolved

    def authenticate_header(self, request):
        return "Bearer"


class DmTokenAuthentication(BaseAuthentication):
    """ibl.ai path — a DM API token, verified upstream and cached."""

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if len(header) != 2 or header[0].lower() != b"token":
            return None
        if not settings.ONTOLOGY_DM_URL:
            raise AuthenticationFailed(
                "Token auth is not configured (set ONTOLOGY_DM_URL)."
            )
        dm_token = header[1].decode()
        key = verdict_key(dm_token)
        fields = cache.get(key)
        if fields is None:
            fields = asdict(self._verify(dm_token))
            cache.set(key, fields, settings.ONTOLOGY_DM_VERIFY_TTL)
        return OntologyPrincipal(**fields), None

    def authenticate_header(self, request):
        return "Token"

    @staticmethod
    def _get_json(path: str, dm_token: str, what: str, **params):
        try:
            resp = httpx.get(
                settings.ONTOLOGY_DM_URL + path,
                params=params,
                headers={"Authorization": f"Token {dm_token}"},
                timeout=HTTP_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            raise AuthenticationFailed(
                f"{what} verification unavailable: {exc}"
            ) from exc
        if resp.status_code != 200:
            raise AuthenticationFailed(f"{what} rejected.")
        return resp.json()

    def _verify(self, dm_token: str) -> OntologyPrincipal:
        user = self._get_json(DM_VERIFY_PATH, dm_token, "DM token")
        if not isinstance(user, dict):
            raise AuthenticationFailed("DM token rejected.")
        username = user.get("username") or ""
        if not username:
            raise AuthenticationFailed("DM token response has no username.")
        # The DM answers a user about their own memberships with the token alone.
        memberships = self._get_json(
            DM_PLATFORMS_PATH, dm_token, "Platform memberships", username=username
        )
        if not isinstance(memberships, list):
            raise AuthenticationFailed("Platform memberships rejected.")
        # Admin = an active admin membership on an allowed platform, by its key; an
        # empty allowlist takes any platform's admin.
        allowed = settings.ONTOLOGY_ADMIN_PLATFORMS
        admin = any(
            m.get("username") == username
            and m.get("active")
            and m.get("is_admin")
            and (not allowed or m.get("key") in allowed)
            for m in memberships
        )
        return OntologyPrincipal(
            kind="dm",
            user_id=str(user.get("user_id") or ""),
            username=username,
            email=user.get("email") or "",
            role="platform-admin" if admin else "platform-user",
            admin=admin,
        )


class AdminDashboardPermission(BasePermission):
    """Console access is admins-only, whichever scheme authenticated them."""

    message = "Admin access to the ontology console is required."

    def has_permission(self, request, view):
        if request.user is not None:
            return bool(request.user.admin)
        # ponytail: dev-only escape hatch — request.user stays None and the
        # audit trail records "dev-anon". Never enable in production.
        return settings.ONTOLOGY_API_DEV_ALLOW_ANON
