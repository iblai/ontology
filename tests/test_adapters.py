"""Unit tests for source-system adapters (rule-based analysis)."""

from __future__ import annotations

from iblai_ontology.backend.discovery.adapters import get_adapter
from iblai_ontology.backend.discovery.adapters.oracle import PeopleSoftAdapter


def test_get_adapter_resolves_known_types():
    assert isinstance(get_adapter("peoplesoft"), PeopleSoftAdapter)
    # Unknown type falls back to the generic base adapter.
    base = get_adapter("nope")
    assert base.classify_table("ANYTHING") == "other"


def test_peoplesoft_classification():
    a = PeopleSoftAdapter()
    assert a.classify_table("PS_STDNT_CAR_TERM") == "students"
    assert a.classify_table("PS_FIN_AID_AWARD") == "financial_aid"
    assert a.classify_table("PS_JOB") == "hr"
    assert a.classify_table("RANDOM_TABLE") == "other"


def test_peoplesoft_known_table_description_and_cadence():
    a = PeopleSoftAdapter()
    desc = a.describe_table("PS_STDNT_CAR_TERM")
    assert "career/term" in desc.lower()
    assert (
        a.suggest_sync_cadence("PS_STDNT_CAR_TERM", 2_000_000) == "1h"
    )  # known overrides size
    tools = a.suggested_tools("PS_STDNT_CAR_TERM")
    assert any(t["name"] == "get-student-enrollment" for t in tools)


def test_unknown_table_cadence_scales_with_size():
    a = PeopleSoftAdapter()
    assert a.suggest_sync_cadence("PS_UNKNOWN", 2_000_000) == "24h"
    assert a.suggest_sync_cadence("PS_UNKNOWN", 50_000) == "1h"
    assert a.suggest_sync_cadence("PS_UNKNOWN", 100) == "6h"


def test_every_catalog_adapter_resolves():
    from iblai_ontology.catalog import list_entries

    for entry in list_entries():
        adapter = get_adapter(entry.adapter)
        # API entries resolve to an api-typed adapter; databases to a db adapter.
        if entry.type == "api":
            assert adapter.SERVICE_TYPE == "api", f"{entry.key} -> {entry.adapter}"
        else:
            assert adapter.SERVICE_TYPE == "database", f"{entry.key} -> {entry.adapter}"


def test_snowflake_adapter_is_database():
    from iblai_ontology.backend.discovery.adapters.oracle import SnowflakeAdapter

    snow = get_adapter("snowflake")
    assert isinstance(snow, SnowflakeAdapter)
    assert snow.DB_TYPE == "snowflake"


def test_rule_based_analyzer_groups_tables():
    from iblai_ontology.backend.discovery.introspection import SchemaManifest, TableInfo
    from iblai_ontology.backend.discovery.llm_analyzer import RuleBasedAnalyzer

    manifest = SchemaManifest(
        db_type="oracle",
        host="h",
        database="CSPRD",
        schemas=["SYSADM"],
        tables=[
            TableInfo("SYSADM", "PS_STDNT_CAR_TERM", 100),
            TableInfo("SYSADM", "PS_FIN_AID_AWARD", 50),
        ],
        total_tables=2,
    )
    result = RuleBasedAnalyzer(PeopleSoftAdapter()).analyze(manifest)
    assert result.used_llm is False
    assert "students" in result.entity_groups
    assert "financial_aid" in result.entity_groups
    assert result.suggested_sync_schedules["SYSADM.PS_STDNT_CAR_TERM"] == "1h"
