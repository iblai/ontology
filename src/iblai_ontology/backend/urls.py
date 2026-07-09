"""URL routing for the backend.

The MCP outbound gateway is mounted at the exact path ``/mcp`` (JSON-RPC for
agents); the identity middleware authenticates every request before the view
scopes results to the caller's role. The console REST API (DRF) is mounted at
the site root — its ``mcp/status`` etc. routes never collide with the exact
``mcp`` gateway route above.
"""

from __future__ import annotations

from django.urls import include, path

from iblai_ontology.backend.mcp_server.server import mcp_view

urlpatterns = [
    path("mcp", mcp_view, name="mcp"),
    path("", include("iblai_ontology.backend.api.urls")),
]
