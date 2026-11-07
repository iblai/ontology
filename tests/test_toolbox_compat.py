"""Tests for Google MCP Toolbox schema compliance."""

from __future__ import annotations

from pathlib import Path

from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_repo_tools_yaml_is_compliant():
    report = validate_tools_yaml(REPO_ROOT / "config" / "tools.yaml")
    assert report.ok, [i.message for i in report.issues if i.severity == "error"]
    assert report.sources >= 2
    assert report.tools >= 5
    assert report.toolsets >= 2


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


def test_validate_reports_parse_error_and_non_mapping(tmp_path):
    bad = tmp_path / "tools.yaml"
    bad.write_text("kind: [\n")
    report = validate_tools_yaml(bad)
    assert not report.ok
    assert "YAML parse error" in report.issues[0].message

    bad.write_text("- just\n- a list\n")
    report = validate_tools_yaml(bad)
    assert not report.ok and "not a mapping" in report.issues[0].message


def test_save_tools_yaml_atomic_and_rejects_literal_secret(tmp_path):
    from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml

    path = tmp_path / "tools.yaml"
    good = (
        "# keep me\n"
        "kind: source\nname: s\ntype: postgres\npassword: ${DB_PASSWORD}\n"
        "---\nkind: tool\nname: t\ntype: postgres-sql\nsource: s\nstatement: SELECT 1\n"
    )
    assert save_tools_yaml(good, path).ok
    assert path.read_text() == good  # comments kept, written atomically

    literal = good.replace("${DB_PASSWORD}", "hunter2")
    report = save_tools_yaml(literal, path)
    assert not report.ok and "literal 'password'" in report.issues[-1].message
    assert path.read_text() == good  # untouched

    assert not save_tools_yaml("kind: [\n", path).ok
    assert not save_tools_yaml("   \n", path).ok
    assert path.read_text() == good
    assert not list(tmp_path.glob(".*.tmp"))
