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

The Toolbox refuses its whole file when one entry is wrong, so only what it can
load is written: a source no tool uses is left out, and ``service`` (whose key the
gateway adds to a system's ``http`` tool) is the gateway's word, not passed on.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# A ``${name}`` token inside a tool statement means raw text injection, which the
# Toolbox (which binds parameters positionally as $1, $2, ...) cannot represent.
_INJECTION_RE = re.compile(r"\$\{[A-Za-z0-9_]+\}")

# Tool types the gateway runs itself: an API system's named operations (services/twenty.py).
GATEWAY_TYPES = {"twenty"}

# DSL keys that are consumed by the translation itself rather than copied through.
_DROP_KEYS = {"kind", "name", "type", "service"}
# What the empty toolset that names a written file starts with (see write_toolbox_config).
MARK = "loaded-"

# Per-source-kind field renames: the DSL uses a uniform ``database`` field, but
# some Toolbox source kinds name it differently (Oracle uses ``serviceName``).
_SOURCE_FIELD_RENAMES: dict[str, dict[str, str]] = {
    "oracle": {"database": "serviceName"},
}


@dataclass
class ToolboxBuildResult:
    config: dict[str, Any]
    native_tools: list[str] = field(
        default_factory=list
    )  # ${...} tools served by the gateway
    sources: int = 0
    tools: int = 0
    toolsets: int = 0
    mark: str = (
        ""  # the toolset the Toolbox answers for once it has loaded the written file
    )


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
            if doc.get("type") in GATEWAY_TYPES or (
                isinstance(statement, str) and _INJECTION_RE.search(statement)
            ):
                native.append(name)  # gateway-native; not representable in Toolbox
                continue
            tools[name] = _passthrough(doc)
        elif kind == "toolset":
            toolsets[name] = list(doc.get("tools", []) or [])

    # Never reference a native (omitted) tool from a generated toolset; one left with
    # none (an API system's writes) is the gateway's alone and goes too.
    native_set = set(native)
    toolsets = {
        ts: kept
        for ts, members in toolsets.items()
        if (kept := [t for t in members if t not in native_set]) or not members
    }
    # A source no tool uses is of no use to the Toolbox, and one it cannot open stops it whole.
    used = {tool.get("source") for tool in tools.values()}
    sources = {name: source for name, source in sources.items() if name in used}

    config = {"sources": sources, "tools": tools, "toolsets": toolsets}
    return ToolboxBuildResult(
        config=config,
        native_tools=native,
        sources=len(sources),
        tools=len(tools),
        toolsets=len(toolsets),
    )


def write_toolbox_config(
    tools_path: str | Path, dest: str | Path
) -> ToolboxBuildResult:
    """Generate the Toolbox config and write it to ``dest`` (parents created).

    The file also holds one empty toolset named after a hash of its content
    (``result.mark``): the Toolbox answers for it only once it has loaded this very file.
    """
    result = build_toolbox_config(tools_path)
    # An empty map is left out: the Toolbox's reader was only seen with filled ones.
    config = {key: value for key, value in result.config.items() if value}
    body = yaml.safe_dump(config, default_flow_style=False, sort_keys=False)
    result.mark = MARK + hashlib.sha256(body.encode()).hexdigest()[:12]
    config["toolsets"] = {**config.get("toolsets", {}), result.mark: []}
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Written in place, not swapped in: a Toolbox that mounts this one file keeps seeing it.
    with open(dest, "w") as f:
        f.write(
            "# GENERATED from config/tools.yaml by `ontology mcp build` — do not edit.\n"
        )
        f.write(
            "# Placeholder tokens are expanded by the Toolbox from its environment (.env.mcp).\n"
        )
        yaml.safe_dump(config, f, default_flow_style=False, sort_keys=False)
    return result


def publish(tools_path: str | Path) -> ToolboxBuildResult:
    """Write the Toolbox's file where it watches for it: ``generated/toolbox.yaml`` beside tools.yaml."""
    tools_path = Path(tools_path)
    return write_toolbox_config(
        tools_path, tools_path.parent / "generated" / "toolbox.yaml"
    )
