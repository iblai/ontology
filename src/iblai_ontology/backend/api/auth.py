"""Authentication & authorization for the console REST API.

Two Authorization schemes (wired in ``settings.REST_FRAMEWORK``):

* ``Bearer <entra-jwt>`` — validated by ``OntologyIdentityMiddleware`` before
  DRF runs; :class:`OntologyAuthentication` lifts the middleware's
  ``request.ontology`` into a principal. Access requires the resolved role's
  ``admin_dashboard`` flag (roles.yaml).
* ``Token <dm_token>`` + ``X-Edx-Jwt: <edx-jwt>`` — the ibl.ai path.
  :class:`DmTokenAuthentication` verifies the DM token against
  ``{ONTOLOGY_DM_URL}/api/core/token/verify/`` and reads the caller's platform
  memberships from ``{ONTOLOGY_LMS_URL}/api/ibl/users/manage/platform/`` with
  the edX JWT. Admin = at least one membership with ``active && is_admin`` —
  platform-agnostic, any platform's admin qualifies. The two credentials are
  bound by username (same user must hold both). Verdicts are cached for
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
LMS_PLATFORM_PATH = "/api/ibl/users/manage/platform/"
HTTP_TIMEOUT = 10.0


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
    """ibl.ai path — DM API token + edX JWT, verified upstream and cached."""

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if len(header) != 2 or header[0].lower() != b"token":
            return None
        if not (settings.ONTOLOGY_DM_URL and settings.ONTOLOGY_LMS_URL):
            raise AuthenticationFailed(
                "Token auth is not configured "
                "(set ONTOLOGY_DM_URL and ONTOLOGY_LMS_URL)."
            )
        dm_token = header[1].decode()
        edx_jwt = request.META.get("HTTP_X_EDX_JWT", "")
        if not edx_jwt:
            raise AuthenticationFailed("X-Edx-Jwt header is required with Token auth.")

        key = "dmauth:" + hashlib.sha256(f"{dm_token}\n{edx_jwt}".encode()).hexdigest()
        fields = cache.get(key)
        if fields is None:
            fields = asdict(self._verify(dm_token, edx_jwt))
            cache.set(key, fields, settings.ONTOLOGY_DM_VERIFY_TTL)
        return OntologyPrincipal(**fields), None

    def authenticate_header(self, request):
        return "Token"

    @staticmethod
    def _get_json(url: str, authorization: str, what: str):
        try:
            resp = httpx.get(
                url, headers={"Authorization": authorization}, timeout=HTTP_TIMEOUT
            )
        except httpx.HTTPError as exc:
            raise AuthenticationFailed(
                f"{what} verification unavailable: {exc}"
            ) from exc
        if resp.status_code != 200:
            raise AuthenticationFailed(f"{what} rejected.")
        return resp.json()

    def _verify(self, dm_token: str, edx_jwt: str) -> OntologyPrincipal:
        user = self._get_json(
            settings.ONTOLOGY_DM_URL + DM_VERIFY_PATH, f"Token {dm_token}", "DM token"
        )
        memberships = self._get_json(
            settings.ONTOLOGY_LMS_URL + LMS_PLATFORM_PATH, f"JWT {edx_jwt}", "edX JWT"
        )
        if not isinstance(user, dict):
            raise AuthenticationFailed("DM token rejected.")
        if not isinstance(memberships, list):
            raise AuthenticationFailed("edX JWT rejected.")

        username = user.get("username") or ""
        if not username:
            raise AuthenticationFailed("DM token response has no username.")
        mine = [m for m in memberships if m.get("username") == username]
        if memberships and not mine:
            raise AuthenticationFailed(
                "DM token and edX JWT belong to different users."
            )
        admin = any(m.get("active") and m.get("is_admin") for m in mine)
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
