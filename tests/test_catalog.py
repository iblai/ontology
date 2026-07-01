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
    "oracle-epm-cloud",
}
K12_KEYS = {
    "classdojo",
    "ebsco",
    "edulastic",
    "frontline",
    "google-classroom",
    "google-workspace-edu",
    "iready",
    "khan-academy",
    "nwea-map",
    "parentsquare",
    "powerschool",
}
GOVERNMENT_KEYS = {
    "congress-gov",
    "cornerstone-ondemand",
    "federal-register",
    "granicus-govdelivery",
    "microsoft-entra-id",
    "salesforce-government-cloud",
    "sam-gov",
    "usaspending",
    "workday-government",
}
LEGAL_KEYS = {
    "clio",
    "docket-alarm",
    "docusign",
    "imanage",
    "intapp-conflicts",
    "ironclad",
    "netdocuments",
    "pacer",
    "relativity",
    "westlaw",
}
FINANCIAL_SERVICES_KEYS = {
    "blackrock-aladdin",
    "bloomberg-terminal",
    "factset",
    "lexisnexis-worldcompliance",
    "morningstar-direct",
    "nice-actimize",
    "salesforce-financial-services-cloud",
    "splunk",
    "workiva",
}
MEDICAL_HEALTHCARE_KEYS = {
    "availity",
    "cerner-fhir",
    "epic-fhir",
    "healthstream",
    "innovaccer",
    "micromedex",
    "nuance-dax",
    "pubmed",
    "uptodate",
}

# domain key (CatalogEntry.domain) -> expected entry keys
DOMAIN_KEYS = {
    "higher-ed": HIGHER_ED_KEYS,
    "enterprise": ENTERPRISE_KEYS,
    "k-12": K12_KEYS,
    "government": GOVERNMENT_KEYS,
    "legal": LEGAL_KEYS,
    "financial-services": FINANCIAL_SERVICES_KEYS,
    "medical-healthcare": MEDICAL_HEALTHCARE_KEYS,
}
EXPECTED_KEYS = set().union(*DOMAIN_KEYS.values())


def test_catalog_covers_all_systems():
    keys = {e.key for e in list_entries()}
    assert keys == EXPECTED_KEYS


def test_domains_partition_catalog():
    by_domain = {}
    for e in list_entries():
        by_domain.setdefault(e.domain, set()).add(e.key)
    assert by_domain == DOMAIN_KEYS
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
