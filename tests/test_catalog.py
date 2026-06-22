"""Tests for the built-in service catalog."""

from __future__ import annotations

import pytest

from iblai_ontology.catalog import CatalogEntry, get_entry, list_entries

HIGHER_ED_KEYS = {
    "peoplesoft",
    "banner",
    "canvas",
    "slate",
    "workday",
    "eab-navigate",
    "salesforce-education-cloud",
    "servicenow",
    "civitas-learning",
    "handshake",
    "blackbaud-raisers-edge",
}
ENTERPRISE_KEYS = {
    "snowflake",
    "salesforce",
    "hubspot",
    "servicenow-itsm",
    "jira",
    "confluence",
    "github",
    "okta",
    "slack",
    "zendesk",
    "zoom",
}
EXPECTED_KEYS = HIGHER_ED_KEYS | ENTERPRISE_KEYS


def test_catalog_covers_all_systems():
    keys = {e.key for e in list_entries()}
    assert keys == EXPECTED_KEYS


def test_domains_partition_catalog():
    by_domain = {"higher-ed": set(), "enterprise": set()}
    for e in list_entries():
        by_domain[e.domain].add(e.key)
    assert ENTERPRISE_KEYS <= by_domain["enterprise"]
    assert "peoplesoft" in by_domain["higher-ed"]


def test_snowflake_is_a_database():
    snow = get_entry("snowflake")
    assert snow.type == "database"
    assert snow.connection["driver"] == "snowflake"
    assert snow.domain == "enterprise"
    assert snow.skill_url.startswith("https://github.com/iblai/enterprise-agents")


def test_entries_are_well_formed():
    for entry in list_entries():
        assert isinstance(entry, CatalogEntry)
        assert entry.display_name
        assert entry.type in ("database", "api")
        assert entry.adapter
        assert entry.env, f"{entry.key} has no env vars"
        assert entry.default_toolset


def test_peoplesoft_is_a_database():
    ps = get_entry("peoplesoft")
    assert ps.type == "database"
    assert ps.connection["driver"] == "oracle"
    assert "PEOPLESOFT_DB_HOST" in ps.env
    assert ps.skill is None  # DB entry, no vendored skill


def test_api_entries_have_vendored_skill():
    for entry in list_entries():
        if entry.type == "api":
            assert entry.skill, f"{entry.key} api entry should reference a skill"
            assert entry.skill_path is not None, f"{entry.key} skill file missing on disk"
            assert entry.skill_url.startswith("https://github.com/iblai/")


def test_get_entry_unknown_raises():
    with pytest.raises(KeyError):
        get_entry("nope")
