"""The server install: deploy/install.sh, deploy/compose.yaml and the release workflow agree."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = (ROOT / "deploy" / "compose.yaml").read_text()
SCRIPT = (ROOT / "deploy" / "install.sh").read_text()
IMAGE = "ghcr.io/iblai/ontology"


def test_the_env_file_holds_exactly_what_compose_requires():
    used = set(re.findall(r"\$\{([A-Z_]+)", COMPOSE))
    required = set(re.findall(r"\$\{([A-Z_]+):\?", COMPOSE))
    # Every setting stops compose with its name when it is missing.
    assert used == required
    env_file = SCRIPT.split('cat >"$DIR/.env" <<EOF\n')[1].split("\nEOF\n")[0]
    written = set(re.findall(r"^([A-Z_]+)=", env_file, re.MULTILINE))
    assert written == required


def test_the_store_is_asked_of_the_platform_and_kept_through_an_upgrade():
    # The platform's answer about its records says where the settings live; nothing is guessed.
    assert "200)\n      STORE=dm\n" in SCRIPT and "404)\n      STORE=rbac\n" in SCRIPT
    # An upgrade reads it back from .env, which compose requires it in.
    assert "STORE=$(kept ONTOLOGY_DATA_STORE)" in SCRIPT
    assert "ONTOLOGY_DATA_STORE: ${ONTOLOGY_DATA_STORE:?missing in .env}" in COMPOSE


def test_compose_runs_the_one_image_behind_the_proxy_alone():
    services = yaml.safe_load(COMPOSE)["services"]
    ours = {name for name, service in services.items() if IMAGE in service["image"]}
    assert ours == {"migrate", "ontology-gateway", "sync-engine"}
    assert set(services) - ours == {"ontology-db", "redis", "vector-store", "proxy"}
    assert [name for name, service in services.items() if "ports" in service] == [
        "proxy"
    ]
    # The worker writes the memory files; the gateway only reads them.
    assert "memory:/ontology:ro" in services["ontology-gateway"]["volumes"]
    assert "memory:/ontology" in services["sync-engine"]["volumes"]
    # Both reach the platform with the same settings, and queue on the same broker.
    gateway, worker = (
        services[name]["environment"] for name in ("ontology-gateway", "sync-engine")
    )
    assert worker.items() <= gateway.items()
    assert worker["ONTOLOGY_CELERY_BROKER"] == "redis://redis:6379/0"
    assert gateway["ONTOLOGY_GATEWAY_URL"].endswith("/mcp")


def test_the_release_stamps_match_what_the_files_hold():
    workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text()
    assert 'VERSION="dev"\n' in SCRIPT
    assert 's/^VERSION=\\"dev\\"$/' in workflow
    assert COMPOSE.count(f"image: {IMAGE}:dev\n") == 1
    assert "s|$IMAGE:dev|" in workflow and f"IMAGE: {IMAGE}\n" in workflow


def test_the_starting_config_offers_no_tool_that_cannot_run():
    tools = (ROOT / "deploy" / "config" / "tools.yaml").read_text()
    assert [doc for doc in yaml.safe_load_all(tools) if doc] == []
