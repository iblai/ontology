"""URL routing for the backend.

The MCP outbound gateway is mounted at ``/mcp``; the identity middleware
authenticates every request before the view scopes results to the caller's role.
"""

from __future__ import annotations

from django.urls import path

from iblai_ontology.backend.mcp_server.server import mcp_view

urlpatterns = [
    path("mcp", mcp_view, name="mcp"),
]
