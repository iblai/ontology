"""Tests for Google MCP Toolbox schema compliance."""

from __future__ import annotations

from pathlib import Path

from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_repo_tools_yaml_is_compliant():
    report = validate_tools_yaml(REPO_ROOT / "config" / "tools.yaml")
    assert report.ok, [i.message for i in report.issues if i.severity == "error"]
    assert report.sources >= 2
    assert report.tools >= 10
    assert report.toolsets >= 4


def test_missing_file_errors():
    report = validate_tools_yaml(REPO_ROOT / "config" / "nope.yaml")
    assert not report.ok


def test_detects_undefined_source_and_tool(tmp_path):
    (tmp_path / "tools.yaml").write_text(
        "kind: tool\n"
        "name: bad-tool\n"
        "type: postgres-sql\n"
        "source: ghost-source\n"
        "statement: SELECT 1\n"
        "---\n"
        "kind: toolset\n"
        "name: ts\n"
        "tools:\n"
        "  - missing-tool\n"
    )
    report = validate_tools_yaml(tmp_path / "tools.yaml")
    assert not report.ok
    msgs = " ".join(i.message for i in report.issues)
    assert "ghost-source" in msgs
    assert "missing-tool" in msgs


def test_unknown_type_is_warning_not_error(tmp_path):
    (tmp_path / "tools.yaml").write_text(
        "kind: source\nname: s\ntype: postgres\n"
        "---\n"
        "kind: tool\nname: t\ntype: weird-sql\nsource: s\nstatement: SELECT 1\n"
    )
    report = validate_tools_yaml(tmp_path / "tools.yaml")
    assert report.ok  # unknown type is a warning, not a hard error
    assert any(i.severity == "warning" for i in report.issues)
