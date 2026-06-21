"""MCP outbound server (Component 4) — ASGI streamable_http endpoint.

Exposes iblai-ontology as an MCP server. Every request is authenticated by the
identity middleware (Entra ID JWT + X-Iblai-Role), and the dispatched handlers
scope all results to the caller's role.

This module provides a thin Django view that adapts an HTTP POST carrying a
JSON-RPC body to :func:`iblai_ontology.backend.mcp_server.handlers.dispatch`.
"""

from __future__ import annotations

import json

from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers, dispatch


def mcp_view(request):
    """Django view backing POST /mcp (streamable_http transport)."""
    from django.conf import settings
    from django.http import JsonResponse

    resolved = getattr(request, "ontology", None)
    if resolved is None:
        return JsonResponse({"error": "authentication required"}, status=401)

    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid JSON"}, status=400)

    handlers = MCPHandlers(
        MCPContext(
            permissions=resolved.permissions,
            files_root=getattr(settings, "ONTOLOGY_FILES_ROOT", "/ontology"),
        )
    )
    response = dispatch(handlers, body)
    return JsonResponse(response)
