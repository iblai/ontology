"""Parse a SKILL.md into a discovery seed.

A SKILL.md (from iblai/higher-education-agents or iblai/enterprise-agents) carries
everything needed to bootstrap a service without first connecting to it:

  * frontmatter — name, description, required env vars (the connection shape)
  * a "## Key operations" section — the endpoints, which become suggested tools

``parse_skill`` turns that into a :class:`DiscoverySeed`; ``load_skill`` accepts a
vendored skill name, a local path, or a URL.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

from iblai_ontology.catalog import skills_dir

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
# Matches "- `GET /path` — description" or "... - description" (em dash or hyphen).
_OP_RE = re.compile(r"^[-*]\s*`([A-Z]+)\s+([^`]+)`\s*[—\-:]*\s*(.*)$")
# Fallback for non-REST APIs (e.g. Bloomberg BLPAPI, RPC, GraphQL) whose
# operations are named request types rather than `METHOD /path`. These are
# query/data-fetch operations, so they're treated as read-only (GET-equivalent).
_NAMED_OP_RE = re.compile(r"^[-*]\s*`([A-Za-z][A-Za-z0-9_]*)`.*?[—\-:]\s*(.*)$")


@dataclass
class Operation:
    method: str
    path: str
    description: str

    @property
    def read_only(self) -> bool:
        return self.method.upper() == "GET"


@dataclass
class DiscoverySeed:
    name: str
    description: str
    env: list[str] = field(default_factory=list)
    primary_env: Optional[str] = None
    operations: list[Operation] = field(default_factory=list)

    @property
    def read_operations(self) -> list[Operation]:
        return [o for o in self.operations if o.read_only]

    def suggested_tools(self, *, read_only: bool = True) -> list[dict]:
        """Derive MCP tool stubs from the (read-only) operations."""
        ops = self.read_operations if read_only else self.operations
        tools = []
        for op in ops:
            tools.append(
                {
                    "name": _tool_name(self.name, op),
                    "method": op.method,
                    "path": op.path,
                    "description": op.description,
                }
            )
        return tools


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _tool_name(service: str, op: Operation) -> str:
    # e.g. GET /api/v1/courses/:id/assignments -> get-courses-assignments
    parts = [
        p
        for p in op.path.split("/")
        if p
        and not p.startswith((":", "{"))
        and p not in ("api", "v1", "v2", "rest", "v3", "services", "data")
    ]
    tail = "-".join(parts[-2:]) if parts else "root"
    return _slug(f"{op.method}-{tail}")


def _section(markdown: str, heading: str) -> str:
    """Return the body of a '## <heading>' section."""
    lines = markdown.splitlines()
    out: list[str] = []
    capturing = False
    for line in lines:
        if line.startswith("## "):
            capturing = line[3:].strip().lower().startswith(heading.lower())
            continue
        if capturing:
            out.append(line)
    return "\n".join(out)


def parse_skill(markdown: str) -> DiscoverySeed:
    """Parse SKILL.md text into a DiscoverySeed."""
    fm_match = _FRONTMATTER_RE.match(markdown)
    name = "service"
    description = ""
    env: list[str] = []
    primary_env: Optional[str] = None
    if fm_match:
        fm = yaml.safe_load(fm_match.group(1)) or {}
        name = fm.get("name", name)
        description = fm.get("description", "")
        meta = fm.get("metadata")
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = {}
        meta = meta or {}
        env = list(((meta.get("openclaw") or {}).get("requires") or {}).get("env", []))
        primary_env = meta.get("primaryEnv")

    operations: list[Operation] = []
    for line in _section(markdown, "Key operations").splitlines():
        line = line.strip()
        m = _OP_RE.match(line)
        if m:
            operations.append(
                Operation(m.group(1), m.group(2).strip(), m.group(3).strip())
            )
            continue
        named = _NAMED_OP_RE.match(line)
        if named:
            operations.append(
                Operation("GET", named.group(1).strip(), named.group(2).strip())
            )

    return DiscoverySeed(
        name=name,
        description=description,
        env=env,
        primary_env=primary_env,
        operations=operations,
    )


def load_skill(ref: str) -> DiscoverySeed:
    """Load a skill from a vendored name, a local path, or a URL."""
    # Vendored catalog skill name (e.g. "canvas").
    vendored = skills_dir() / f"{ref}.md"
    if vendored.exists():
        return parse_skill(vendored.read_text())
    # Local path.
    path = Path(ref)
    if path.exists():
        return parse_skill(path.read_text())
    # URL.
    if ref.startswith(("http://", "https://")):
        import httpx

        resp = httpx.get(ref, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        return parse_skill(resp.text)
    raise FileNotFoundError(
        f"could not resolve skill '{ref}' as a vendored name, path, or URL"
    )


def list_vendored() -> list[str]:
    """Names of the vendored skills (without .md)."""
    return sorted(p.stem for p in skills_dir().glob("*.md"))
