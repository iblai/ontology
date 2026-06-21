"""Unit tests for the Django-free config layer."""

from __future__ import annotations

import os

import pytest

from iblai_ontology.config.initializer import Initializer
from iblai_ontology.config.reader import ConfigReader
from iblai_ontology.config.validator import ConfigValidator
from iblai_ontology.config.writer import ConfigWriter


@pytest.fixture()
def cfgdir(tmp_path):
    Initializer(tmp_path).run(with_samples=True)
    return tmp_path / "config"


def test_initializer_scaffolds_files(tmp_path):
    Initializer(tmp_path).run(with_samples=True)
    cfg = tmp_path / "config"
    for name in ("ontology.yaml", "tools.yaml", "roles.yaml", "sync-schedules.yaml", "services.yaml"):
        assert (cfg / name).exists()
    assert (tmp_path / "docker-compose.yml").exists()
    assert (tmp_path / ".env.example").exists()


def test_reader_roles_and_toolsets(cfgdir):
    reader = ConfigReader(cfgdir)
    roles = reader.get_roles()
    assert "default" in roles
    assert "Registrar" in roles
    toolsets = reader.get_toolsets()
    assert "admin-analytics-tools" in toolsets
    tools = reader.get_tools()
    assert any(t["name"] == "search-students" for t in tools)


def test_reader_env_expansion(cfgdir, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_DB_USER", "expanded_user")
    sources = ConfigReader(cfgdir).get_sources()
    cache = next(s for s in sources if s["name"] == "ontology-cache")
    assert cache["user"] == "expanded_user"


def test_writer_set_dotnotation_and_llm(cfgdir):
    writer = ConfigWriter(cfgdir)
    writer.set("llm.provider", "anthropic")
    writer.set_llm(provider="anthropic", api_key="sk-secret", model=None)
    main = ConfigReader(cfgdir).main()
    assert main["llm"]["provider"] == "anthropic"
    # Default model resolves to opus-4-8 for anthropic.
    assert main["llm"]["model"] == "claude-opus-4-8"
    assert main["llm"]["api_key"] == "sk-secret"


def test_show_all_redacts_secrets(cfgdir):
    ConfigWriter(cfgdir).set_llm(provider="anthropic", api_key="sk-supersecret")
    rendered = ConfigReader(cfgdir).show_all(redact=True)
    assert "sk-supersecret" not in rendered
    assert "********" in rendered


def test_validator_all_valid(cfgdir):
    result = ConfigValidator(cfgdir).validate_all()
    assert result.all_valid, [i.message for i in result.items if not i.valid]


def test_validator_flags_unknown_toolset(cfgdir):
    # Point a role at a non-existent toolset.
    roles_path = cfgdir / "roles.yaml"
    text = roles_path.read_text().replace(
        "      - admin-analytics-tools", "      - does-not-exist"
    )
    roles_path.write_text(text)
    result = ConfigValidator(cfgdir).validate_roles()
    assert not result.all_valid
    assert any("does-not-exist" in i.message for i in result.issues)
