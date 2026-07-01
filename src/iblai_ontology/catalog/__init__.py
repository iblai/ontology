"""Built-in service catalog.

Ships sensible defaults (connection shape, adapter, default toolset, sync
cadences, and the upstream SKILL.md) for common higher-education systems, so
``ontology service add --from <key>`` and ``ontology catalog show <key>`` work
out of the box. The vendored skill files live in ``catalog/skills/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml

_CATALOG_DIR = Path(__file__).resolve().parent
_SKILLS_DIR = _CATALOG_DIR / "skills"

# Each skill is vendored from one of the ibl.ai agent-skill repos.
_DOMAIN_REPO = {
    "higher-ed": "iblai/higher-education-agents",
    "enterprise": "iblai/enterprise-agents",
    "k-12": "iblai/k-12-agents",
    "government": "iblai/government-agents",
    "legal": "iblai/legal-agents",
    "financial-services": "iblai/financial-services-agents",
    "medical-healthcare": "iblai/medical-healthcare-agents",
}
_SKILL_URL = "https://github.com/{repo}/blob/main/skills/{name}/SKILL.md"


@dataclass
class CatalogEntry:
    key: str
    display_name: str
    type: str  # "database" | "api"
    adapter: str
    domain: str = "higher-ed"  # "higher-ed" | "enterprise"
    env: list[str] = field(default_factory=list)
    connection: dict = field(default_factory=dict)
    default_toolset: str = ""
    sync_defaults: dict = field(default_factory=dict)
    summary: str = ""
    skill: Optional[str] = None  # vendored skill filename

    @property
    def skill_path(self) -> Optional[Path]:
        if not self.skill:
            return None
        path = _SKILLS_DIR / self.skill
        return path if path.exists() else None

    @property
    def skill_url(self) -> Optional[str]:
        if not self.skill:
            return None
        repo = _DOMAIN_REPO.get(self.domain, _DOMAIN_REPO["higher-ed"])
        return _SKILL_URL.format(repo=repo, name=self.skill.removesuffix(".md"))


@lru_cache(maxsize=1)
def _load() -> dict[str, CatalogEntry]:
    data = yaml.safe_load((_CATALOG_DIR / "catalog.yaml").read_text()) or {}
    entries = {}
    for key, spec in (data.get("entries") or {}).items():
        entries[key] = CatalogEntry(key=key, **spec)
    return entries


def list_entries() -> list[CatalogEntry]:
    """All catalog entries, sorted by key."""
    return [_load()[k] for k in sorted(_load())]


def get_entry(key: str) -> CatalogEntry:
    """Return one catalog entry or raise KeyError."""
    entries = _load()
    if key not in entries:
        raise KeyError(f"unknown catalog entry: {key}. Known: {', '.join(sorted(entries))}")
    return entries[key]


def skills_dir() -> Path:
    return _SKILLS_DIR
