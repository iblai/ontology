"""Role → access resolution (Component 3, Option A).

Role *assignment* lives in the ibl.ai platform (forwarded via the
``X-Iblai-Role`` header). This module only answers "given this role, what can the
user access?" by resolving the role against ``roles.yaml``. Django-free.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from typing import Optional

from iblai_ontology.config.reader import ConfigReader

DEFAULT_ROLE = "default"


@dataclass
class Permissions:
    role: str
    display_name: str
    memory_paths: list[str] = field(default_factory=list)
    mcp_toolsets: list[str] = field(default_factory=list)
    cache_tables: list[str] = field(default_factory=list)
    concurrency_limits: dict = field(default_factory=dict)
    agents: list[str] = field(default_factory=list)
    admin_dashboard: bool = False

    def allows_toolset(self, toolset: str) -> bool:
        return "*" in self.mcp_toolsets or toolset in self.mcp_toolsets

    def allows_cache_table(self, table: str) -> bool:
        return "*" in self.cache_tables or table in self.cache_tables

    def allows_memory_path(self, path: str) -> bool:
        return any(fnmatch.fnmatch(path, pattern) for pattern in self.memory_paths)


class RoleResolver:
    """Resolves a role name to a concrete :class:`Permissions`."""

    def __init__(self, reader: Optional[ConfigReader] = None) -> None:
        self.reader = reader or ConfigReader()

    def _roles(self) -> dict:
        return self.reader.get_roles()

    def resolve(self, role: Optional[str], *, user_emplid: Optional[str] = None) -> Permissions:
        roles = self._roles()
        # Fall back to the default role for unknown/missing roles.
        if not role or role not in roles:
            role = DEFAULT_ROLE
        spec = roles.get(role, {})

        memory_paths = list(spec.get("memory_paths", []))
        if user_emplid is not None:
            memory_paths = [p.replace("${USER_EMPLID}", user_emplid) for p in memory_paths]

        return Permissions(
            role=role,
            display_name=spec.get("display_name", role),
            memory_paths=memory_paths,
            mcp_toolsets=list(spec.get("mcp_toolsets", [])),
            cache_tables=list(spec.get("cache_tables", [])),
            concurrency_limits=dict(spec.get("concurrency_limits", {})),
            agents=list(spec.get("agents", [])),
            admin_dashboard=bool(spec.get("admin_dashboard", False)),
        )


def resolve_permissions(role: Optional[str], *, user_emplid: Optional[str] = None) -> Permissions:
    """Convenience wrapper around :class:`RoleResolver`."""
    return RoleResolver().resolve(role, user_emplid=user_emplid)
