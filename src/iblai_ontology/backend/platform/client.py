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
    # "Api-Token" for a platform API key; a DM "Token" expires (knox, 14 days by default).
    auth_scheme: str = "Token"

    @classmethod
    def from_env(cls) -> "PlatformConfig":
        org = os.environ.get("IBLAI_ORG")
        token = os.environ.get("IBLAI_ADMIN_TOKEN")
        if not org or not token:
            raise RuntimeError(
                "IBLAI_ORG and IBLAI_ADMIN_TOKEN must be set to talk to the ibl.ai platform."
            )
        scheme = os.environ.get("IBLAI_AUTH_SCHEME") or "Token"
        if scheme not in ("Token", "Api-Token"):
            raise RuntimeError(
                f"IBLAI_AUTH_SCHEME must be Token or Api-Token, not {scheme!r}."
            )
        return cls(
            # Compose passes unset variables as empty strings.
            base_url=(os.environ.get("IBLAI_BASE_URL") or DEFAULT_BASE).rstrip("/"),
            org=org,
            admin_token=token,
            auth_scheme=scheme,
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
            "Authorization": f"{self.config.auth_scheme} {self.config.admin_token}",
            "Content-Type": "application/json",
        }

    def _call(
        self, method: str, path: str, *, ok: tuple[int, ...] = (), **kw
    ) -> httpx.Response:
        """Raises with the DM's own message on any 4xx/5xx not listed in ``ok``."""
        headers = {**self._headers(), **kw.pop("headers", {})}
        resp = self._client.request(
            method, f"{self.config.base_url}/{path}", headers=headers, **kw
        )
        if resp.is_error and resp.status_code not in ok:
            raise RuntimeError(
                f"DM {method} {path}: HTTP {resp.status_code} {resp.text[:500]}"
            )
        return resp

    def records(
        self, method: str, kind: str, key: str | None = None, **kw
    ) -> httpx.Response:
        """An ontology-records call: ``v1/ontology/kinds/<kind>/records[/<key>]``.

        ``iblai-org`` only confirms the credential's own platform: another's is a 403.
        """
        path = f"v1/ontology/kinds/{kind}/records" + (f"/{key}" if key else "")
        return self._call(method, path, headers={"iblai-org": self.config.org}, **kw)

    def core(self, method: str, path: str, **kw) -> httpx.Response:
        """A core call, ``api/core/<path>``: the RBAC roles that carry the ontology's."""
        return self._call(method, f"api/core/{path}", **kw)

    def _request(self, method: str, path: str, payload=None) -> dict[str, Any]:
        resp = self._client.request(
            method, self._url(path), json=payload, headers=self._headers()
        )
        if resp.is_error:
            # The DM's own words, which say whether the token, the scheme or the role failed.
            raise RuntimeError(
                f"DM {method} {path}: HTTP {resp.status_code} {resp.text[:500]}"
            )
        return resp.json()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", path, payload)

    # -- MCP Server ------------------------------------------------------
    def register_mcp_server(
        self,
        *,
        name: str,
        url: str,
        description: str = "",
        transport: str = "streamable_http",
        auth_type: str = "oauth2",  # none | token | oauth2
        auth_scope: str = "platform",  # platform | mentor | user
        is_enabled: bool = True,
        credentials: Optional[str] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """Register iblai-ontology as an MCP Server; returns the created record.

        ``credentials`` is the whole authorization value (``Bearer <token>``) the DM
        sends verbatim; ``extra_headers`` ride along on every call (``X-Iblai-Role``).
        """
        payload: dict[str, Any] = {
            "name": name,
            "description": description,
            "url": url,
            "transport": transport,
            "auth_type": auth_type,
            "auth_scope": auth_scope,
            "is_enabled": is_enabled,
        }
        if credentials:
            payload["credentials"] = credentials
        if extra_headers:
            payload["extra_headers"] = extra_headers
        return self._post("mcp-servers/", payload)

    # -- MCP Server Connection ------------------------------------------
    def create_connection(
        self,
        *,
        server: int,
        scope: str,  # "user" | "mentor" | "platform"
        role: Optional[str] = None,
        user: Optional[str] = None,
        mentor: Optional[str] = None,
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
        if mentor:
            payload["mentor"] = mentor
        if connected_service is not None:
            payload["connected_service"] = connected_service
        if credentials is not None:
            payload["credentials"] = credentials
            payload["authorization_scheme"] = authorization_scheme
        return self._post("mcp-server-connections/", payload)

    # -- Attach to agent -------------------------------------------------
    def attach_to_agent(self, *, agent_id: str, server_id: int) -> dict[str, Any]:
        """Enable the MCP tool on an agent and attach the server, keeping its other tools."""
        path = f"mentors/{agent_id}/settings/"
        current = self._request("GET", path)
        slugs = {
            t["slug"] if isinstance(t, dict) else str(t)
            for t in (current.get("tool_slugs") or current.get("tools") or [])
        }
        servers = {
            s["id"] if isinstance(s, dict) else int(s)
            for s in current.get("mcp_servers") or []
        }
        return self._request(
            "PUT",
            path,
            {
                "tool_slugs": sorted(slugs | {"mcp"}),
                "can_use_tools": True,
                "mcp_servers": sorted(servers | {server_id}),
            },
        )
