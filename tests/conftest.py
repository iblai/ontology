"""Shared pytest fixtures for the iblai-ontology test suite."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def temp_config_dir(tmp_path, monkeypatch):
    """An isolated config dir seeded with the repo's canonical roles.yaml."""
    cfg = tmp_path / "config"
    cfg.mkdir()
    roles = REPO_ROOT / "config" / "roles.yaml"
    if roles.exists():
        shutil.copy(roles, cfg / "roles.yaml")
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    return cfg


@pytest.fixture()
def repo_config_dir(monkeypatch):
    """Point the config layer at the repo's real config/ directory."""
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(REPO_ROOT / "config"))
    return REPO_ROOT / "config"
