"""URL routing for the backend.

The MCP outbound gateway and admin/health endpoints are mounted here. The MCP
handlers themselves live in :mod:`iblai_ontology.backend.mcp_server` and are
wired in Component 4.
"""

from __future__ import annotations

urlpatterns: list = []
