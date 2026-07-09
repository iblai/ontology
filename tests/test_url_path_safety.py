"""Canvas / Navigate MCP server URL-path safety tests (no network, no env).

Both servers live under ``mcp-servers/`` (hyphenated, non-importable) and are
loaded by file path. Module import must stay side-effect free — env vars are
read lazily at request time.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("mcp")
pytest.importorskip("httpx")


def _load(server_dir: str, mod_name: str):
    path = (
        Path(__file__).resolve().parents[1] / "mcp-servers" / server_dir / "server.py"
    )
    spec = importlib.util.spec_from_file_location(mod_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


canvas = _load("canvas", "canvas_server_undertest")
navigate = _load("navigate", "navigate_server_undertest")


# --- Canvas _user_ref_path -------------------------------------------------
def test_canvas_numeric_id_passthrough():
    assert canvas._user_ref_path("116") == "116"
    assert canvas._user_ref_path("  116  ") == "116"


def test_canvas_sis_refs_encoded():
    assert canvas._user_ref_path("sis_user_id:001234567") == "sis_user_id:001234567"
    # The email id is URL-encoded (@ -> %40); the prefix and its colon are kept.
    assert (
        canvas._user_ref_path("sis_login_id:jane@x.edu") == "sis_login_id:jane%40x.edu"
    )


@pytest.mark.parametrize(
    "payload",
    [
        "116/../../accounts/1",  # extra path segments
        "sis_user_id:1/../x",  # traversal inside the id
        "1?role=admin",  # query injection
        "sis_login_id:a b",  # whitespace
        "not-a-ref",  # unqualified non-numeric
        "",  # empty
    ],
)
def test_canvas_rejects_injection(payload):
    with pytest.raises(ValueError):
        canvas._user_ref_path(payload)


# --- Navigate _safe_segment ------------------------------------------------
def test_navigate_valid_ids_pass():
    assert navigate._safe_segment("001234567") == "001234567"
    assert navigate._safe_segment("abc-123_x") == "abc-123_x"


@pytest.mark.parametrize(
    "payload",
    ["1/../risk", "1?x=1", "a b", "..", "seg/ment", "has#frag", ""],
)
def test_navigate_rejects_injection(payload):
    with pytest.raises(ValueError):
        navigate._safe_segment(payload)
