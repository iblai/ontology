"""Toolset resolution and role scoping for the MCP outbound server (Component 4)."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.toolbox_compat import writing_tools
from iblai_ontology.config.reader import ConfigReader


@dataclass
class ScopedTools:
    toolsets: list[str] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)


class ToolsetResolver:
    """Resolves which tools a caller may see/call given their role permissions.

    One resolver serves one request and reads tools.yaml once.
    """

    def __init__(self, reader: ConfigReader | None = None) -> None:
        self.reader = reader or ConfigReader()

    @cached_property
    def _toolsets(self) -> dict[str, dict]:
        return self.reader.get_toolsets()

    @cached_property
    def _tools(self) -> list[dict]:
        return self.reader.get_tools()

    @cached_property
    def writing(self) -> dict[str, str]:
        """The tools that can change data, each with why."""
        return writing_tools(self._tools)

    def spec(self, name: str) -> dict:
        """One tool's own document in tools.yaml; empty for a name it does not hold."""
        return next((t for t in self._tools if t.get("name") == name), {})

    def source(self, name: str) -> dict:
        """One source's own document in tools.yaml; empty for a name it does not hold."""
        sources = self.reader.get_sources()
        return next((s for s in sources if s.get("name") == name), {})

    def scope_for(self, permissions: Permissions) -> ScopedTools:
        """The toolsets and tools the permissions allow.

        ``*`` is every toolset that only reads: a toolset marked ``write`` counts only
        when the role names it, and only such a toolset lends a tool that can change data.
        A tool the role holds by its own name is lent as it is, whether it reads or changes.
        """
        all_toolsets = self._toolsets
        held = permissions.mcp_toolsets
        if "*" in held:
            allowed = [
                name
                for name, toolset in all_toolsets.items()
                if name in held or not toolset.get("write")
            ]
        else:
            allowed = [t for t in held if t in all_toolsets]

        tool_names: list[str] = []
        for name in allowed:
            lends_writes = all_toolsets[name].get("write") is True
            tool_names.extend(
                t
                for t in all_toolsets[name].get("tools") or []
                if lends_writes or t not in self.writing
            )
        known = {str(t.get("name")) for t in self._tools}
        tool_names.extend(t for t in permissions.mcp_tools if t in known)
        # de-dupe, preserve order
        seen: set[str] = set()
        ordered = [t for t in tool_names if not (t in seen or seen.add(t))]
        return ScopedTools(toolsets=allowed, tool_names=ordered)

    def level(self, permissions: Permissions) -> str:
        """How far the permissions reach: ``none``, ``read``, ``write`` or ``read_write``.

        Writing is a tool within reach that can change data; reading is one that cannot,
        or any memory path or cache table.
        """
        tools = self.scope_for(permissions).tool_names
        writes = any(t in self.writing for t in tools)
        reads = bool(
            permissions.memory_paths
            or permissions.cache_tables
            or any(t not in self.writing for t in tools)
        )
        if reads and writes:
            return "read_write"
        return "write" if writes else "read" if reads else "none"

    def tool_specs(self, permissions: Permissions) -> list[dict]:
        """Return full tool specs (name/description/parameters) the caller may use."""
        scoped = set(self.scope_for(permissions).tool_names)
        return [t for t in self._tools if t.get("name") in scoped]
