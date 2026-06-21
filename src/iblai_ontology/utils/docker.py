"""Docker Compose helpers for the deploy command group.

These shell out to ``docker compose``. They locate the compose file from the
``ONTOLOGY_COMPOSE_FILE`` env var or a ``docker-compose.yml`` in the cwd.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional


def _compose_file() -> Path:
    candidate = os.environ.get("ONTOLOGY_COMPOSE_FILE", "docker-compose.yml")
    path = Path(candidate)
    if not path.exists():
        raise FileNotFoundError(
            f"Compose file not found: {path}. Set ONTOLOGY_COMPOSE_FILE or run "
            "from a deployment directory."
        )
    return path


def _base_cmd() -> list[str]:
    if shutil.which("docker") is None:
        raise RuntimeError("`docker` is not installed or not on PATH.")
    return ["docker", "compose", "-f", str(_compose_file())]


def _run(args: list[str]) -> int:
    return subprocess.call(_base_cmd() + args)


def compose_up(*, detach: bool = True, build: bool = False) -> int:
    args = ["up"]
    if detach:
        args.append("-d")
    if build:
        args.append("--build")
    return _run(args)


def compose_down(*, remove_volumes: bool = False) -> int:
    args = ["down"]
    if remove_volumes:
        args.append("--volumes")
    return _run(args)


def compose_logs(*, service: Optional[str] = None, follow: bool = False, tail: int = 100) -> int:
    args = ["logs", f"--tail={tail}"]
    if follow:
        args.append("-f")
    if service:
        args.append(service)
    return _run(args)


def compose_restart(*, service: Optional[str] = None) -> int:
    args = ["restart"]
    if service:
        args.append(service)
    return _run(args)


def compose_ps() -> int:
    return _run(["ps"])
