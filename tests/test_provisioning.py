"""Unit tests for provisioning generators (Django-free paths)."""

from __future__ import annotations

import pytest

from iblai_ontology.backend.discovery.introspection import ColumnInfo, SchemaManifest, TableInfo
from iblai_ontology.backend.provisioning.schema_generator import CacheSchemaGenerator


def _manifest():
    return SchemaManifest(
        db_type="oracle",
        host="h",
        database="CSPRD",
        schemas=["SYSADM"],
        tables=[
            TableInfo(
                schema_name="SYSADM",
                table_name="PS_STDNT_CAR_TERM",
                row_count=1000,
                columns=[
                    ColumnInfo("EMPLID", "VARCHAR2", False, is_primary_key=True),
                    ColumnInfo("CUM_GPA", "NUMBER", True),
                ],
                primary_key_columns=["EMPLID"],
            )
        ],
        total_tables=1,
    )


def test_cache_schema_generation_maps_types_and_strips_prefix():
    sql = CacheSchemaGenerator(_manifest()).generate()
    assert "CREATE SCHEMA IF NOT EXISTS cache;" in sql
    # PS_ prefix stripped for the cache table name.
    assert "CREATE TABLE IF NOT EXISTS cache.stdnt_car_term (" in sql
    # Oracle types mapped to Postgres.
    assert "emplid TEXT NOT NULL" in sql
    assert "cum_gpa NUMERIC" in sql
    assert "PRIMARY KEY (emplid)" in sql
    assert "_synced_at TIMESTAMPTZ" in sql
    assert "idx_stdnt_car_term_synced_at" in sql


def test_type_mapping_fallback_is_text():
    gen = CacheSchemaGenerator(_manifest())
    assert gen._map_type("SOME_WEIRD_TYPE") == "TEXT"
    assert gen._map_type("VARCHAR2(50)") == "TEXT"


def test_memory_generator_renders_student():
    jinja2 = pytest.importorskip("jinja2")  # noqa: F841
    from iblai_ontology.backend.provisioning.memory_generator import MemoryGenerator

    md = MemoryGenerator().render(
        "student",
        {
            "id": "001234567",
            "full_name": "Jane Doe",
            "last_synced_at": "2026-06-21",
            "sources": ["PeopleSoft", "Canvas"],
            "classification": "Junior",
            "acad_program": "BSCS",
            "major_name": "Computer Science",
            "cumulative_gpa": 3.42,
            "enrollment_status": "Enrolled",
            "holds": [],
        },
    )
    assert "# Student: Jane Doe (001234567)" in md
    assert "No active holds" in md
    assert "PeopleSoft, Canvas" in md


def test_tools_generator_merge_by_kind_name(tmp_path):
    from iblai_ontology.backend.provisioning.tools_generator import ToolsGenerator

    (tmp_path / "tools.yaml").write_text(
        "kind: tool\nname: existing\ntype: postgres-sql\n"
    )
    gen = ToolsGenerator(tmp_path)
    merged = gen.merge("kind: tool\nname: new-tool\ntype: oracle-sql\n")
    assert "existing" in merged
    assert "new-tool" in merged


def test_sync_generator_merge_by_name(tmp_path):
    from iblai_ontology.backend.provisioning.sync_generator import SyncScheduleGenerator

    (tmp_path / "sync-schedules.yaml").write_text(
        "schedules:\n  - name: a\n    cron: '0 2 * * *'\n"
    )
    gen = SyncScheduleGenerator(tmp_path)
    merged = gen.merge("schedules:\n  - name: b\n    cron: '*/5 * * * *'\n")
    assert "name: a" in merged
    assert "name: b" in merged
