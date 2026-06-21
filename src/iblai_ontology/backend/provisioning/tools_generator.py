"""Merge generated MCP tools into the live tools.yaml (Component 6.3)."""

from __future__ import annotations

from pathlib import Path

import yaml

from iblai_ontology.config import config_dir


class ToolsGenerator:
    """Appends a service's generated tool/source/toolset docs into tools.yaml."""

    def __init__(self, config_directory: str | Path | None = None) -> None:
        self.dir = Path(config_directory) if config_directory else config_dir()
        self.path = self.dir / "tools.yaml"

    def _existing_docs(self) -> list[dict]:
        if not self.path.exists():
            return []
        with open(self.path) as f:
            return [d for d in yaml.safe_load_all(f) if d]

    def merge(self, generated_tools_yaml: str) -> str:
        """Merge new docs by (kind, name); later docs win. Returns merged YAML."""
        existing = self._existing_docs()
        incoming = [d for d in yaml.safe_load_all(generated_tools_yaml) if d]
        index = {(d.get("kind"), d.get("name")): d for d in existing}
        for d in incoming:
            index[(d.get("kind"), d.get("name"))] = d
        merged = list(index.values())
        return yaml.dump_all(merged, default_flow_style=False, sort_keys=False)

    def apply(self, generated_tools_yaml: str) -> str:
        merged = self.merge(generated_tools_yaml)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(merged)
        return str(self.path)
