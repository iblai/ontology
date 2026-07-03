"""Client for calling tools on the inbound Google MCP Toolbox.

Toolbox 1.5+ disables the legacy ``/api/tool/<name>`` REST endpoints by default
and serves tools over the standard MCP ``/mcp`` JSON-RPC channel. Both the
exposure gateway (``mcp_server.handlers``) and the sync engine
(``sync.engine``) call tools through this single client so the two paths cannot
drift apart.
"""

from __future__ import annotations

import json
from typing import Any

import httpx


class ToolboxError(RuntimeError):
    """A tool call to the MCP Toolbox failed (transport or JSON-RPC error)."""


def _parse_message(resp: httpx.Response) -> dict[str, Any]:
    """Return the JSON-RPC message from a /mcp response (JSON or SSE)."""
    body = resp.text
    if "text/event-stream" in resp.headers.get("content-type", ""):
        # SSE: take the JSON from the last non-empty ``data:`` line.
        data_lines = [
            ln[5:].strip() for ln in body.splitlines() if ln.startswith("data:")
        ]
        body = data_lines[-1] if data_lines else "{}"
    try:
        return json.loads(body)
    except ValueError as exc:
        raise ToolboxError(f"invalid toolbox response: {exc}") from exc


def _rows_from_result(result: dict[str, Any]) -> list[Any]:
    """Unwrap an MCP ``tools/call`` result's text content into JSON rows."""
    rows: list[Any] = []
    for item in result.get("content", []):
        text = item.get("text") if isinstance(item, dict) else None
        if text is None:
            continue
        try:
            rows.append(json.loads(text))
        except (ValueError, TypeError):
            rows.append(text)
    return rows


def call_tool(
    toolbox_url: str,
    name: str,
    arguments: dict[str, Any] | None = None,
    *,
    timeout: float = 30.0,
) -> list[Any]:
    """Invoke a Toolbox tool over /mcp JSON-RPC and return its rows.

    Raises ``ToolboxError`` on a transport failure or a JSON-RPC error.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments or {}},
    }
    try:
        resp = httpx.post(
            f"{toolbox_url.rstrip('/')}/mcp",
            json=payload,
            headers={"Accept": "application/json, text/event-stream"},
            timeout=timeout,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise ToolboxError(f"toolbox request failed: {exc}") from exc

    message = _parse_message(resp)
    if message.get("error"):
        raise ToolboxError(message["error"].get("message", "toolbox error"))
    return _rows_from_result(message.get("result", {}))
