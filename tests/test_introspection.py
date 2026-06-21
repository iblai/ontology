"""Unit tests for schema introspection (fake cursor, no DB)."""

from __future__ import annotations

from iblai_ontology.backend.discovery.introspection import (
    ColumnInfo,
    SchemaManifest,
    SchemaIntrospector,
    TableInfo,
)


class ScriptedCursor:
    """Returns canned results keyed by recognisable fragments of the SQL."""

    def __init__(self):
        self._rows: list = []

    def execute(self, sql: str):
        u = sql.upper()
        if "INFORMATION_SCHEMA.SCHEMATA" in u:
            self._rows = [("public",)]
        elif "INFORMATION_SCHEMA.TABLES" in u:
            self._rows = [("students", 4287)]
        elif "TABLE_CONSTRAINTS" in u:  # primary keys
            self._rows = [("id",)]
        elif "REFERENTIAL_CONSTRAINTS" in u:  # foreign keys
            self._rows = []
        elif "INFORMATION_SCHEMA.COLUMNS" in u:
            self._rows = [
                ("id", "text", "NO", None, None),
                ("full_name", "text", "YES", None, None),
            ]
        elif "CURRENT_DATABASE" in u:
            self._rows = [("ontology",)]
        else:
            self._rows = []

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    def cursor(self):
        return ScriptedCursor()


def test_introspect_builds_manifest():
    manifest = SchemaIntrospector(FakeConn(), "postgresql").introspect()
    assert isinstance(manifest, SchemaManifest)
    assert manifest.total_tables == 1
    table = manifest.tables[0]
    assert table.table_name == "students"
    assert table.row_count == 4287
    assert table.column_count == 2
    assert "id" in table.primary_key_columns
    # id is NOT NULL, full_name is nullable
    by_name = {c.name: c for c in table.columns}
    assert by_name["id"].nullable is False
    assert by_name["full_name"].nullable is True
    assert by_name["id"].is_primary_key is True


def test_manifest_summary_markdown():
    manifest = SchemaManifest(
        db_type="postgresql",
        host="h",
        database="ontology",
        schemas=["public"],
        tables=[
            TableInfo(
                schema_name="public",
                table_name="students",
                row_count=10,
                columns=[ColumnInfo("id", "text", False, is_primary_key=True)],
                primary_key_columns=["id"],
            )
        ],
        total_tables=1,
        total_columns=1,
        total_rows=10,
    )
    md = manifest.to_summary_markdown()
    assert "# Schema Summary: ontology" in md
    assert "public.students" in md
    assert "| id |" in md
