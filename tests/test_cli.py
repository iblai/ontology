"""Contract/smoke tests over the full CLI command surface.

These only exercise ``--help`` (and ``--version``), so they import the command
modules without touching the Django backend.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from iblai_ontology.cli import app

runner = CliRunner()

GROUPS = ["service", "config", "sync", "roles", "health", "data", "deploy", "mcp", "platform"]


def test_root_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for group in GROUPS:
        assert group in result.stdout


def test_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "ontology" in result.stdout


@pytest.mark.parametrize("group", GROUPS)
def test_group_help(group):
    result = runner.invoke(app, [group, "--help"])
    assert result.exit_code == 0


@pytest.mark.parametrize(
    "path",
    [
        ["service", "add", "--help"],
        ["service", "list", "--help"],
        ["service", "test", "--help"],
        ["config", "init", "--help"],
        ["config", "llm", "--help"],
        ["sync", "run", "--help"],
        ["roles", "list", "--help"],
        ["data", "query", "--help"],
        ["deploy", "up", "--help"],
        ["mcp", "tools", "--help"],
    ],
)
def test_subcommand_help(path):
    result = runner.invoke(app, path)
    assert result.exit_code == 0
