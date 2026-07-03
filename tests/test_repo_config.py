"""Guard tests: the repo's shipped config/ stays valid and self-consistent."""

from __future__ import annotations

from iblai_ontology.config.reader import ConfigReader
from iblai_ontology.config.validator import ConfigValidator

# Baseline toolsets shipped in config/tools.yaml (the higher-ed toolsets live in
# tools.higher-ed.example.yaml and are not loaded by default).
REQUIRED_TOOLSETS = {
    "admin-analytics-tools",
    "client-postgres-tools",
}


def test_repo_config_validates(repo_config_dir):
    result = ConfigValidator(repo_config_dir).validate_all()
    assert result.all_valid, [i.message for i in result.items if not i.valid]


def test_repo_roles_validate(repo_config_dir):
    result = ConfigValidator(repo_config_dir).validate_roles()
    assert result.all_valid, [i.message for i in result.issues]


def test_required_toolsets_exist(repo_config_dir):
    toolsets = set(ConfigReader(repo_config_dir).get_toolsets())
    assert REQUIRED_TOOLSETS <= toolsets


def test_every_role_toolset_is_defined(repo_config_dir):
    reader = ConfigReader(repo_config_dir)
    known = set(reader.get_toolsets())
    for name, spec in reader.get_roles().items():
        for ts in spec.get("mcp_toolsets", []):
            if ts == "*":
                continue
            assert ts in known, f"role {name} references unknown toolset {ts}"
