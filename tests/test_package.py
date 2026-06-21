"""Smoke tests for the package skeleton."""

from __future__ import annotations


def test_import_and_version():
    import iblai_ontology

    assert isinstance(iblai_ontology.__version__, str)
    assert iblai_ontology.__version__


def test_cli_app_exists():
    from iblai_ontology.cli import app

    assert app is not None


def test_cli_version_runs():
    from typer.testing import CliRunner

    from iblai_ontology.cli import app

    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "ontology" in result.stdout
