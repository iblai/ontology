"""Gateway identity resolution (Component 3, Option A).

On each MCP request the gateway:
  1. validates the Entra ID JWT (signature/aud/iss/exp),
  2. reads the ibl.ai-platform-supplied ``X-Iblai-Role`` header,
  3. resolves what that role can access via roles.yaml,
  4. resolves ``${USER_EMPLID}`` from the identity_map for student self-service,
  5. writes an audit_log row keyed by the token jti.

``resolve_request`` is the reusable core; ``OntologyIdentityMiddleware`` adapts
it to Django's middleware contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from iblai_ontology.backend.identity.entra import EntraIdentity, EntraValidator
from iblai_ontology.backend.identity.roles import Permissions, RoleResolver

ROLE_HEADER = "X-Iblai-Role"


@dataclass
class ResolvedRequest:
    identity: EntraIdentity
    permissions: Permissions
    emplid: Optional[str]


def _lookup_emplid(entra_oid: str) -> Optional[str]:
    try:
        from iblai_ontology.backend.identity.models import IdentityMap

        return IdentityMap.objects.filter(entra_oid=entra_oid).values_list("emplid", flat=True).first()
    except Exception:
        return None


def resolve_request(
    *,
    token: str,
    role_header: Optional[str],
    validator: EntraValidator,
    resolver: Optional[RoleResolver] = None,
    emplid_lookup=_lookup_emplid,
) -> ResolvedRequest:
    """Validate identity + resolve permissions for one request."""
    identity = validator.validate(token)
    emplid = emplid_lookup(identity.user_id) if emplid_lookup else None
    permissions = (resolver or RoleResolver()).resolve(role_header, user_emplid=emplid)
    return ResolvedRequest(identity=identity, permissions=permissions, emplid=emplid)


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
        from iblai_ontology.backend.identity.models import AuditLog

        AuditLog.objects.create(
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
        pass


class OntologyIdentityMiddleware:
    """Django middleware that attaches ``request.ontology`` (a ResolvedRequest)."""

    def __init__(self, get_response):
        from django.conf import settings

        self.get_response = get_response
        self.validator = EntraValidator(settings.ENTRA_TENANT_ID, settings.ENTRA_CLIENT_ID)
        self.resolver = RoleResolver()

    def __call__(self, request):
        from django.http import JsonResponse

        from iblai_ontology.backend.identity.entra import EntraTokenError

        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
            try:
                request.ontology = resolve_request(
                    token=token,
                    role_header=request.headers.get(ROLE_HEADER),
                    validator=self.validator,
                    resolver=self.resolver,
                )
            except EntraTokenError as exc:
                return JsonResponse({"error": str(exc)}, status=401)
        else:
            request.ontology = None
        return self.get_response(request)
