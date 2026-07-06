"""Tests for the dependency-light utils (output, db, docker) and ui."""

from __future__ import annotations

import pytest

from iblai_ontology import ui
from iblai_ontology.utils import db, docker, output


# --- output ---------------------------------------------------------------
def test_print_table_renders(capsys):
    output.print_table(title="T", columns=["a", "b"], rows=[[1, 2], [3, None]])
    out = capsys.readouterr().out
    assert "T" in out and "a" in out and "b" in out


def test_print_result_json(capsys):
    output.print_result([{"x": 1}], ["x"], format="json")
    assert '"x": 1' in capsys.readouterr().out


def test_print_result_csv(capsys):
    output.print_result([(1, 2)], ["a", "b"], format="csv")
    out = capsys.readouterr().out
    assert "a,b" in out and "1,2" in out


def test_print_result_table_from_tuples(capsys):
    output.print_result([(1, 2)], ["a", "b"], format="table")
    assert "a" in capsys.readouterr().out


# --- db -------------------------------------------------------------------
def test_assert_select_only_accepts_select():
    db._assert_select_only("SELECT 1")
    db._assert_select_only("  with x as (select 1) select * from x ")


def test_assert_select_only_rejects_write():
    with pytest.raises(db.ReadOnlyQueryError):
        db._assert_select_only("DELETE FROM t")


def test_run_readonly_query_rejects_write():
    with pytest.raises(db.ReadOnlyQueryError):
        db.run_readonly_query("UPDATE t SET x=1")


def test_ontology_db_url_requires_env(monkeypatch):
    monkeypatch.delenv("ONTOLOGY_DB_URL", raising=False)
    with pytest.raises(RuntimeError):
        db._ontology_db_url()


# --- docker ---------------------------------------------------------------
def test_compose_helpers_invoke_subprocess(monkeypatch, tmp_path):
    compose = tmp_path / "docker-compose.yml"
    compose.write_text("services: {}\n")
    monkeypatch.setenv("ONTOLOGY_COMPOSE_FILE", str(compose))
    monkeypatch.setattr(docker.shutil, "which", lambda _: "/usr/bin/docker")
    calls = {}

    def fake_call(args):
        calls["args"] = args
        return 0

    monkeypatch.setattr(docker.subprocess, "call", fake_call)

    assert docker.compose_up(detach=True, build=True) == 0
    assert (
        "up" in calls["args"] and "-d" in calls["args"] and "--build" in calls["args"]
    )
    assert docker.compose_down(remove_volumes=True) == 0
    assert docker.compose_logs(service="db", follow=True, tail=10) == 0
    assert docker.compose_restart(service="db") == 0
    assert docker.compose_ps() == 0


def test_compose_missing_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ONTOLOGY_COMPOSE_FILE", str(tmp_path / "none.yml"))
    monkeypatch.setattr(docker.shutil, "which", lambda _: "/usr/bin/docker")
    with pytest.raises(FileNotFoundError):
        docker.compose_ps()


def test_compose_requires_docker(monkeypatch, tmp_path):
    compose = tmp_path / "docker-compose.yml"
    compose.write_text("services: {}\n")
    monkeypatch.setenv("ONTOLOGY_COMPOSE_FILE", str(compose))
    monkeypatch.setattr(docker.shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError):
        docker.compose_ps()


# --- ui -------------------------------------------------------------------
def test_ui_helpers(capsys):
    ui.banner()
    ui.step_header(1, 3, "Step")
    ui.success("ok")
    ui.warn("careful")
    ui.error("bad")
    ui.newline()
    out = capsys.readouterr().out
    assert "iblai-ontology" in out and "Step" in out


# --- deploy commands (monkeypatch docker helpers) -------------------------
def test_deploy_commands(monkeypatch):
    from typer.testing import CliRunner

    import iblai_ontology.utils.docker as dk
    from iblai_ontology.cli import app

    monkeypatch.setattr(dk, "compose_up", lambda detach=True, build=False: 0)
    monkeypatch.setattr(dk, "compose_down", lambda remove_volumes=False: 0)
    monkeypatch.setattr(
        dk, "compose_logs", lambda service=None, follow=False, tail=100: 0
    )
    monkeypatch.setattr(dk, "compose_restart", lambda service=None: 0)
    monkeypatch.setattr(dk, "compose_ps", lambda: 0)
    r = CliRunner()
    assert r.invoke(app, ["deploy", "up"]).exit_code == 0
    assert r.invoke(app, ["deploy", "down"]).exit_code == 0
    assert r.invoke(app, ["deploy", "logs", "db"]).exit_code == 0
    assert r.invoke(app, ["deploy", "restart"]).exit_code == 0


# --- vector search result shaping (monkeypatch the collection) ------------
def test_vector_search_query_shapes_results(monkeypatch):
    from iblai_ontology.backend.search import vector as vec

    class FakeCollection:
        def query(self, query_texts=None, n_results=10, where=None):
            return {
                "ids": [["/ontology/students/1.md"]],
                "documents": [["First line\nrest"]],
                "distances": [[0.1]],
            }

        def upsert(self, ids=None, documents=None, metadatas=None):
            self.upserted = ids

    vs = vec.VectorSearch()
    monkeypatch.setattr(vs, "_collection", lambda: FakeCollection())
    results = vs.query("anything", limit=1)
    assert results[0].path == "/ontology/students/1.md"
    assert results[0].score == pytest.approx(0.9)
    assert results[0].snippet == "First line"
    vs.index_file("/ontology/students/1.md", "text")  # exercises upsert path
