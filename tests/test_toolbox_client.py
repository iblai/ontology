"""Tests for the shared MCP Toolbox /mcp client."""

from __future__ import annotations

import json

import pytest

from iblai_ontology.backend.mcp_server import toolbox_client
from iblai_ontology.backend.mcp_server.toolbox_client import (
    ToolboxError,
    call_tool,
    loaded,
)


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


def test_loaded_asks_for_the_files_own_toolset_until_the_toolbox_serves_it(monkeypatch):
    asked = []
    answers = [
        _rpc(error={"code": -32600, "message": "toolset does not exist"}),
        "not json",
        _rpc(result={"tools": []}),
    ]

    def post(url, **kwargs):
        asked.append((url, kwargs["json"]["method"]))
        return _Resp(answers[min(len(asked), len(answers)) - 1])

    monkeypatch.setattr(toolbox_client.httpx, "post", post)
    monkeypatch.setattr(toolbox_client.time, "sleep", lambda seconds: None)
    assert loaded("http://tb:5000/", "loaded-abc") is None
    assert asked == [("http://tb:5000/mcp/loaded-abc", "tools/list")] * 3


def test_loaded_says_when_the_toolbox_kept_its_old_file_and_raises_when_it_is_silent(
    monkeypatch,
):
    import httpx

    refused = _rpc(error={"code": -32600, "message": "toolset does not exist"})
    monkeypatch.setattr(toolbox_client.httpx, "post", lambda *a, **k: _Resp(refused))
    monkeypatch.setattr(toolbox_client.time, "sleep", lambda seconds: None)
    assert "did not take it" in loaded("http://tb:5000", "loaded-abc", wait=0)

    def silent(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(toolbox_client.httpx, "post", silent)
    with pytest.raises(ToolboxError, match="does not answer"):
        loaded("http://tb:5000", "loaded-abc")
