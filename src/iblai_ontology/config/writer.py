"""Write configuration values into ontology.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from iblai_ontology.config import LLM_DEFAULT_MODELS, config_dir


def _coerce(value: str) -> Any:
    """Best-effort scalar coercion for CLI-provided string values."""
    low = value.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "none", ""):
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


class ConfigWriter:
    """Mutates ontology.yaml via dot-notation keys."""

    def __init__(self, directory: str | Path | None = None) -> None:
        self.dir = Path(directory) if directory else config_dir()
        self.path = self.dir / "ontology.yaml"

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        with open(self.path) as f:
            return yaml.safe_load(f) or {}

    def _save(self, data: dict[str, Any]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    def set(self, key: str, value: Any, *, coerce: bool = True) -> None:
        """Set a dot-notation key, e.g. ``llm.provider``."""
        if coerce and isinstance(value, str):
            value = _coerce(value)
        data = self._load()
        node = data
        parts = key.split(".")
        for part in parts[:-1]:
            existing = node.get(part)
            if not isinstance(existing, dict):
                existing = {}
                node[part] = existing
            node = existing
        node[parts[-1]] = value
        self._save(data)

    def set_llm(
        self,
        *,
        provider: str,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Configure the LLM block, defaulting the model per provider (iblai needs no key)."""
        resolved_model = model or LLM_DEFAULT_MODELS.get(provider)
        data = self._load()
        data.setdefault("llm", {})
        data["llm"].update({"provider": provider, "model": resolved_model})
        if api_key is not None:
            data["llm"]["api_key"] = api_key
        if base_url is not None:
            data["llm"]["base_url"] = base_url
        data["llm"].setdefault("max_tokens", 4096)
        data["llm"].setdefault("temperature", 0.2)
        self._save(data)


# -- roles.yaml / sync-schedules.yaml, read raw so ``${VAR}`` survives a rewrite --


def _dir(directory: str | Path | None) -> Path:
    return Path(directory) if directory else config_dir()


def _raw_load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def _raw_dump(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)


def load_roles(directory: str | Path | None = None) -> dict[str, dict[str, Any]]:
    """The ``roles:`` mapping of roles.yaml, unexpanded."""
    return _raw_load(_dir(directory) / "roles.yaml").get("roles") or {}


def put_role(
    name: str, spec: dict[str, Any], directory: str | Path | None = None
) -> None:
    """Create or replace one role (structured writes drop YAML comments)."""
    path = _dir(directory) / "roles.yaml"
    data = _raw_load(path)
    roles = data.get("roles") or {}
    roles[name] = spec
    data["roles"] = roles
    _raw_dump(path, data)


def delete_role(name: str, directory: str | Path | None = None) -> bool:
    path = _dir(directory) / "roles.yaml"
    data = _raw_load(path)
    roles = data.get("roles") or {}
    if name not in roles:
        return False
    del roles[name]
    data["roles"] = roles
    _raw_dump(path, data)
    return True


def delete_schedule(name: str, directory: str | Path | None = None) -> bool:
    path = _dir(directory) / "sync-schedules.yaml"
    data = _raw_load(path)
    schedules = data.get("schedules") or []
    rest = [s for s in schedules if s.get("name") != name]
    if len(rest) == len(schedules):
        return False
    data["schedules"] = rest
    _raw_dump(path, data)
    return True
