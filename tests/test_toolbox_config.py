"""Tests for the DSL -> Google MCP Toolbox native config generator."""

from __future__ import annotations

import textwrap

import yaml

from iblai_ontology.backend.mcp_server.toolbox_config import (
    build_toolbox_config,
    write_toolbox_config,
)

DSL = textwrap.dedent(
    """
    kind: source
    name: client-postgres
    type: postgres
    host: ${CLIENT_DB_HOST}
    port: ${CLIENT_DB_PORT}
    database: ${CLIENT_DB_NAME}
    user: ${CLIENT_DB_RO_USER}
    password: ${CLIENT_DB_RO_PASSWORD}
    ---
    kind: source
    name: legacy-oracle
    type: oracle
    host: ${ORA_HOST}
    port: 1521
    database: ORCLPDB
    user: ro
    password: ${ORA_PW}
    ---
    kind: tool
    name: list-tables
    type: postgres-sql
    source: client-postgres
    description: List tables
    parameters:
      - name: schema
        type: string
        description: Schema
    statement: SELECT relname FROM pg_stat_user_tables WHERE schemaname = $1
    ---
    kind: tool
    name: raw-query
    type: postgres-sql
    source: client-postgres
    description: Arbitrary SQL passthrough (gateway-native)
    parameters:
      - name: sql
        type: string
        description: SQL
    statement: ${sql}
    ---
    kind: toolset
    name: client-db-tools
    tools:
      - list-tables
      - raw-query
    """
).strip()


def _write(tmp_path):
    p = tmp_path / "tools.yaml"
    p.write_text(DSL)
    return p


def test_sources_use_kind_not_type_and_drop_meta(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    src = result.config["sources"]["client-postgres"]
    assert src["kind"] == "postgres"
    assert "type" not in src and "name" not in src
    # ${VAR} tokens are preserved (not expanded) so secrets stay out of the file.
    assert src["host"] == "${CLIENT_DB_HOST}"


def test_oracle_database_is_renamed_to_service_name(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    ora = result.config["sources"]["legacy-oracle"]
    assert ora["kind"] == "oracle"
    assert "database" not in ora
    assert ora["serviceName"] == "ORCLPDB"


def test_injection_tool_is_native_and_excluded(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    assert "raw-query" in result.native_tools
    assert "raw-query" not in result.config["tools"]
    assert "list-tables" in result.config["tools"]


def test_toolset_drops_native_tools(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    assert result.config["toolsets"]["client-db-tools"] == ["list-tables"]


def test_tools_are_a_map_keyed_by_name(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    tool = result.config["tools"]["list-tables"]
    assert tool["kind"] == "postgres-sql"
    assert tool["source"] == "client-postgres"
    assert isinstance(result.config["tools"], dict)


def test_write_emits_loadable_yaml_without_injection_comment(tmp_path):
    dest = tmp_path / "generated" / "toolbox.yaml"
    write_toolbox_config(_write(tmp_path), dest)
    text = dest.read_text()
    # The Toolbox expands ${..} over the whole file incl. comments; none allowed there.
    for line in text.splitlines():
        if line.startswith("#"):
            assert "${" not in line
    loaded = yaml.safe_load(text)
    assert set(loaded) == {"sources", "tools", "toolsets"}
