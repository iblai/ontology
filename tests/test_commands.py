"""Exercise CLI command bodies. Config-driven commands run for real against a
seeded config dir; backend-driven commands are run with the backend monkeypatched."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from iblai_ontology.cli import app

runner = CliRunner()


@pytest.fixture()
def seeded(tmp_path, monkeypatch):
    from iblai_ontology.config.initializer import Initializer

    Initializer(tmp_path).run(with_samples=True)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path / "config"))
    return tmp_path / "config"


# --- roles (config-driven) ------------------------------------------------
def test_roles_list_show_validate(seeded):
    assert runner.invoke(app, ["roles", "list"]).exit_code == 0
    r = runner.invoke(app, ["roles", "show", "Registrar"])
    assert r.exit_code == 0 and "Registrar" in r.stdout
    assert runner.invoke(app, ["roles", "show", "Nope"]).exit_code == 1
    assert runner.invoke(app, ["roles", "validate"]).exit_code == 0


# --- mcp (config-driven) --------------------------------------------------
def test_mcp_tools_toolsets_validate(seeded):
    assert runner.invoke(app, ["mcp", "tools"]).exit_code == 0
    assert runner.invoke(app, ["mcp", "toolsets"]).exit_code == 0
    assert runner.invoke(app, ["mcp", "validate"]).exit_code == 0


# --- sync schedule (config-driven) ---------------------------------------
def test_sync_schedule(seeded):
    r = runner.invoke(app, ["sync", "schedule"])
    assert r.exit_code == 0


# --- config -------------------------------------------------------------
def test_config_show_validate_set_llm(seeded):
    assert runner.invoke(app, ["config", "validate"]).exit_code == 0
    assert runner.invoke(app, ["config", "show"]).exit_code == 0
    assert (
        runner.invoke(app, ["config", "set", "llm.temperature", "0.5"]).exit_code == 0
    )
    r = runner.invoke(
        app, ["config", "llm", "--provider", "anthropic", "--api-key", "sk-x"]
    )
    assert r.exit_code == 0


def test_config_init(tmp_path):
    r = runner.invoke(app, ["config", "init", str(tmp_path / "deploy")])
    assert r.exit_code == 0
    assert (tmp_path / "deploy" / "config" / "ontology.yaml").exists()


# --- data query (backend-light: monkeypatch the query helper) -------------
def test_data_query_table(monkeypatch):
    monkeypatch.setattr(
        "iblai_ontology.utils.db.run_readonly_query",
        lambda sql, limit=100: ([("Freshman", 10)], ["classification", "n"]),
    )
    r = runner.invoke(
        app, ["data", "query", "SELECT classification, count(*) n FROM students"]
    )
    assert r.exit_code == 0
    assert "Freshman" in r.stdout


def test_data_query_rejects_write():
    r = runner.invoke(app, ["data", "query", "DELETE FROM students"])
    assert r.exit_code == 1


def test_data_memory_not_found(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path))
    r = runner.invoke(app, ["data", "memory", "students/by-id/999"])
    assert r.exit_code == 1


def test_data_memory_reads(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path))
    f = tmp_path / "students" / "by-id"
    f.mkdir(parents=True)
    (f / "1.md").write_text("# Student 1")
    r = runner.invoke(app, ["data", "memory", "students/by-id/1"])
    assert r.exit_code == 0 and "Student 1" in r.stdout


# --- deploy (monkeypatch docker helpers) ---------------------------------
def test_deploy_status(monkeypatch):
    monkeypatch.setattr("iblai_ontology.utils.docker.compose_ps", lambda: 0)
    r = runner.invoke(app, ["deploy", "status"])
    assert r.exit_code == 0
