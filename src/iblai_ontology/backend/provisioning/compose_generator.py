"""Docker Compose update generation (Component 6.5).

For API-based services, provisioning may add a custom MCP server container. This
generator produces the compose service fragment idempotently; DB services reuse
the shared MCP Toolbox and need no compose change.
"""

from __future__ import annotations


def mcp_service_fragment(
    service_name: str, *, build_context: str | None = None
) -> dict:
    """Return a docker-compose service definition for a custom MCP server."""
    return {
        f"mcp-{service_name}": {
            "build": build_context or f"./mcp-servers/{service_name}",
            "env_file": f".env.{service_name}",
            "networks": ["ontology-internal"],
            "restart": "unless-stopped",
        }
    }


def needs_compose_update(service_type: str) -> bool:
    """Database services use the shared MCP Toolbox; API services need a container."""
    return service_type == "api"
