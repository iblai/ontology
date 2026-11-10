"""Read and render configuration files (with secret redaction)."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

from iblai_ontology.config import config_dir, dm_store

# Keys whose values are secrets and must be redacted when displayed.
_SECRET_KEY_RE = re.compile(
    r"(password|secret|api_key|api-key|token|client_secret|key)$", re.IGNORECASE
)
_REDACTED = "********"

# ``${VAR}`` interpolation from the environment at load time.
_ENV_TOKEN_RE = re.compile(r"\$\{([A-Z0-9_]+)\}")

# Raw text, as the Configuration page shows a file (the same rules as its config-files.ts).
_SECRET_LINE_KEY_RE = re.compile(
    r"(password|passwd|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key"
    r"|credential|auth)",
    re.IGNORECASE,
)
_KEY_VALUE_RE = re.compile(r"^(\s*-?\s*)([A-Za-z0-9_.-]+)(\s*[:=]\s*)(.+)$")
_ENV_REF_RE = re.compile(r"^\s*\$\{[A-Z0-9_]+\}\s*$")
_URL_PASSWORD_RE = re.compile(r"(://[^/\s:@]*:)([^@\s/]+)(@)")
MASK = "••••••••"


def mask_secrets(text: str) -> str:
    """Raw config text with every credential-looking ``key: value`` / ``key=value`` value
    and every password inside a URL masked; a ``${VAR}`` reference is not a secret and stays."""

    def url(match: re.Match) -> str:
        if _ENV_REF_RE.match(match[2]):
            return match[0]
        return f"{match[1]}{MASK}{match[3]}"

    lines = []
    for line in text.split("\n"):
        found = _KEY_VALUE_RE.match(line)
        if found and _SECRET_LINE_KEY_RE.search(found[2]):
            value = found[4].strip()
            if value and not _ENV_REF_RE.match(value) and value not in ("null", "~"):
                line = f"{found[1]}{found[2]}{found[3]}{MASK}"
        lines.append(_URL_PASSWORD_RE.sub(url, line))
    return "\n".join(lines)


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        return _ENV_TOKEN_RE.sub(
            lambda m: os.environ.get(m.group(1), m.group(0)), value
        )
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    return value


def _redact(value: Any, key: str | None = None) -> Any:
    if key is not None and _SECRET_KEY_RE.search(key) and value not in (None, ""):
        return _REDACTED
    if isinstance(value, dict):
        return {k: _redact(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


class ConfigReader:
    """Reads the YAML config files under the active config directory."""

    def __init__(self, directory: str | Path | None = None) -> None:
        self.dir = Path(directory) if directory else config_dir()

    # -- low-level -------------------------------------------------------
    def _path(self, filename: str) -> Path:
        return self.dir / filename

    def _load(self, filename: str, *, expand: bool = True) -> dict[str, Any]:
        path = self._path(filename)
        if not path.exists():
            return {}
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return _expand_env(data) if expand else data

    # -- main config -----------------------------------------------------
    def main(self) -> dict[str, Any]:
        return self._load("ontology.yaml")

    def get_section(self, section: str) -> str:
        data = self.main().get(section, {})
        return yaml.dump(
            _redact({section: data}), default_flow_style=False, sort_keys=False
        )

    @staticmethod
    def _in_platform() -> dict[str, Any]:
        """What dm mode keeps in the ibl.ai platform, in the shape of the three files."""
        from iblai_ontology.backend import bootstrap

        bootstrap()
        from iblai_ontology.backend.identity import role_source
        from iblai_ontology.backend.services.registry import export_services_yaml
        from iblai_ontology.backend.sync import schedules

        return {
            "roles": {"roles": role_source.load_roles()},
            "sync_schedules": {"schedules": schedules.all()},
            "services": yaml.safe_load(export_services_yaml()),
        }

    def show_all(self, *, redact: bool = True) -> str:
        if dm_store():
            stored = self._in_platform()
        else:
            stored = {
                "roles": self._load("roles.yaml"),
                "sync_schedules": self._load("sync-schedules.yaml"),
                "services": self._load("services.yaml"),
            }
        merged = {
            "ontology": self.main(),
            "tools": self._load_tools_docs(),
            **stored,
        }
        if redact:
            merged = _redact(merged)
        return yaml.dump(merged, default_flow_style=False, sort_keys=False)

    # -- roles -----------------------------------------------------------
    def get_roles(self) -> dict[str, Any]:
        return self._load("roles.yaml").get("roles", {})

    # -- sync schedules --------------------------------------------------
    def get_sync_schedules(self) -> list[dict[str, Any]]:
        return self._load("sync-schedules.yaml").get("schedules", [])

    # -- tools (tools.yaml is multi-document) ----------------------------
    def _load_tools_docs(self) -> list[dict[str, Any]]:
        path = self._path("tools.yaml")
        if not path.exists():
            return []
        with open(path) as f:
            docs = [d for d in yaml.safe_load_all(f) if d]
        return [_expand_env(d) for d in docs]

    def get_tools(self) -> list[dict[str, Any]]:
        return [d for d in self._load_tools_docs() if d.get("kind") == "tool"]

    def get_toolsets(self) -> dict[str, dict[str, Any]]:
        return {
            d["name"]: d for d in self._load_tools_docs() if d.get("kind") == "toolset"
        }

    def get_sources(self) -> list[dict[str, Any]]:
        return [d for d in self._load_tools_docs() if d.get("kind") == "source"]

    # -- services --------------------------------------------------------
    def get_services(self) -> list[dict[str, Any]]:
        return self._load("services.yaml").get("services", [])
