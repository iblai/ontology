"""Gateway identity resolution (Component 3, Option A).

On each MCP request the gateway:
  1. validates the Entra ID JWT (signature/aud/iss/exp),
  2. reads the ibl.ai-platform-supplied ``X-Iblai-Role`` header,
  3. checks the token jti against the replay store (bind/strict — see
     :mod:`~iblai_ontology.backend.identity.replay`),
  4. resolves what that role can access via roles.yaml,
  5. resolves ``${USER_EMPLID}`` from the identity_map for student self-service,
  6. writes an audit_log row keyed by the token jti.

The ibl.ai platform itself may call with the shared service token
(``ONTOLOGY_SERVICE_TOKEN``) instead of a user's JWT; it is the trusted party that
configured the connection, so the role is the ``X-Iblai-Role`` it sends.

``resolve_request`` is the reusable core; ``OntologyIdentityMiddleware`` adapts
it to Django's middleware contract.
"""

from __future__ import annotations

import hmac
import logging
from dataclasses import dataclass
from typing import Optional

from iblai_ontology.backend.identity.entra import EntraIdentity, EntraValidator
from iblai_ontology.backend.identity.roles import (
    DEFAULT_ROLE,
    Permissions,
    RoleNotPermitted,
    RoleResolver,
    RolesUnavailable,
    select_active_role,
)

logger = logging.getLogger("iblai_ontology.audit")

ROLE_HEADER = "X-Iblai-Role"
ROLES_UNAVAILABLE = "Roles are unavailable: the ibl.ai platform did not answer."
# The audit subject of calls made with the service token.
SERVICE_SUBJECT = "platform-service"


@dataclass
class ResolvedRequest:
    identity: EntraIdentity
    permissions: Permissions
    emplid: Optional[str]


def _lookup_emplid(entra_oid: str) -> Optional[str]:
    try:
        from iblai_ontology.backend.identity.models import IdentityMap

        return (
            IdentityMap.objects.filter(entra_oid=entra_oid)
            .values_list("emplid", flat=True)
            .first()
        )
    except Exception:
        return None


def resolve_request(
    *,
    token: str,
    role_header: Optional[str],
    validator: EntraValidator,
    resolver: Optional[RoleResolver] = None,
    emplid_lookup=_lookup_emplid,
    replay_guard=None,
    client_ip: Optional[str] = None,
) -> ResolvedRequest:
    """Validate identity + resolve permissions for one request.

    The active role is derived from the validated token's granted roles; the
    ``X-Iblai-Role`` header only selects among them. Raises
    :class:`~iblai_ontology.backend.identity.roles.RoleNotPermitted` when the
    header requests a role the token does not grant, and
    :class:`~iblai_ontology.backend.identity.entra.EntraTokenError` when
    ``replay_guard`` detects the token's ``jti`` being replayed.
    """
    resolver = resolver or RoleResolver()
    identity = validator.validate(token)
    if replay_guard is not None:
        replay_guard.check(identity, client_ip)
    emplid = emplid_lookup(identity.user_id) if emplid_lookup else None
    role = select_active_role(identity.roles, role_header, resolver)
    permissions = resolver.resolve(role, user_emplid=emplid)
    return ResolvedRequest(identity=identity, permissions=permissions, emplid=emplid)


def resolve_service_request(
    role_header: Optional[str], resolver: Optional[RoleResolver] = None
) -> ResolvedRequest:
    """The platform calling with the service token: its header names the role.

    Raises :class:`RoleNotPermitted` for a role ``roles.yaml`` does not define.
    """
    resolver = resolver or RoleResolver()
    role = role_header or DEFAULT_ROLE
    if role not in resolver.role_names():
        raise RoleNotPermitted(role)
    identity = EntraIdentity(
        user_id=SERVICE_SUBJECT,
        email="",
        name="ibl.ai platform",
        roles=[role],
        groups=[],
        token_jti=None,
        token_exp=None,
        raw_claims={},
    )
    return ResolvedRequest(
        identity=identity, permissions=resolver.resolve(role), emplid=None
    )


def write_audit(
    resolved: ResolvedRequest,
    *,
    action: str,
    resource: str,
    allowed: bool,
    ip_address: Optional[str] = None,
    session_id: str = "",
) -> None:
    """Persist an audit_log row (best-effort; never blocks the request)."""
    try:
        from iblai_ontology.backend import store
        from iblai_ontology.backend.identity.models import AuditLog

        store.create(
            AuditLog,
            user_id=resolved.identity.user_id,
            user_email=resolved.identity.email,
            user_role=resolved.permissions.role,
            action=action,
            resource=resource,
            allowed=allowed,
            ip_address=ip_address,
            session_id=session_id,
            entra_token_id=resolved.identity.token_jti or "",
        )
    except Exception:  # pragma: no cover - auditing must not break requests
        logger.exception("audit write failed: %s %s", action, resource)


class OntologyIdentityMiddleware:
    """Django middleware that attaches ``request.ontology`` (a ResolvedRequest)."""

    def __init__(self, get_response):
        from django.conf import settings

        from iblai_ontology.backend.identity.replay import ReplayGuard

        self.get_response = get_response
        self.resolver = RoleResolver()
        # Construct the validator lazily — a deployment without Entra config can
        # still boot (requests will simply be unauthenticated/401).
        self.validator = None
        if settings.ENTRA_TENANT_ID and settings.ENTRA_CLIENT_ID:
            self.validator = EntraValidator(
                settings.ENTRA_TENANT_ID, settings.ENTRA_CLIENT_ID
            )
        self.replay_guard = ReplayGuard(
            getattr(settings, "JWT_REPLAY_MODE", "bind"),
            ttl_fallback=getattr(settings, "JWT_REPLAY_TTL_FALLBACK", 3600),
        )
        token = getattr(settings, "SERVICE_TOKEN", None)
        if token and len(token) < 32:
            from django.core.exceptions import ImproperlyConfigured

            raise ImproperlyConfigured(
                "ONTOLOGY_SERVICE_TOKEN must be at least 32 characters"
            )

    @staticmethod
    def _client_ip(request) -> str:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

    @staticmethod
    def _is_service_token(token: str) -> bool:
        from django.conf import settings

        expected = getattr(settings, "SERVICE_TOKEN", None) or ""
        return bool(expected) and hmac.compare_digest(token, expected)

    def __call__(self, request):
        from django.http import JsonResponse

        from iblai_ontology.backend.identity.entra import EntraTokenError

        auth = request.headers.get("Authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        if token and self._is_service_token(token):
            try:
                request.ontology = resolve_service_request(
                    request.headers.get(ROLE_HEADER), self.resolver
                )
            except RoleNotPermitted as exc:
                return JsonResponse({"error": str(exc)}, status=403)
            except RolesUnavailable:
                # The role source logged why; never the default role instead.
                return JsonResponse({"error": ROLES_UNAVAILABLE}, status=503)
        elif token and self.validator is not None:
            try:
                request.ontology = resolve_request(
                    token=token,
                    role_header=request.headers.get(ROLE_HEADER),
                    validator=self.validator,
                    resolver=self.resolver,
                    replay_guard=self.replay_guard,
                    client_ip=self._client_ip(request),
                )
            except EntraTokenError as exc:
                return JsonResponse({"error": str(exc)}, status=401)
            except RoleNotPermitted as exc:
                return JsonResponse({"error": str(exc)}, status=403)
            except RolesUnavailable:
                return JsonResponse({"error": ROLES_UNAVAILABLE}, status=503)
        else:
            request.ontology = None
        return self.get_response(request)
