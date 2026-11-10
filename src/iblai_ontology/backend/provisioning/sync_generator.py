"""Merge generated sync schedules into the live ones (Component 6.4): sync-schedules.yaml,
or the ibl.ai platform in dm mode."""

from __future__ import annotations

from pathlib import Path

import yaml

from iblai_ontology.config import config_dir, dm_store


class SyncScheduleGenerator:
    """Merges a service's generated schedules into the live ones by name."""

    def __init__(self, config_directory: str | Path | None = None) -> None:
        self.dir = Path(config_directory) if config_directory else config_dir()
        self.path = self.dir / "sync-schedules.yaml"

    def _existing(self) -> list[dict]:
        if dm_store():
            from iblai_ontology.backend.sync import schedules

            return schedules.all()
        if not self.path.exists():
            return []
        with open(self.path) as f:
            data = yaml.safe_load(f) or {}
        return data.get("schedules", [])

    def merge(self, generated_sync_yaml: str) -> str:
        incoming = (yaml.safe_load(generated_sync_yaml) or {}).get("schedules", [])
        by_name = {s["name"]: s for s in self._existing()}
        for s in incoming:
            by_name[s["name"]] = s
        return yaml.dump(
            {"schedules": list(by_name.values())},
            default_flow_style=False,
            sort_keys=False,
        )

    def apply(self, generated_sync_yaml: str) -> str:
        if dm_store():
            from iblai_ontology.backend.sync import schedules

            incoming = (yaml.safe_load(generated_sync_yaml) or {}).get("schedules", [])
            for schedule in incoming:
                schedules.upsert(schedule)
            return "the ibl.ai platform"
        merged = self.merge(generated_sync_yaml)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(merged)
        return str(self.path)
