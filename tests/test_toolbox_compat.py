"""Tests for Google MCP Toolbox schema compliance."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from iblai_ontology.backend.mcp_server.toolbox_compat import (
    validate_tools_yaml,
    writing_tools,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _sql(name, statement, source="ro", **extra):
    return {
        "kind": "tool",
        "name": name,
        "type": "postgres-sql",
        "source": source,
        "statement": statement,
        **extra,
    }


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT id FROM students WHERE id = $1",
        "  (SELECT a FROM t) UNION (SELECT b FROM u);",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "SHOW TABLES",
        "DESCRIBE students",
        "TABLE students",
        "VALUES (1), (2)",
        # A write word inside a longer name is not the word.
        "SELECT updated_at, is_deleted, created_by, grant_id FROM t",
    ],
)
def test_a_fixed_statement_that_only_reads_is_not_a_write(statement):
    assert writing_tools([_sql("t", statement)]) == {}


@pytest.mark.parametrize(
    ("statement", "why"),
    [
        ("UPDATE holds SET released = true WHERE id = $1", "does not start with"),
        ("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "holds DELETE"),
        ("SELECT * INTO backup FROM t", "holds INTO"),
        ("EXPLAIN ANALYZE DELETE FROM t", "does not start with"),
        ("SELECT 1; DROP TABLE t", "holds a ';'"),
        # T-SQL runs two statements without a semicolon between them.
        ("SELECT 1 DROP TABLE t", "holds DROP"),
        ("SELECT * FROM t FOR UPDATE", "holds UPDATE"),
        # A text scan, not a parser: the word counts inside a string too.
        ("SELECT * FROM aid WHERE kind = 'grant'", "holds GRANT"),
        ("", "no statement of its own"),
        (None, "no statement of its own"),
    ],
)
def test_a_statement_not_known_to_read_is_a_write(statement, why):
    assert why in writing_tools([_sql("t", statement)])["t"]


def test_what_else_counts_as_a_write():
    docs = [
        _sql("free-sql", "SELECT 1", type="postgres-execute-sql"),
        _sql("no-type", "SELECT 1", type=""),
        _sql(
            "any-table",
            "SELECT * FROM {{.table}}",
            templateParameters=[{"name": "table", "type": "string"}],
        ),
        {"kind": "tool", "name": "get", "type": "http", "method": "get", "path": "/"},
        {"kind": "tool", "name": "head", "type": "http", "method": "HEAD", "path": "/"},
        {"kind": "tool", "name": "post", "type": "http", "method": "POST", "path": "/"},
        {"kind": "tool", "name": "no-method", "type": "http", "path": "/"},
    ]
    why = writing_tools(docs)
    assert set(why) == {"free-sql", "no-type", "any-table", "post", "no-method"}
    assert "postgres-execute-sql" in why["free-sql"]
    assert "templateParameters" in why["any-table"]
    assert why["post"] == "its method is POST"
    assert why["no-method"] == "its method is not given"


def test_a_source_one_tool_writes_through_makes_its_other_tools_writes():
    docs = [
        _sql("read", "SELECT 1"),
        _sql("release-hold", "UPDATE holds SET released = true", source="rw"),
        _sql("looks-like-a-read", "SELECT 1", source="rw"),
        # The gateway runs its own read-only code for this one, whatever its source.
        _sql("query-ontology-cache", "${sql}", source="rw"),
        # A gateway name on a real statement is a Toolbox tool like any other.
        _sql("get-sync-status", "DELETE FROM sync_runs", source="other"),
    ]
    why = writing_tools(docs)
    assert set(why) == {"release-hold", "looks-like-a-read", "get-sync-status"}
    assert why["looks-like-a-read"] == "it shares the source 'rw' with 'release-hold'"


def test_an_api_systems_operations_are_writes_the_gateway_runs_itself(tmp_path):
    from iblai_ontology.backend.discovery.config_generator import api_tools_yaml
    from iblai_ontology.catalog import get_entry

    entry = get_entry("twenty")
    text = api_tools_yaml("crm", entry.display_name, entry)
    docs = list(yaml.safe_load_all(text))
    tools = [d for d in docs if d["kind"] == "tool"]
    assert len(tools) == 10 and {d["type"] for d in tools} == {"twenty"}
    assert docs[-1] == {
        "kind": "toolset",
        "name": "crm-writes",
        "write": True,
        "tools": [d["name"] for d in tools],
    }
    update = next(d for d in tools if d["name"] == "crm-update-opportunity")
    assert (update["service"], update["object"]) == ("crm", "opportunities")
    assert update["parameters"][0]["name"] == "id"
    assert "required" not in update["parameters"][0]  # required, as a parameter is
    assert all(p["required"] is False for p in update["parameters"][1:])
    # Each is a write by its type, whatever it holds: only a toolset marked so lends it.
    why = writing_tools(docs)
    assert set(why) == {d["name"] for d in tools}
    assert why["crm-create-person"] == "it changes records in crm"

    path = tmp_path / "tools.yaml"
    path.write_text(text)
    assert validate_tools_yaml(
        path
    ).ok  # no Toolbox source or statement is asked of them
    path.write_text(text.replace("write: true\n", ""))
    assert not validate_tools_yaml(path).ok
    # What the gateway needs to run one is.
    lacking = {k: v for k, v in tools[1].items() if k != "service"}
    path.write_text(yaml.dump_all([{**tools[0], "operation": "delete"}, lacking]))
    said = " ".join(i.message for i in validate_tools_yaml(path).issues)
    assert "no operation: create or update" in said and "missing 'service'" in said
    # An entry with nothing to change gets no tools at all.
    assert api_tools_yaml("lms", "Canvas", get_entry("canvas")) == ""


def test_no_stock_tool_writes():
    for name in ("tools.yaml", "tools.higher-ed.example.yaml"):
        path = REPO_ROOT / "config" / name
        docs = [d for d in yaml.safe_load_all(path.read_text()) if d]
        assert writing_tools(docs) == {}, name


WRITES = (
    "kind: source\nname: ro\ntype: postgres\npassword: ${RO}\n"
    "---\nkind: source\nname: rw\ntype: postgres\npassword: ${RW}\n"
    "---\nkind: tool\nname: read\ntype: postgres-sql\nsource: ro\nstatement: SELECT 1\n"
    "---\nkind: tool\nname: release-hold\ntype: postgres-sql\nsource: rw\n"
    "statement: UPDATE holds SET released = true WHERE id = $1\n"
    "---\nkind: toolset\nname: registrar\n%s"
    "tools:\n  - read\n  - release-hold\n"
)


def test_a_tool_that_writes_needs_a_toolset_marked_as_writing(tmp_path):
    path = tmp_path / "tools.yaml"
    path.write_text(WRITES % "")
    report = validate_tools_yaml(path)
    errors = [i.message for i in report.issues if i.severity == "error"]
    assert len(errors) == 1
    assert "toolset 'registrar' holds 'release-hold'" in errors[0]
    assert "write: true" in errors[0] and "does not start with" in errors[0]

    path.write_text(WRITES % "write: true\n")
    assert validate_tools_yaml(path).ok

    # `write` is true or false, not a word that happens to be truthy.
    path.write_text(WRITES % "write: 'yes'\n")
    messages = " ".join(i.message for i in validate_tools_yaml(path).issues)
    assert "not true or false" in messages and "holds 'release-hold'" in messages


def test_validate_refuses_two_documents_of_one_name_and_a_bare_http_tool(tmp_path):
    path = tmp_path / "tools.yaml"
    path.write_text(
        "kind: source\nname: api\ntype: http\nbaseUrl: https://crm.example\n"
        "---\nkind: tool\nname: people\ntype: http\nsource: api\nmethod: GET\npath: /people\n"
        "---\nkind: tool\nname: bare\ntype: http\nsource: api\n"
        "---\nkind: toolset\nname: crm\ntools: [people]\n"
        "---\nkind: toolset\nname: crm\nwrite: true\ntools: [people]\n"
    )
    report = validate_tools_yaml(path)
    messages = [i.message for i in report.issues if i.severity == "error"]
    assert "two toolsets are named 'crm'" in messages
    assert "http tool 'bare' missing 'method'" in messages
    assert "http tool 'bare' missing 'path'" in messages
    # An http source is one the Toolbox knows: no warning for its type.
    assert not [i for i in report.issues if i.severity == "warning"]


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


def test_save_refuses_a_literal_secret_at_any_depth_of_a_source_or_a_tool(tmp_path):
    from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml

    path = tmp_path / "tools.yaml"
    good = (
        "kind: source\nname: api\ntype: http\nbaseUrl: https://crm.example\n"
        "headers:\n  Authorization: Bearer ${CRM_TOKEN}\n  Accept: application/json\n"
        "queryParams:\n  api_key: ${CRM_KEY}\n"
        "---\nkind: tool\nname: people\ntype: http\nsource: api\nmethod: GET\npath: /people\n"
        "headers:\n  X-Api-Key: ${CRM_KEY}\n"
        "queryParams:\n  - name: token\n    type: string\n"
    )
    # A scheme word before the reference is how a header is written; a parameter named
    # like a secret is a name, not a value.
    assert save_tools_yaml(good, path).ok

    def refused(text):
        report = save_tools_yaml(text, path)
        assert not report.ok and path.read_text() == good
        return report.issues[-1].message

    literal = good.replace("Bearer ${CRM_TOKEN}", "Bearer abc123")
    assert refused(literal) == (
        "source 'api' has a literal 'headers.Authorization'; use a ${VAR} reference"
    )
    assert "queryParams.api_key" in refused(good.replace("${CRM_KEY}\n---", "k\n---"))
    in_tool = good.replace("X-Api-Key: ${CRM_KEY}", "Cookie: session=abc")
    assert refused(in_tool) == (
        "tool 'people' has a literal 'headers.Cookie'; use a ${VAR} reference"
    )
    # A number is a literal too.
    assert "'password'" in refused(
        good + "---\nkind: source\nname: db\ntype: postgres\npassword: 12345\n"
    )
