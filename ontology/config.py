"""Load and validate an Ontology registry from a YAML (or JSON) config file.

Environment variables in ``${VAR}`` form are expanded so secrets such as EFS
IDs or NFS hostnames can stay out of version control.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .models import (
    AccessMode,
    Filesystem,
    FilesystemType,
    Permission,
    Registry,
    Sandbox,
)

try:  # PyYAML is optional; JSON configs work without it.
    import yaml
except ImportError:  # pragma: no cover - exercised only without PyYAML
    yaml = None


class ConfigError(Exception):
    """Raised when a registry config is malformed or fails validation."""


_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        return _ENV_PATTERN.sub(lambda m: os.environ.get(m.group(1), ""), value)
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    return value


def _parse_filesystem(raw: dict[str, Any]) -> Filesystem:
    try:
        fs_type = FilesystemType(raw["type"])
    except KeyError as exc:
        raise ConfigError(f"filesystem {raw.get('id', '?')!r} is missing 'type'") from exc
    except ValueError as exc:
        raise ConfigError(
            f"filesystem {raw.get('id', '?')!r} has unknown type {raw.get('type')!r} "
            f"(expected 'efs' or 'nfs')"
        ) from exc
    return Filesystem(
        id=raw.get("id", ""),
        type=fs_type,
        name=raw.get("name", ""),
        root=raw.get("root", "/"),
        options=list(raw.get("options", [])),
        file_system_id=raw.get("file_system_id"),
        region=raw.get("region"),
        access_point=raw.get("access_point"),
        transit_encryption=raw.get("transit_encryption", True),
        server=raw.get("server"),
        export=raw.get("export"),
    )


def _parse_permission(raw: dict[str, Any]) -> Permission:
    try:
        access = AccessMode(raw.get("access", "ro"))
    except ValueError as exc:
        raise ConfigError(
            f"permission for {raw.get('filesystem')!r} has unknown access "
            f"{raw.get('access')!r} (expected 'ro' or 'rw')"
        ) from exc
    sandboxes = raw.get("sandboxes", ["*"])
    if isinstance(sandboxes, str):
        sandboxes = [sandboxes]
    try:
        filesystem = raw["filesystem"]
        mount_path = raw["mount_path"]
    except KeyError as exc:
        raise ConfigError(f"permission is missing required key {exc.args[0]!r}") from exc
    return Permission(
        filesystem=filesystem,
        mount_path=mount_path,
        access=access,
        sandboxes=list(sandboxes),
        uid=raw.get("uid"),
        gid=raw.get("gid"),
    )


def parse_registry(data: dict[str, Any]) -> Registry:
    """Build (and validate) a ``Registry`` from an already-parsed mapping."""
    if not isinstance(data, dict):
        raise ConfigError("registry config must be a mapping at the top level")
    data = _expand_env(data)

    registry = Registry(
        version=str(data.get("version", "1")),
        filesystems=[_parse_filesystem(f) for f in data.get("filesystems", [])],
        permissions=[_parse_permission(p) for p in data.get("permissions", [])],
        sandboxes=[
            Sandbox(
                id=s["id"],
                runtime=s.get("runtime", "openclaw"),
                description=s.get("description", ""),
            )
            for s in data.get("sandboxes", [])
        ],
    )

    errors = registry.validate()
    if errors:
        raise ConfigError("invalid registry:\n  - " + "\n  - ".join(errors))
    return registry


def load_registry(path: str | Path) -> Registry:
    """Load a registry from a ``.yaml`` / ``.yml`` / ``.json`` file."""
    path = Path(path)
    if not path.exists():
        raise ConfigError(f"config file not found: {path}")
    text = path.read_text()

    if path.suffix in {".yaml", ".yml"}:
        if yaml is None:
            raise ConfigError(
                "PyYAML is required to read YAML configs — install with "
                "'pip install ontology-fs[yaml]' or use a .json config"
            )
        data = yaml.safe_load(text) or {}
    elif path.suffix == ".json":
        data = json.loads(text)
    else:
        raise ConfigError(f"unsupported config extension: {path.suffix}")

    return parse_registry(data)
