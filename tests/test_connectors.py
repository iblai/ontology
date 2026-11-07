"""Snowflake/Trino/ClickHouse through NVIDIA auto-ontology's connectors (no DB required).

The connector-backed tests need the ``auto-ontology`` extra and skip without it; the
loud-failure, registry and CLI tests run everywhere.
"""

from __future__ import annotations

import importlib.util
import sys

import pytest
from typer.testing import CliRunner

from iblai_ontology.backend.discovery.adapters import get_adapter
from iblai_ontology.backend.discovery.connectors import (
    CONNECTOR_DB_TYPES,
    ConnectorConnection,
    manifest_from_connector,
)
from iblai_ontology.backend.discovery.engine import _DB_TYPE, create_connection
from iblai_ontology.backend.discovery.introspection import SchemaIntrospector
from iblai_ontology.backend.discovery.safety import SafetyVerifier
from iblai_ontology.backend.discovery.safety import TestResult as Status
from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml
from iblai_ontology.cli import app

HAS_EXTRA = importlib.util.find_spec("auto_ontology") is not None
needs_extra = pytest.mark.skipif(
    not HAS_EXTRA, reason="auto-ontology extra not installed"
)

_WRITE = ("CREATE", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE")

if HAS_EXTRA:
    import pandas as pd
    from auto_ontology.connectors.base import SQLDatabase

    class FakeConnector(SQLDatabase):
        """Two tables and a view in PUBLIC; writes denied unless told otherwise."""

        def __init__(self, connection_string: str = "fake://", *, deny_writes=True):
            self.deny_writes = deny_writes
            self.executed: list[str] = []
            self.closed = False

        def execute(self, sql, parameters=None):
            self.executed.append(sql)
            if any(sql.strip().upper().startswith(k) for k in _WRITE):
                if self.deny_writes:
                    raise Exception(
                        "SQL access control error: Insufficient privileges to "
                        "operate on table 'STUDENTS'"
                    )
                return pd.DataFrame()
            return pd.DataFrame({"n": [1]})

        def get_tables(self):
            return pd.DataFrame(
                {
                    "table_schema": ["PUBLIC", "PUBLIC", "PUBLIC"],
                    "table_name": ["STUDENTS", "ENROLLMENTS", "V_ACTIVE"],
                    "table_type": ["base table", "base table", "view"],
                }
            )

        def get_columns(self):
            return pd.DataFrame(
                {
                    "table_schema": ["PUBLIC"] * 5,
                    "table_name": [
                        "STUDENTS",
                        "STUDENTS",
                        "ENROLLMENTS",
                        "ENROLLMENTS",
                        "V_ACTIVE",
                    ],
                    "column_name": ["EMPLID", "NAME", "ID", "EMPLID", "EMPLID"],
                    "data_type": ["NUMBER", "TEXT", "NUMBER", "NUMBER", "NUMBER"],
                    "is_nullable": [False, True, False, None, True],
                    "ordinal_position": [1, 2, 1, 2, 1],
                }
            )

        def get_views(self):
            return pd.DataFrame(
                {
                    "table_schema": ["PUBLIC"],
                    "table_name": ["V_ACTIVE"],
                    "view_definition": ["SELECT 1"],
                }
            )

        def get_queries(self, hours: int = 24):
            return pd.DataFrame(columns=["end_time", "query_text"])

        def get_pks(self):
            return pd.DataFrame(
                {
                    "table_schema": ["PUBLIC", "PUBLIC"],
                    "table_name": ["STUDENTS", "ENROLLMENTS"],
                    "column_name": ["EMPLID", "ID"],
                    "ordinal_position": [1, 1],
                }
            )

        def get_fks(self):
            return pd.DataFrame(
                {
                    "table_schema": ["PUBLIC"],
                    "table_name": ["ENROLLMENTS"],
                    "column_name": ["EMPLID"],
                    "referenced_schema": ["PUBLIC"],
                    "referenced_table": ["STUDENTS"],
                    "referenced_column": ["EMPLID"],
                }
            )

        @property
        def dialect(self) -> str:
            return "snowflake"

        @property
        def database_name(self) -> str:
            return "DEMO"

        def close(self) -> None:
            self.closed = True


# --- connector-backed (need the extra) -------------------------------------
@needs_extra
def test_manifest_from_connector_maps_tables_keys_and_nullability():
    manifest = manifest_from_connector(FakeConnector(), "snowflake")

    assert manifest.db_type == "snowflake"
    assert manifest.host == manifest.database == "DEMO"
    assert manifest.schemas == ["PUBLIC"]
    assert [t.table_name for t in manifest.tables] == ["STUDENTS", "ENROLLMENTS"]
    assert manifest.total_tables == 2 and manifest.total_columns == 4

    students, enrollments = manifest.tables
    assert students.primary_key_columns == ["EMPLID"]
    assert [c.nullable for c in students.columns] == [False, True]
    emplid = enrollments.columns[1]
    assert emplid.nullable is True  # unknown nullability reads as nullable
    assert (emplid.foreign_key_table, emplid.foreign_key_column) == (
        "STUDENTS",
        "EMPLID",
    )
    assert enrollments.foreign_keys == [
        {
            "column": "EMPLID",
            "references_table": "STUDENTS",
            "references_column": "EMPLID",
        }
    ]
    assert manifest.to_dict()["tables"][0]["row_count"] == 0


@needs_extra
def test_introspector_routes_connector_connections():
    conn = ConnectorConnection(FakeConnector(), "snowflake")
    manifest = SchemaIntrospector(conn, "snowflake").introspect()
    assert manifest.total_tables == 2


@needs_extra
def test_safety_suite_runs_over_connector_and_detects_db_type():
    conn = ConnectorConnection(FakeConnector(), "snowflake")
    result = SafetyVerifier(conn).run_all_tests()

    assert result.db_type == "snowflake"
    assert result.all_passed and len(result.tests) == 7
    assert result.remediation_sql is None
    inserts = [s for s in conn.connector.executed if s.startswith("INSERT")]
    assert inserts == ['INSERT INTO "PUBLIC"."STUDENTS" ("EMPLID") VALUES (NULL)']
    conn.close()
    assert conn.connector.closed


@needs_extra
def test_safety_suite_flags_writable_connector():
    conn = ConnectorConnection(FakeConnector(deny_writes=False), "snowflake")
    result = SafetyVerifier(conn).run_all_tests()
    assert result.overall_status == Status.FAILED
    assert "CREATE ROLE iblai_readonly" in result.remediation_sql


@needs_extra
def test_create_connection_builds_connector_urls(monkeypatch):
    import auto_ontology.connectors.registry as registry

    seen = {}

    def fake_create_connector(url, schemas=None, table_filter=None):
        seen["url"] = url
        return FakeConnector()

    monkeypatch.setattr(registry, "create_connector", fake_create_connector)

    conn = create_connection(
        "snowflake",
        {
            "host": "acme-xy12345",
            "port": 0,
            "database": "DEMO",
            "username": "ro",
            "password": "p@ss/w",
            "options": {"warehouse": "WH"},
        },
    )
    assert isinstance(conn, ConnectorConnection) and conn.db_type == "snowflake"
    assert (
        seen["url"]
        == "snowflake://ro:p%40ss%2Fw@acme-xy12345?warehouse=WH&database=DEMO"
    )

    create_connection(
        "generic-trino",
        {
            "host": "trino.internal",
            "port": 8443,
            "database": "hive",
            "username": "ro",
            "password": "pw",
            "options": {"schema": "public"},
        },
    )
    assert seen["url"] == "trino://ro:pw@trino.internal:8443/hive?schema=public"

    create_connection(
        "generic-clickhouse",
        {
            "db_type": "clickhouse",
            "host": "ch.internal",
            "port": 8123,
            "database": "analytics",
            "username": "ro",
            "password": "pw",
        },
    )
    assert seen["url"] == "clickhouse://ro:pw@ch.internal:8123/analytics"


# --- run everywhere ----------------------------------------------------------
def test_missing_extra_fails_loudly(monkeypatch):
    monkeypatch.setitem(sys.modules, "auto_ontology.connectors.registry", None)
    with pytest.raises(ValueError, match=r"iblai-ontology\[auto-ontology\]"):
        create_connection(
            "generic-trino", {"host": "h", "database": "d", "username": "u"}
        )


def test_connector_adapters_and_db_types_line_up():
    for adapter, db_type in [
        ("snowflake", "snowflake"),
        ("generic-trino", "trino"),
        ("generic-clickhouse", "clickhouse"),
    ]:
        assert get_adapter(adapter).DB_TYPE == db_type
        assert _DB_TYPE[adapter] == db_type
        assert db_type in CONNECTOR_DB_TYPES


def test_toolbox_knows_trino_and_clickhouse_kinds(tmp_path):
    (tmp_path / "tools.yaml").write_text(
        "kind: source\nname: t\ntype: trino\n---\n"
        "kind: tool\nname: tq\ntype: trino-sql\nsource: t\nstatement: SELECT 1\n---\n"
        "kind: source\nname: c\ntype: clickhouse\n---\n"
        "kind: tool\nname: cq\ntype: clickhouse-sql\nsource: c\nstatement: SELECT 1\n"
    )
    report = validate_tools_yaml(tmp_path / "tools.yaml")
    assert report.ok and not report.issues


def test_service_add_passes_options_and_skips_port_for_snowflake(monkeypatch):
    captured = {}

    class FakeEngine:
        def run(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("iblai_ontology.backend.bootstrap", lambda: None)
    monkeypatch.setattr(
        "iblai_ontology.backend.discovery.engine.DiscoveryEngine", FakeEngine
    )
    result = CliRunner().invoke(
        app,
        [
            "service",
            "add",
            "--name",
            "wh",
            "--service-type",
            "snowflake",
            "--host",
            "acme-xy12345",
            "--database",
            "DEMO",
            "--user",
            "ro",
            "--password",
            "pw",
            "--option",
            "warehouse=WH",
            "--option",
            "schema=PUBLIC",
            "--no-llm-discover",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["options"] == {"warehouse": "WH", "schema": "PUBLIC"}
    assert captured["port"] == 0  # portless engine: no port prompt


def test_service_add_rejects_malformed_option():
    result = CliRunner().invoke(
        app,
        [
            "service",
            "add",
            "--name",
            "x",
            "--service-type",
            "snowflake",
            "--host",
            "h",
            "--database",
            "d",
            "--user",
            "u",
            "--password",
            "p",
            "--option",
            "warehouse",
        ],
    )
    assert result.exit_code == 2
    assert "KEY=VALUE" in result.output
