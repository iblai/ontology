"""MCP outbound server (Component 4) — stateless streamable HTTP endpoint.

Exposes iblai-ontology as an MCP server. Every request is authenticated by the
identity middleware (an Entra ID JWT, or the platform service token, plus
``X-Iblai-Role``), and the dispatched handlers scope all results to the caller's
role.

One POST carries one JSON-RPC message (or a batch); the answer is JSON. There is
no server-initiated stream and no session, so a standard client's ``initialize``,
``notifications/initialized``, ``tools/list`` and ``tools/call`` all work without
an ``Mcp-Session-Id``.
"""

from __future__ import annotations

import json

from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers, dispatch


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
        return JsonResponse({"error": "authentication required"}, status=401)

    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid JSON"}, status=400)
    messages = body if isinstance(body, list) else [body]
    if not all(isinstance(m, dict) for m in messages):
        return JsonResponse({"error": "invalid JSON-RPC message"}, status=400)

    handlers = MCPHandlers(
        MCPContext(
            permissions=resolved.permissions,
            files_root=getattr(settings, "ONTOLOGY_FILES_ROOT", "/ontology"),
            subject_id=resolved.emplid,
        )
    )
    responses = []
    for message in messages:
        response = dispatch(handlers, message)
        if message.get("method") == "tools/call":
            write_audit(
                resolved,
                action="mcp.tools/call",
                resource=str((message.get("params") or {}).get("name", "")),
                allowed=not (response or {}).get("error"),
                ip_address=OntologyIdentityMiddleware._client_ip(request) or None,
            )
        if response is not None:
            responses.append(response)
    if not responses:
        return HttpResponse(status=202)  # notifications carry no reply
    return JsonResponse(
        responses if isinstance(body, list) else responses[0], safe=False
    )
