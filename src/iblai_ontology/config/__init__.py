"""Django-free configuration layer for iblai-ontology.

This package reads, writes, validates, and scaffolds the YAML config files that
drive the whole system:

    ontology.yaml         main config (LLM BYOK, paths, …)
    tools.yaml            MCP Toolbox tools + toolsets
    roles.yaml            role → access mapping (Component 3)
    sync-schedules.yaml   sync cadences (Component 2)
    services.yaml         connected services, for `ontology doctor` (Component 5)

With ``ONTOLOGY_DATA_STORE=dm`` the last three live in the ibl.ai platform instead
(:func:`dm_store`).

All files live under the directory returned by :func:`config_dir` — the
``ONTOLOGY_CONFIG_DIR`` env var, or ``./config`` by default.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

DEFAULT_CONFIG_DIRNAME = "config"


def config_dir() -> Path:
    """Return the active config directory (``ONTOLOGY_CONFIG_DIR`` or ./config)."""
    return Path(os.environ.get("ONTOLOGY_CONFIG_DIR", DEFAULT_CONFIG_DIRNAME))


def dm_store() -> bool:
    """Whether roles, sync schedules and the service registry live in the ibl.ai platform."""
    return os.environ.get("ONTOLOGY_DATA_STORE") == "dm"


# Default LLM models per provider (BYOK — only the default when a provider is
# chosen; the user supplies their own key). "iblai" is the DM's OpenAI-compatible
# endpoint behind the platform credentials, no key of its own.
LLM_DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o",
    "iblai": "iblai/iblai-pro",
}


def credential_key(environ: Mapping[str, str] = os.environ) -> str | None:
    """The registry's Fernet key: ``ONTOLOGY_CREDENTIAL_KEY``, else the file named by
    ``ONTOLOGY_CREDENTIAL_KEY_FILE`` (a Compose secret); a set but unreadable path raises."""
    key = environ.get("ONTOLOGY_CREDENTIAL_KEY")
    if key:
        return key
    path = environ.get("ONTOLOGY_CREDENTIAL_KEY_FILE")
    return Path(path).read_text().strip() if path else None
