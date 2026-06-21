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
                parameters=[{"name": "student_id", "type": "string", "description": "EMPLID"}],
                toolset="enrollment-tools",
            )
        ],
        suggested_sync_schedules={"SYSADM.PS_STDNT_CAR_TERM": "1h"},
        used_llm=True,
    )


def test_generate_all_writes_artifacts(tmp_path):
    gen = ConfigGenerator("peoplesoft", _manifest(), _analysis())
    written = gen.generate_all(str(tmp_path / "out"))
    for key in ("tools.yaml", "sync-schedules.yaml", "entity-groups.yaml",
                "table-descriptions.md", "cache-schema.sql"):
        assert key in written

    # tools.yaml is multi-doc and contains the tool + its toolset
    docs = list(yaml.safe_load_all(open(written["tools.yaml"])))
    kinds = {(d.get("kind"), d.get("name")) for d in docs}
    assert ("tool", "get-student-enrollment") in kinds
    assert ("toolset", "enrollment-tools") in kinds

    # sync schedule maps the 1h cadence to a cron
    sched = yaml.safe_load(open(written["sync-schedules.yaml"]))["schedules"]
    assert sched and sched[0]["cron"] == "0 * * * *"

    # entity groups + descriptions
    eg = yaml.safe_load(open(written["entity-groups.yaml"]))["entity_groups"]
    assert "students" in eg
    assert "Student career/term" in open(written["table-descriptions.md"]).read()

    # cache schema falls back to the provisioning generator projection
    assert "CREATE TABLE IF NOT EXISTS cache." in open(written["cache-schema.sql"]).read()
