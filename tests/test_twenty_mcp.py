"""The Twenty MCP server's tools and flattening rule (needs the mcp SDK the server imports)."""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("mcp.server.fastmcp")


def _server():
    path = Path(__file__).resolve().parents[1] / "mcp-servers" / "twenty" / "server.py"
    spec = importlib.util.spec_from_file_location("twenty_server", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_flatten_expands_composites_only():
    server = _server()
    row = {
        "id": "1",
        "name": {"firstName": "Tim", "lastName": "Cook"},
        "emails": {"primaryEmail": "t@a.dev", "additionalEmails": []},
        "createdBy": {"source": "MANUAL", "context": {}},
        "avatarFile": {"x": 1},
        "companyId": "c1",
    }
    assert server.flatten(row, {"name", "emails", "createdBy"}) == {
        "id": "1",
        "nameFirstName": "Tim",
        "nameLastName": "Cook",
        "emailsPrimaryEmail": "t@a.dev",
        "emailsAdditionalEmails": [],
        "createdBySource": "MANUAL",
        "createdByContext": {},
        "avatarFile": {"x": 1},
        "companyId": "c1",
    }


def test_every_synced_object_has_a_list_tool():
    server = _server()
    tools = asyncio.run(server.server.list_tools())
    assert {t.name for t in tools} == {f"list-{p}" for p in server.OBJECTS}
