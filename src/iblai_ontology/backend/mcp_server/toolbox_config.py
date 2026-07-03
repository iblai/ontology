"""Generate a Google MCP Toolbox native config from the ontology tools DSL.

The ontology authors sources/tools/toolsets in ``config/tools.yaml`` as a
multi-document DSL (``kind: source|tool|toolset`` documents, each with a
``name`` and a ``type``). The real Google MCP Toolbox
(github.com/googleapis/mcp-toolbox) instead expects a **single** document with
top-level ``sources``, ``tools`` and ``toolsets`` **maps** keyed by name, where
each entry carries a ``kind`` field. This module translates the former into the
latter so the Toolbox container can consume it.

``${VAR}`` tokens are preserved verbatim (not expanded) so secrets stay out of
the generated artifact — the Toolbox expands them from its own environment
(``.env.mcp``) at load time.

Tools whose ``statement`` uses ``${...}`` raw injection (e.g. an arbitrary-SQL
passthrough like ``statement: ${sql}``) cannot be expressed as a Toolbox
parameterized query. They are reported as *native* tools — served directly by
the gateway, not the Toolbox — and are omitted from the generated config and
from any toolset that referenced them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# A ``${name}`` token inside a tool statement means raw text injection, which the
# Toolbox (which binds parameters positionally as $1, $2, ...) cannot represent.
_INJECTION_RE = re.compile(r"\$\{[A-Za-z0-9_]+\}")

# DSL keys that are consumed by the translation itself rather than copied through.
_DROP_KEYS = {"kind", "name", "type"}

# Per-source-kind field renames: the DSL uses a uniform ``database`` field, but
# some Toolbox source kinds name it differently (Oracle uses ``serviceName``).
_SOURCE_FIELD_RENAMES: dict[str, dict[str, str]] = {
    "oracle": {"database": "serviceName"},
}


@dataclass
class ToolboxBuildResult:
    config: dict[str, Any]
    native_tools: list[str] = field(default_factory=list)  # ${...} tools served by the gateway
    sources: int = 0
    tools: int = 0
    toolsets: int = 0


def _load_raw_docs(tools_path: Path) -> list[dict[str, Any]]:
    """Load the multi-document DSL WITHOUT env expansion (keep ${VAR} tokens)."""
    with open(tools_path) as f:
        return [d for d in yaml.safe_load_all(f) if d]


def _passthrough(doc: dict[str, Any]) -> dict[str, Any]:
    """Map a DSL doc to a Toolbox entry: ``type`` -> ``kind``, drop meta keys."""
    entry: dict[str, Any] = {"kind": doc.get("type")}
    entry.update({k: v for k, v in doc.items() if k not in _DROP_KEYS})
    return entry


def _source_entry(doc: dict[str, Any]) -> dict[str, Any]:
    """Build a Toolbox source entry, applying per-kind field renames."""
    entry = _passthrough(doc)
    renames = _SOURCE_FIELD_RENAMES.get(doc.get("type", ""), {})
    for old, new in renames.items():
        if old in entry:
            entry[new] = entry.pop(old)
    return entry


def build_toolbox_config(tools_path: str | Path) -> ToolboxBuildResult:
    """Translate the ontology tools DSL into a Toolbox-native config dict."""
    docs = _load_raw_docs(Path(tools_path))

    sources: dict[str, Any] = {}
    tools: dict[str, Any] = {}
    toolsets: dict[str, list[str]] = {}
    native: list[str] = []

    for doc in docs:
        kind = doc.get("kind")
        name = doc.get("name")
        if kind == "source":
            sources[name] = _source_entry(doc)
        elif kind == "tool":
            statement = doc.get("statement", "")
            if isinstance(statement, str) and _INJECTION_RE.search(statement):
                native.append(name)  # gateway-native; not representable in Toolbox
                continue
            tools[name] = _passthrough(doc)
        elif kind == "toolset":
            toolsets[name] = list(doc.get("tools", []) or [])

    # Never reference a native (omitted) tool from a generated toolset.
    native_set = set(native)
    toolsets = {
        ts: [t for t in members if t not in native_set] for ts, members in toolsets.items()
    }

    config = {"sources": sources, "tools": tools, "toolsets": toolsets}
    return ToolboxBuildResult(
        config=config,
        native_tools=native,
        sources=len(sources),
        tools=len(tools),
        toolsets=len(toolsets),
    )


def write_toolbox_config(tools_path: str | Path, dest: str | Path) -> ToolboxBuildResult:
    """Generate the Toolbox config and write it to ``dest`` (parents created)."""
    result = build_toolbox_config(tools_path)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w") as f:
        f.write("# GENERATED from config/tools.yaml by `ontology mcp build` — do not edit.\n")
        f.write("# Placeholder tokens are expanded by the Toolbox from its environment (.env.mcp).\n")
        yaml.safe_dump(result.config, f, default_flow_style=False, sort_keys=False)
    return result
