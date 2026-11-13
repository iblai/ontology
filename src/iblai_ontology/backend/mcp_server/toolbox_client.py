"""Client for calling tools on the inbound Google MCP Toolbox.

Toolbox 1.5+ disables the legacy ``/api/tool/<name>`` REST endpoints by default
and serves tools over the standard MCP ``/mcp`` JSON-RPC channel. Both the
exposure gateway (``mcp_server.handlers``) and the sync engine
(``sync.engine``) call tools through this single client so the two paths cannot
drift apart.
"""

from __future__ import annotations

import json
import time
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
    """Unwrap an MCP ``tools/call`` result's text content into JSON rows.

    The Toolbox sends one text item per row; the custom MCP servers one item
    holding a JSON array per call. Both come back as a flat list of rows.
    """
    rows: list[Any] = []
    for item in result.get("content", []):
        text = item.get("text") if isinstance(item, dict) else None
        if text is None:
            continue
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            rows.append(text)
            continue
        rows.extend(value) if isinstance(value, list) else rows.append(value)
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
    result = message.get("result", {})
    if result.get("isError"):
        # A tool failure travels as content with isError (Toolbox and FastMCP alike).
        raise ToolboxError(" ".join(str(r) for r in _rows_from_result(result)))
    return _rows_from_result(result)


def loaded(toolbox_url: str, mark: str, *, wait: float = 5.0) -> str | None:
    """Why the Toolbox does not serve the file named ``mark`` yet, or None once it does.

    A written file holds an empty toolset of that name (``write_toolbox_config``); the
    Toolbox answers for it only after loading that file, and keeps the file before when
    it refuses the new one. Raises ``ToolboxError`` when the Toolbox does not answer.
    """
    deadline = time.monotonic() + wait
    while True:
        try:
            resp = httpx.post(
                f"{toolbox_url.rstrip('/')}/mcp/{mark}",
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                headers={"Accept": "application/json, text/event-stream"},
                timeout=3.0,
            )
        except httpx.HTTPError as exc:
            raise ToolboxError(f"the MCP Toolbox does not answer ({exc})") from exc
        try:
            message = _parse_message(resp)
        except ToolboxError:
            message = None  # no JSON-RPC answer: not that toolset's
        if isinstance(message, dict) and "result" in message:
            return None
        if time.monotonic() >= deadline:
            return "the MCP Toolbox did not take it (its own log says why)"
        time.sleep(0.25)
