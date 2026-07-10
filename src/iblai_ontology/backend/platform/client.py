"""ibl.ai platform client (Component 4).

Registers iblai-ontology as an MCP Server in the ibl.ai platform and manages the
MCP Server Connections that carry per-user/agent/platform credentials. Mirrors
the platform's MCPServer / MCPServerConnection / ConnectedService data model and
its admin endpoints under base.manager.iblai.app.

Role assignment (Option A) is expressed as the ``X-Iblai-Role`` value in a
connection's ``extra_headers``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

import httpx

DEFAULT_BASE = "https://base.manager.iblai.app"


@dataclass
class PlatformConfig:
    base_url: str
    org: str
    admin_token: str

    @classmethod
    def from_env(cls) -> "PlatformConfig":
        org = os.environ.get("IBLAI_ORG")
        token = os.environ.get("IBLAI_ADMIN_TOKEN")
        if not org or not token:
            raise RuntimeError(
                "IBLAI_ORG and IBLAI_ADMIN_TOKEN must be set to talk to the ibl.ai platform."
            )
        return cls(
            base_url=os.environ.get("IBLAI_BASE_URL", DEFAULT_BASE),
            org=org,
            admin_token=token,
        )


class PlatformClient:
    """Thin REST client for the ibl.ai platform's MCP admin API."""

    def __init__(
        self,
        config: Optional[PlatformConfig] = None,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self.config = config or PlatformConfig.from_env()
        self._client = client or httpx.Client(timeout=30)

    def _url(self, path: str) -> str:
        return f"{self.config.base_url}/api/ai-agent/orgs/{self.config.org}/users/admin/{path}"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Token {self.config.admin_token}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.post(self._url(path), json=payload, headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    def _patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.patch(
            self._url(path), json=payload, headers=self._headers()
        )
        resp.raise_for_status()
        return resp.json()

    # -- MCP Server ------------------------------------------------------
    def register_mcp_server(
        self,
        *,
        name: str,
        url: str,
        description: str = "",
        transport: str = "streamable_http",
        auth_type: str = "oauth2",
        auth_scope: str = "user",
        is_enabled: bool = True,
    ) -> dict[str, Any]:
        """Register iblai-ontology as an MCP Server; returns the created record."""
        return self._post(
            "mcp-servers/",
            {
                "name": name,
                "description": description,
                "url": url,
                "transport": transport,
                "auth_type": auth_type,
                "auth_scope": auth_scope,
                "is_enabled": is_enabled,
            },
        )

    # -- MCP Server Connection ------------------------------------------
    def create_connection(
        self,
        *,
        server: int,
        scope: str,  # "user" | "agent" | "platform"
        role: Optional[str] = None,
        user: Optional[str] = None,
        agent: Optional[str] = None,
        auth_type: str = "oauth2",
        connected_service: Optional[int] = None,
        credentials: Optional[str] = None,
        authorization_scheme: str = "Bearer",
    ) -> dict[str, Any]:
        """Create an MCP Server Connection, embedding the role via extra_headers."""
        payload: dict[str, Any] = {
            "server": server,
            "scope": scope,
            "auth_type": auth_type,
        }
        if role:
            payload["extra_headers"] = {"X-Iblai-Role": role}
        if user:
            payload["user"] = user
        if agent:
            payload["agent"] = agent
        if connected_service is not None:
            payload["connected_service"] = connected_service
        if credentials is not None:
            payload["credentials"] = credentials
            payload["authorization_scheme"] = authorization_scheme
        return self._post("mcp-server-connections/", payload)

    # -- Attach to agent -------------------------------------------------
    def attach_to_agent(self, *, agent_id: str, server_id: int) -> dict[str, Any]:
        """Enable the MCP tool on an agent and attach the ontology server."""
        return self._patch(
            f"agents/{agent_id}/settings/",
            {"tools": ["mcp-tool"], "mcp_servers": [server_id]},
        )
