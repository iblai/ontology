"""Unit tests for the discovery ConfigGenerator (Django-free)."""

from __future__ import annotations

import yaml

from iblai_ontology.backend.discovery.config_generator import ConfigGenerator
from iblai_ontology.backend.discovery.introspection import (
    ColumnInfo,
    SchemaManifest,
    TableInfo,
)
from iblai_ontology.backend.discovery.llm_analyzer import (
    LLMAnalysisResult,
    SuggestedTool,
    TableDescription,
)


def _manifest():
    return SchemaManifest(
        db_type="oracle",
        host="h",
        database="CSPRD",
        schemas=["SYSADM"],
        tables=[
            TableInfo(
                "SYSADM",
                "PS_STDNT_CAR_TERM",
                1000,
                columns=[ColumnInfo("EMPLID", "VARCHAR2", False, is_primary_key=True)],
                primary_key_columns=["EMPLID"],
            )
        ],
        total_tables=1,
    )


def _analysis():
    return LLMAnalysisResult(
        table_descriptions=[
            TableDescription(
                table_name="SYSADM.PS_STDNT_CAR_TERM",
                description="Student career/term records.",
                entity_group="students",
                suggested_sync_cadence="1h",
                sync_rationale="frequently changing",
            )
        ],
        entity_groups={"students": ["PS_STDNT_CAR_TERM"]},
        suggested_tools=[
            SuggestedTool(
                name="get-student-enrollment",
                description="Get enrollment by EMPLID",
                sql="SELECT * FROM PS_STDNT_CAR_TERM WHERE EMPLID = :1",
                parameters=[
                    {"name": "student_id", "type": "string", "description": "EMPLID"}
                ],
                toolset="enrollment-tools",
            )
        ],
        suggested_sync_schedules={"SYSADM.PS_STDNT_CAR_TERM": "1h"},
        used_llm=True,
    )


def test_generate_all_writes_artifacts(tmp_path):
    gen = ConfigGenerator("peoplesoft", _manifest(), _analysis())
    written = gen.generate_all(str(tmp_path / "out"))
    for key in (
        "tools.yaml",
        "sync-schedules.yaml",
        "entity-groups.yaml",
        "table-descriptions.md",
        "cache-schema.sql",
    ):
        assert key in written

    # tools.yaml is multi-doc and contains the tool + its toolset
    docs = list(yaml.safe_load_all(open(written["tools.yaml"])))
    kinds = {(d.get("kind"), d.get("name")) for d in docs}
    assert ("tool", "get-student-enrollment") in kinds
    assert ("toolset", "enrollment-tools") in kinds

    # sync schedule maps the 1h cadence to a cron and names the table it reads
    sched = yaml.safe_load(open(written["sync-schedules.yaml"]))["schedules"]
    assert sched and sched[0]["cron"] == "0 * * * *"
    assert sched[0]["service"] == "peoplesoft"
    assert sched[0]["table"] == "SYSADM.PS_STDNT_CAR_TERM"
    assert "tool" not in sched[0]
    assert sched[0]["output"] == {
        "structured_cache": "stdnt_car_term",
        "text_memories": "/ontology/stdnt_car_term/",
        "primary_key": ["emplid"],
    }
    # no "every row" Toolbox tool: the sync reads the table itself
    assert ("tool", "get-stdnt_car_term") not in kinds

    # entity groups + descriptions
    eg = yaml.safe_load(open(written["entity-groups.yaml"]))["entity_groups"]
    assert "students" in eg
    assert "Student career/term" in open(written["table-descriptions.md"]).read()

    # cache schema falls back to the provisioning generator projection, bare names
    assert (
        "CREATE TABLE IF NOT EXISTS stdnt_car_term ("
        in open(written["cache-schema.sql"]).read()
    )


def test_mapping_flows_into_schedules_and_ddl(tmp_path):
    analysis = _analysis()
    td = analysis.table_descriptions[0]
    td.entity, td.fields, td.template = "students", {"EMPLID": "id"}, "student"
    gen = ConfigGenerator("peoplesoft", _manifest(), analysis)
    sched = yaml.safe_load(gen.sync_schedules_yaml())["schedules"][0]
    assert sched["output"] == {
        "structured_cache": "students",
        "text_memories": "/ontology/students/",
        "primary_key": ["id"],
        "map": {"emplid": "id"},
        "template": "student",
    }
    ddl = gen.cache_schema_sql()
    assert "CREATE TABLE IF NOT EXISTS students (" in ddl
    assert "    id TEXT NOT NULL" in ddl and "PRIMARY KEY (id)" in ddl
    assert "cache." not in ddl and "NOW()" not in ddl


# --- console edits on the stored analysis dict --------------------------------


def _stored():
    return _analysis().to_dict()


def test_apply_table_edits_moves_group_and_records_override():
    from iblai_ontology.backend.discovery.config_generator import apply_table_edits

    analysis = apply_table_edits(
        _stored(), ["SYSADM.PS_STDNT_CAR_TERM"], entity_group="alumni"
    )
    td = analysis["table_descriptions"][0]
    assert td["entity_group"] == "alumni"
    assert analysis["entity_groups"] == {"alumni": ["PS_STDNT_CAR_TERM"]}  # bare name
    assert analysis["overrides"] == {
        "SYSADM.PS_STDNT_CAR_TERM": {"entity_group": "alumni"}
    }

    # A table the analysis never described (LLM top-100 cut, seed data) is added.
    analysis = apply_table_edits(analysis, ["SYSADM.PS_NEW"], description="New.")
    added = analysis["table_descriptions"][-1]
    assert added["table_name"] == "SYSADM.PS_NEW" and added["description"] == "New."
    assert added["entity_group"] == "other"
    assert analysis["entity_groups"] == {"alumni": ["PS_STDNT_CAR_TERM"]}


def test_apply_overrides_survives_a_fresh_analysis():
    from iblai_ontology.backend.discovery.config_generator import (
        apply_overrides,
        apply_table_edits,
    )

    edited = apply_table_edits(
        _stored(), ["SYSADM.PS_STDNT_CAR_TERM"], entity_group="alumni", description="D"
    )
    fresh = apply_overrides(_stored(), edited["overrides"])
    assert fresh["table_descriptions"][0]["entity_group"] == "alumni"
    assert fresh["table_descriptions"][0]["description"] == "D"
    assert fresh["entity_groups"] == {"alumni": ["PS_STDNT_CAR_TERM"]}


def test_rewrite_entity_files(tmp_path):
    from iblai_ontology.backend.discovery.config_generator import (
        apply_table_edits,
        rewrite_entity_files,
    )

    analysis = apply_table_edits(
        _stored(), ["SYSADM.PS_STDNT_CAR_TERM"], entity_group="alumni"
    )
    rewrite_entity_files("peoplesoft", analysis, tmp_path)
    groups = yaml.safe_load((tmp_path / "entity-groups.yaml").read_text())
    assert groups == {"entity_groups": {"alumni": ["PS_STDNT_CAR_TERM"]}}
    assert "_(alumni, sync 1h)_" in (tmp_path / "table-descriptions.md").read_text()
