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
    kind: tool
    name: count-legacy
    type: oracle-sql
    source: legacy-oracle
    description: Count legacy rows
    statement: SELECT COUNT(*) FROM students
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


def test_an_api_systems_operations_are_left_out_of_the_toolbox(tmp_path):
    path = tmp_path / "tools.yaml"
    path.write_text(
        DSL + "\n---\nkind: tool\nname: crm-create-person\ntype: twenty\nservice: crm\n"
        "object: people\noperation: create\n"
        "---\nkind: toolset\nname: crm-writes\nwrite: true\ntools:\n  - crm-create-person\n"
        "---\nkind: toolset\nname: mixed\nwrite: true\n"
        "tools:\n  - list-tables\n  - crm-create-person\n"
        "---\nkind: toolset\nname: none-yet\ntools: []\n"
    )
    result = build_toolbox_config(path)
    # The gateway runs them on the system itself: the Toolbox has no such tool kind.
    assert "crm-create-person" in result.native_tools
    assert "crm-create-person" not in result.config["tools"]
    # A toolset of nothing else is the gateway's alone; a mixed one keeps its own tools.
    assert "crm-writes" not in result.config["toolsets"]
    assert result.config["toolsets"]["mixed"] == ["list-tables"]
    assert result.config["toolsets"]["none-yet"] == []


def test_tools_are_a_map_keyed_by_name(tmp_path):
    result = build_toolbox_config(_write(tmp_path))
    tool = result.config["tools"]["list-tables"]
    assert tool["kind"] == "postgres-sql"
    assert tool["source"] == "client-postgres"
    assert isinstance(result.config["tools"], dict)


def test_a_write_toolset_and_an_http_tool_reach_the_toolbox_as_it_reads_them(tmp_path):
    path = tmp_path / "tools.yaml"
    path.write_text(
        DSL
        + textwrap.dedent(
            """
            ---
            kind: source
            name: crm
            type: http
            baseUrl: https://crm.example
            headers:
              Authorization: Bearer ${CRM_TOKEN}
            ---
            kind: tool
            name: add-note
            type: http
            source: crm
            method: POST
            path: /people/{{.person}}/notes
            requestBody: '{"body": "{{.body}}"}'
            pathParams:
              - name: person
                type: string
            bodyParams:
              - name: body
                type: string
            ---
            kind: toolset
            name: crm-writes
            write: true
            tools:
              - add-note
            """
        )
    )
    config = build_toolbox_config(path).config
    # `write` is the gateway's word: the Toolbox is given the list of tools and nothing else.
    assert config["toolsets"]["crm-writes"] == ["add-note"]
    assert config["sources"]["crm"] == {
        "kind": "http",
        "baseUrl": "https://crm.example",
        "headers": {"Authorization": "Bearer ${CRM_TOKEN}"},
    }
    tool = config["tools"]["add-note"]
    assert (tool["kind"], tool["method"]) == ("http", "POST")
    assert tool["path"] == "/people/{{.person}}/notes"
    assert tool["requestBody"] == '{"body": "{{.body}}"}'
    assert [p["name"] for p in tool["pathParams"] + tool["bodyParams"]] == [
        "person",
        "body",
    ]


def test_a_source_no_tool_uses_is_left_out_and_a_systems_tool_loses_the_gateways_word(
    tmp_path,
):
    path = tmp_path / "tools.yaml"
    path.write_text(
        textwrap.dedent(
            """
            kind: source
            name: campus-db
            type: postgres
            host: ${CAMPUS_DB_HOST}
            ---
            kind: source
            name: acme-reads
            type: http
            baseUrl: https://api.acme.example/v1/
            ---
            kind: source
            name: acme-writes
            type: http
            baseUrl: https://api.acme.example/v1/
            ---
            kind: tool
            name: acme-list-invoices
            type: http
            source: acme-reads
            service: acme
            method: GET
            path: invoices
            description: Open invoices.
            headerParams:
              - name: Authorization
                type: string
                description: Added by the gateway.
            ---
            kind: toolset
            name: acme-reads
            tools:
              - acme-list-invoices
            ---
            kind: toolset
            name: acme-writes
            write: true
            tools: []
            """
        )
    )
    result = build_toolbox_config(path)
    # A connected database leaves a source with unset placeholders and no tool: the
    # Toolbox would refuse its whole file over it.
    assert set(result.config["sources"]) == {"acme-reads"}
    assert result.sources == 1
    tool = result.config["tools"]["acme-list-invoices"]
    # `service` is whose key the gateway adds; the Toolbox refuses a key it does not know.
    assert "service" not in tool
    assert tool["headerParams"][0]["name"] == "Authorization"
    assert result.config["toolsets"] == {
        "acme-reads": ["acme-list-invoices"],
        "acme-writes": [],
    }


def test_a_written_file_holds_an_empty_toolset_named_after_its_content(tmp_path):
    dest = tmp_path / "generated" / "toolbox.yaml"
    first = write_toolbox_config(_write(tmp_path), dest)
    loaded = yaml.safe_load(dest.read_text())
    assert first.mark.startswith("loaded-") and loaded["toolsets"][first.mark] == []
    # The same content is the same name; another is another.
    assert write_toolbox_config(_write(tmp_path), dest).mark == first.mark
    other = tmp_path / "other.yaml"
    other.write_text(DSL.replace("List tables", "Every table"))
    assert write_toolbox_config(other, dest).mark != first.mark

    # With nothing for the Toolbox, the file holds that toolset and no empty map.
    empty = tmp_path / "empty.yaml"
    empty.write_text("# nothing yet\n")
    mark = write_toolbox_config(empty, dest).mark
    assert yaml.safe_load(dest.read_text()) == {"toolsets": {mark: []}}


def test_publish_writes_the_file_beside_tools_yaml(tmp_path):
    from iblai_ontology.backend.mcp_server.toolbox_config import publish

    mark = publish(_write(tmp_path)).mark
    served = yaml.safe_load((tmp_path / "generated" / "toolbox.yaml").read_text())
    assert mark in served["toolsets"] and "list-tables" in served["tools"]


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
