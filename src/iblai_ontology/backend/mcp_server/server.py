"""MCP outbound server (Component 4) — stateless streamable HTTP endpoint.

Exposes iblai-ontology as an MCP server. Every request is authenticated: by the
identity middleware (an Entra ID JWT, or the platform service token, plus
``X-Iblai-Role``), or here for a person's own ibl.ai credential (a DM token as
``Token``, a platform API key as ``Api-Token``, either one as ``Bearer``). The
dispatched handlers scope all results to the caller's role.

One POST carries one JSON-RPC message (or a batch); the answer is JSON. There is
no server-initiated stream and no session, so a standard client's ``initialize``,
``notifications/initialized``, ``tools/list`` and ``tools/call`` all work without
an ``Mcp-Session-Id``.
"""

from __future__ import annotations

import json

from iblai_ontology.backend.mcp_server.handlers import (
    MCPContext,
    MCPError,
    MCPHandlers,
    dispatch,
)

# Authorization schemes a person's own ibl.ai credential arrives under.
_PLATFORM_SCHEMES = {"token": "Token", "api-token": "Api-Token", "bearer": "Bearer"}
ARGUMENTS_MAX = 4000  # characters of a write's arguments kept in its audit row


def _platform_caller(request):
    """Resolve a person's own ibl.ai credential, or answer why not: ``(resolved, response)``."""
    from django.conf import settings
    from django.http import JsonResponse

    from iblai_ontology.backend.identity.middleware import (
        ROLE_HEADER,
        ROLES_UNAVAILABLE,
        CredentialRefused,
        resolve_platform_request,
    )
    from iblai_ontology.backend.identity.roles import RoleNotPermitted, RolesUnavailable

    word, _, token = request.headers.get("Authorization", "").partition(" ")
    scheme, token = _PLATFORM_SCHEMES.get(word.lower()), token.strip()
    # A JWT behind Bearer is Entra's, and the middleware has already said no to it.
    if not scheme or not token or (scheme == "Bearer" and token.count(".") == 2):
        return None, JsonResponse({"error": "authentication required"}, status=401)
    if getattr(settings, "SECURITY_REQUIRE_HTTPS", True) and not request.is_secure():
        return None, JsonResponse(
            {"error": "token rejected over cleartext connection; use HTTPS"},
            status=403,
        )
    try:
        resolved = resolve_platform_request(
            scheme, token, request.headers.get(ROLE_HEADER)
        )
    except CredentialRefused as exc:
        return None, JsonResponse({"error": str(exc)}, status=exc.status)
    except RoleNotPermitted as exc:
        return None, JsonResponse({"error": str(exc)}, status=403)
    except RolesUnavailable:
        return None, JsonResponse({"error": ROLES_UNAVAILABLE}, status=503)
    return resolved, None


def mcp_view(request):
    """Django view backing POST /mcp."""
    from django.conf import settings
    from django.http import HttpResponse, JsonResponse

    from iblai_ontology.backend.identity.middleware import (
        OntologyIdentityMiddleware,
        write_audit,
    )

    if request.method != "POST":
        # No stream to offer: the spec's answer to GET (and DELETE) is 405.
        return HttpResponse(status=405, headers={"Allow": "POST"})

    resolved = getattr(request, "ontology", None)
    if resolved is None:
        # Here, not in the middleware: past the rate limiter, and never on a console path.
        resolved, refusal = _platform_caller(request)
        if refusal is not None:
            return refusal

    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid JSON"}, status=400)
    messages = body if isinstance(body, list) else [body]
    if not all(isinstance(m, dict) for m in messages):
        return JsonResponse({"error": "invalid JSON-RPC message"}, status=400)

    ip_address = OntologyIdentityMiddleware._client_ip(request) or None

    def before_write(name: str, arguments: dict) -> None:
        """Record a change before it is made; a change that cannot be recorded is not made."""
        kept = json.dumps(arguments, default=str)[:ARGUMENTS_MAX]
        try:
            write_audit(
                resolved,
                action="mcp.tools/call.write",
                resource=name,
                allowed=True,
                ip_address=ip_address,
                details={"arguments": kept},
                strict=True,
            )
        except Exception as exc:
            raise MCPError(
                f"{name} was not run: the call could not be recorded"
            ) from exc

    handlers = MCPHandlers(
        MCPContext(
            permissions=resolved.permissions,
            files_root=getattr(settings, "ONTOLOGY_FILES_ROOT", "/ontology"),
            subject_id=resolved.emplid,
            before_write=before_write,
        )
    )
    responses = []
    for message in messages:
        response = dispatch(handlers, message)
        if message.get("method") == "tools/call":
            answer = response or {}
            write_audit(
                resolved,
                action="mcp.tools/call",
                resource=str((message.get("params") or {}).get("name", "")),
                allowed=not answer.get("error"),
                ip_address=ip_address,
                # Whether the tool itself failed: a refusal is `allowed`, this is the outcome.
                details={"isError": bool((answer.get("result") or {}).get("isError"))},
            )
        if response is not None:
            responses.append(response)
    if not responses:
        return HttpResponse(status=202)  # notifications carry no reply
    return JsonResponse(
        responses if isinstance(body, list) else responses[0], safe=False
    )
