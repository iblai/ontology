"""Toolset resolution and role scoping for the MCP outbound server (Component 4)."""

from __future__ import annotations

from dataclasses import dataclass, field

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.config.reader import ConfigReader


@dataclass
class ScopedTools:
    toolsets: list[str] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)


class ToolsetResolver:
    """Resolves which tools a caller may see/call given their role permissions."""

    def __init__(self, reader: ConfigReader | None = None) -> None:
        self.reader = reader or ConfigReader()

    def scope_for(self, permissions: Permissions) -> ScopedTools:
        """Return the tools/toolsets the permissions allow (honours '*')."""
        all_toolsets = self.reader.get_toolsets()
        if "*" in permissions.mcp_toolsets:
            allowed = list(all_toolsets.keys())
        else:
            allowed = [t for t in permissions.mcp_toolsets if t in all_toolsets]

        tool_names: list[str] = []
        for name in allowed:
            tool_names.extend(all_toolsets[name].get("tools", []))
        # de-dupe, preserve order
        seen: set[str] = set()
        ordered = [t for t in tool_names if not (t in seen or seen.add(t))]
        return ScopedTools(toolsets=allowed, tool_names=ordered)

    def tool_specs(self, permissions: Permissions) -> list[dict]:
        """Return full tool specs (name/description/parameters) the caller may use."""
        scoped = set(self.scope_for(permissions).tool_names)
        return [t for t in self.reader.get_tools() if t.get("name") in scoped]
