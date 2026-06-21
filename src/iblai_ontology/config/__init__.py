"""Django-free configuration layer for iblai-ontology.

This package reads, writes, validates, and scaffolds the YAML config files that
drive the whole system:

    ontology.yaml         main config (LLM BYOK, paths, …)
    tools.yaml            MCP Toolbox tools + toolsets
    roles.yaml            role → access mapping (Component 3)
    sync-schedules.yaml   sync cadences (Component 2)
    services.yaml         service registry (Component 5)

All files live under the directory returned by :func:`config_dir` — the
``ONTOLOGY_CONFIG_DIR`` env var, or ``./config`` by default.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_CONFIG_DIRNAME = "config"


def config_dir() -> Path:
    """Return the active config directory (``ONTOLOGY_CONFIG_DIR`` or ./config)."""
    return Path(os.environ.get("ONTOLOGY_CONFIG_DIR", DEFAULT_CONFIG_DIRNAME))


# Default LLM models per provider (BYOK — only the default when a provider is
# chosen; the user always supplies their own key).
LLM_DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o",
}
