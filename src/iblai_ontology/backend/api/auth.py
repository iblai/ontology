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

The lookup itself is :func:`platform_member`, which the MCP gateway shares: there it
also takes a platform API key (``Api-Token``), cached apart from the console's tokens.

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


def verdict_key(credential: str, scheme: str = "Token") -> str:
    """Where a credential's verdict is cached, per scheme; a value there says it was verified."""
    digest = hashlib.sha256(credential.encode()).hexdigest()
    return f"dmauth:{scheme.lower()}:{digest}"


class CredentialRejected(Exception):
    """The ibl.ai platform refused the credential, or named no user for it."""


class PlatformSilent(Exception):
    """The ibl.ai platform did not answer, so nothing is known about the credential."""


@dataclass(frozen=True)
class PlatformMember:
    """Who a DM token or a platform API key is, as the ibl.ai platform says."""

    user_id: str
    username: str
    email: str
    admin: bool  # an active admin of one of this backend's platforms
    member: bool  # an active member of one of them


def _get_json(path: str, scheme: str, credential: str, what: str, **params):
    try:
        resp = httpx.get(
            settings.ONTOLOGY_DM_URL + path,
            params=params,
            headers={"Authorization": f"{scheme} {credential}"},
            timeout=HTTP_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise PlatformSilent(f"{what} verification unavailable: {exc}") from exc
    if resp.status_code >= 500:
        raise PlatformSilent(
            f"{what} verification unavailable: the platform answered {resp.status_code}"
        )
    if resp.status_code != 200:
        raise CredentialRejected(f"{what} rejected.")
    return resp.json()


def _ask_platform(scheme: str, credential: str) -> PlatformMember:
    what = "DM token" if scheme == "Token" else "API key"
    user = _get_json(DM_VERIFY_PATH, scheme, credential, what)
    if not isinstance(user, dict):
        raise CredentialRejected(f"{what} rejected.")
    username = user.get("username") or ""
    if not username:
        raise CredentialRejected(f"{what} response has no username.")
    # The DM answers a user about their own memberships with the credential alone.
    memberships = _get_json(
        DM_PLATFORMS_PATH,
        scheme,
        credential,
        "Platform memberships",
        username=username,
    )
    if not isinstance(memberships, list):
        raise CredentialRejected("Platform memberships rejected.")
    # The caller's own active memberships on an allowed platform, by its key; an empty
    # allowlist takes any platform.
    allowed = settings.ONTOLOGY_ADMIN_PLATFORMS
    own = [
        m
        for m in memberships
        if m.get("username") == username
        and m.get("active")
        and (not allowed or m.get("key") in allowed)
    ]
    return PlatformMember(
        user_id=str(user.get("user_id") or ""),
        username=username,
        email=user.get("email") or "",
        admin=any(m.get("is_admin") for m in own),
        member=bool(own),
    )


def platform_member(scheme: str, credential: str) -> PlatformMember:
    """Who a DM token (``Token``) or a platform API key (``Api-Token``) is; cached per scheme.

    Raises :class:`CredentialRejected` or :class:`PlatformSilent`; neither is cached.
    """
    key = verdict_key(credential, scheme)
    fields = cache.get(key)
    if fields is None:
        fields = asdict(_ask_platform(scheme, credential))
        cache.set(key, fields, settings.ONTOLOGY_DM_VERIFY_TTL)
    return PlatformMember(**fields)


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
        try:
            who = platform_member("Token", header[1].decode())
        except (CredentialRejected, PlatformSilent) as exc:
            raise AuthenticationFailed(str(exc)) from exc
        principal = OntologyPrincipal(
            kind="dm",
            user_id=who.user_id,
            username=who.username,
            email=who.email,
            role="platform-admin" if who.admin else "platform-user",
            admin=who.admin,
        )
        return principal, None

    def authenticate_header(self, request):
        return "Token"


class AdminDashboardPermission(BasePermission):
    """Console access is admins-only, whichever scheme authenticated them."""

    message = "Admin access to the ontology console is required."

    def has_permission(self, request, view):
        if request.user is not None:
            return bool(request.user.admin)
        # ponytail: dev-only escape hatch — request.user stays None and the
        # audit trail records "dev-anon". Never enable in production.
        return settings.ONTOLOGY_API_DEV_ALLOW_ANON
