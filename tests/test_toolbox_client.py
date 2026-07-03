"""Tests for the shared MCP Toolbox /mcp client."""

from __future__ import annotations

import json

import pytest

from iblai_ontology.backend.mcp_server import toolbox_client
from iblai_ontology.backend.mcp_server.toolbox_client import ToolboxError, call_tool


class _Resp:
    def __init__(self, text, content_type="application/json"):
        self.text = text
        self.headers = {"content-type": content_type}

    def raise_for_status(self):
        pass


def _rpc(result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": 1}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    return json.dumps(msg)


def test_call_tool_unwraps_json_rows(monkeypatch):
    body = _rpc(result={"content": [{"type": "text", "text": json.dumps({"a": 1})}]})
    monkeypatch.setattr(toolbox_client.httpx, "post", lambda *a, **k: _Resp(body))
    assert call_tool("http://tb:5000", "t", {"x": 1}) == [{"a": 1}]


def test_call_tool_parses_sse(monkeypatch):
    body = (
        "event: message\ndata: "
        + _rpc(result={"content": [{"type": "text", "text": json.dumps({"a": 2})}]})
        + "\n"
    )
    monkeypatch.setattr(
        toolbox_client.httpx, "post", lambda *a, **k: _Resp(body, "text/event-stream")
    )
    assert call_tool("http://tb:5000", "t") == [{"a": 2}]


def test_call_tool_raises_on_jsonrpc_error(monkeypatch):
    body = _rpc(error={"code": -32000, "message": "boom"})
    monkeypatch.setattr(toolbox_client.httpx, "post", lambda *a, **k: _Resp(body))
    with pytest.raises(ToolboxError, match="boom"):
        call_tool("http://tb:5000", "t")


def test_call_tool_wraps_transport_error(monkeypatch):
    import httpx

    def boom(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(toolbox_client.httpx, "post", boom)
    with pytest.raises(ToolboxError, match="toolbox request failed"):
        call_tool("http://tb:5000", "t")
