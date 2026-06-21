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

    def set_llm(self, *, provider: str, api_key: str, model: str | None = None) -> None:
        """Configure the BYOK LLM block, defaulting the model per provider."""
        resolved_model = model or LLM_DEFAULT_MODELS.get(provider)
        data = self._load()
        data.setdefault("llm", {})
        data["llm"].update(
            {
                "provider": provider,
                "api_key": api_key,
                "model": resolved_model,
            }
        )
        data["llm"].setdefault("max_tokens", 4096)
        data["llm"].setdefault("temperature", 0.2)
        self._save(data)
