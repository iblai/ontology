"""Tests for the catalog / doctor / skill CLI utilities (Django-free paths)."""

from __future__ import annotations

from typer.testing import CliRunner

from iblai_ontology.cli import app

runner = CliRunner()


def test_catalog_list_shows_systems():
    result = runner.invoke(app, ["catalog", "list"])
    assert result.exit_code == 0
    assert "peoplesoft" in result.stdout
    assert "snowflake" in result.stdout


def test_catalog_list_domain_filter():
    result = runner.invoke(app, ["catalog", "list", "--domain", "enterprise"])
    assert result.exit_code == 0
    assert "snowflake" in result.stdout
    # a higher-ed-only key should not appear under the enterprise filter
    assert "blackbaud-raisers-edge" not in result.stdout


def test_catalog_show_database_entry():
    result = runner.invoke(app, ["catalog", "show", "peoplesoft"])
    assert result.exit_code == 0
    assert "PEOPLESOFT_DB_HOST" in result.stdout
    assert "database" in result.stdout


def test_catalog_show_api_entry_links_skill():
    result = runner.invoke(app, ["catalog", "show", "canvas"])
    assert result.exit_code == 0
    assert "CANVAS_API_TOKEN" in result.stdout
    assert "github.com/iblai/higher-education-agents" in result.stdout


def test_catalog_show_unknown_exits_1():
    result = runner.invoke(app, ["catalog", "show", "nope"])
    assert result.exit_code == 1


def test_doctor_runs(tmp_path, monkeypatch):
    # Point at a freshly-initialized config dir so config checks pass.
    from iblai_ontology.config.initializer import Initializer

    Initializer(tmp_path).run(with_samples=True)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path / "config"))
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    assert "config dir" in result.stdout
    assert "extra:" in result.stdout


def test_doctor_run_checks_pure(tmp_path, monkeypatch):
    from iblai_ontology.commands.doctor import run_checks

    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path / "missing"))
    checks = run_checks()
    names = {c.name for c in checks}
    assert "config dir" in names
    assert any(n.startswith("extra:") for n in names)


def test_skill_import_from_catalog_name():
    result = runner.invoke(app, ["skill", "import", "jira"])
    assert result.exit_code == 0
    assert "JIRA_API_TOKEN" in result.stdout
