"""Role → access resolution (Component 3, Option A).

Role *assignment* is authoritative in the validated Entra JWT: the token's
``roles`` claim names the internal roles the caller may assume. The
``X-Iblai-Role`` header is only a selector for which granted role is active on a
request (see :func:`permitted_roles`); it cannot grant a role the token lacks.
This module answers "given a role, what can the user access?" by resolving it
against ``roles.yaml``. Django-free.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from typing import Iterable, Optional

from iblai_ontology.config.reader import ConfigReader

DEFAULT_ROLE = "default"


class RoleNotPermitted(Exception):
    """Raised when a request asks for a role its validated token does not grant."""

    def __init__(self, requested: str):
        super().__init__(f"role '{requested}' is not granted to this identity")
        self.requested = requested


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

    def role_names(self) -> list[str]:
        """Return the internal role names defined in ``roles.yaml``."""
        return list(self._roles().keys())

    def resolve(
        self, role: Optional[str], *, user_emplid: Optional[str] = None
    ) -> Permissions:
        roles = self._roles()
        # Fall back to the default role for unknown/missing roles.
        if not role or role not in roles:
            role = DEFAULT_ROLE
        spec = roles.get(role, {})

        memory_paths = list(spec.get("memory_paths", []))
        if user_emplid is not None:
            memory_paths = [
                p.replace("${USER_EMPLID}", user_emplid) for p in memory_paths
            ]

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


def resolve_permissions(
    role: Optional[str], *, user_emplid: Optional[str] = None
) -> Permissions:
    """Convenience wrapper around :class:`RoleResolver`."""
    return RoleResolver().resolve(role, user_emplid=user_emplid)


def permitted_roles(claimed_roles: Iterable[str], resolver: RoleResolver) -> set[str]:
    """Internal roles a validated identity may assume.

    Intersects the token's ``roles`` claim with the roles defined in
    ``roles.yaml`` (claims that name no defined role are ignored) and always
    includes :data:`DEFAULT_ROLE`, which every authenticated caller holds.
    """
    defined = set(resolver.role_names())
    allowed = {role for role in claimed_roles if role in defined}
    allowed.add(DEFAULT_ROLE)
    return allowed


def select_active_role(
    claimed_roles: Iterable[str], requested: Optional[str], resolver: RoleResolver
) -> str:
    """Choose the active role for a request from the token's granted roles.

    ``requested`` is the client-supplied ``X-Iblai-Role`` selector. With no
    selector the caller runs as :data:`DEFAULT_ROLE`; a selector is honoured only
    when the token grants it, otherwise :class:`RoleNotPermitted` is raised. The
    selector can never widen access beyond the token's :func:`permitted_roles`.
    """
    if not requested:
        return DEFAULT_ROLE
    if requested not in permitted_roles(claimed_roles, resolver):
        raise RoleNotPermitted(requested)
    return requested
