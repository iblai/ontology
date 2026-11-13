"""Where roles come from: roles.yaml on this host, or the ibl.ai platform (rbac and dm).

There a role is one of the platform's own RBAC roles that holds an ``Ontology/…`` verb. What
it reaches is the resources of its one policy, ``Ontology: <role>``, under ``/custom/ontology/``
(the platform's namespace for a client's own verbs); no other policy is read or written. What
a role holds besides grants (display name, agents, limits) is an ontology record of kind
``role``: the platform's in dm, this host's own in rbac. A spec keeps the shape roles.yaml has
and is stored and read as written: ``${VAR}`` is expanded for the file only, and roles.yaml
itself is never opened there.
"""

from __future__ import annotations

import fnmatch
import logging
import re
import time
from typing import Any

from iblai_ontology.backend.identity.roles import DEFAULT_ROLE, RolesUnavailable
from iblai_ontology.config import platform_roles

logger = logging.getLogger(__name__)

CACHE_KEY = "ontology:roles"
ROOT = "/custom/ontology/"
# Per kind of resource under ROOT, the verb a role must hold for the resource to count.
VERBS = {
    "toolsets": "Ontology/Toolsets/action",
    "tools": "Ontology/Tools/action",  # one tool, held by its own name
    "tables": "Ontology/Tables/read",
    "memory": "Ontology/Memory/read",
    "console": "Ontology/Console/action",
    "subjects": "Ontology/Subjects/read",
}
ALL_VERBS = "Ontology/*"  # what a role the ontology creates holds
POLICY = "Ontology: "  # a role's one policy is named this plus the role's name
_NAME = re.compile(r"[A-Za-z0-9_-]+")  # one segment of a resource: no dot, $ or braces
_SELF = "USER_EMPLID"  # how a resource spells ${USER_EMPLID}
# A role's rows per cache query as a resource: a caller's grants carry no role name to find its record by.
_ROWS = re.compile(re.escape(ROOT) + r"limits/rows/([1-9][0-9]*)/?")
# The fields of a `role` record: what a role holds besides its grants.
_KEPT = ("display_name", "agents", "concurrency_limits")

# Written into a platform that has never had an ontology role; equal to config/roles.yaml.
EXAMPLE_ROLES: dict[str, dict[str, Any]] = {
    "default": {
        "display_name": "Authenticated User (No Role Assigned)",
        "memory_paths": ["/ontology/courses/_index.md", "/ontology/courses/by-dept/**"],
        "mcp_toolsets": [],
        "cache_tables": [],
        "agents": ["general-info-agent"],
    },
    "DataAnalyst": {
        "display_name": "Data Analyst",
        "memory_paths": ["/ontology/**"],
        "mcp_toolsets": [
            "admin-analytics-tools",
            "client-postgres-tools",
            "client-mysql-tools",
        ],
        "cache_tables": ["*"],
        "agents": ["analytics-agent"],
    },
    "Executive": {
        "display_name": "University Executive",
        "memory_paths": ["/ontology/**"],
        "mcp_toolsets": ["*"],
        "cache_tables": ["*"],
        "concurrency_limits": {"max_records_per_query": 1000, "max_export_rows": 500},
        "agents": ["executive-dashboard-agent"],
    },
    "IblaiOntologyAdmin": {
        "display_name": "Ontology Administrator",
        "memory_paths": ["/ontology/_audit/**"],
        "mcp_toolsets": [
            "admin-analytics-tools",
            "client-postgres-tools",
            "client-mysql-tools",
        ],
        "cache_tables": ["sync_runs", "audit_log"],
        "admin_dashboard": True,
    },
}


# -- the platform's lists ----------------------------------------------------------------------


def _pages(path: str, **params) -> list[dict]:
    """Every result of one of the platform's paged core lists."""
    from iblai_ontology.backend import store

    client = store.client()
    params |= {"platform_key": client.config.org, "page_size": 100}
    found: list[dict] = []
    page = 1
    while page:
        body = client.core("GET", path, params={**params, "page": page}).json()
        found += body["results"]
        page = page + 1 if body["next"] else None
    return found


def _platform_roles(name: str | None = None) -> dict[str, dict]:
    """The platform's own roles by name: all of them, or those whose name holds ``name``."""
    found = _pages("rbac/roles/", **({"name": name} if name else {}))
    return {role["name"]: role for role in found}


def _policies(**params) -> list[dict]:
    """The platform's policies matching ``params``; stops when they are another platform's."""
    from iblai_ontology.backend import store

    org = store.client().config.org
    found = _pages(
        "rbac/policies/", include_users="false", include_groups="false", **params
    )
    for policy in found:
        if policy["platform"]["key"] != org:
            # The DM lists policies by the credential's platform, whatever key is sent.
            raise RuntimeError(
                f"The platform answered with the policies of {policy['platform']['key']!r}: "
                f"IBLAI_ADMIN_TOKEN is not a credential of IBLAI_ORG ({org!r})."
            )
    return found


def _holds(role: dict, verb: str) -> bool:
    """Whether a platform role holds ``verb``; ``*`` is any run of characters, as in the DM."""
    return any(
        fnmatch.fnmatchcase(verb, action) for action in role.get("actions") or []
    )


def _ours(role: dict) -> bool:
    """An ontology role: a platform role, not internal, that holds one of the verbs."""
    return not role.get("is_internal") and any(_holds(role, v) for v in VERBS.values())


# -- a spec as resources, and back -------------------------------------------------------------


def _memory(pattern: str) -> str:
    """The resource of one memory pattern: a folder (``…/**`` or ``…/*``) or one ``.md`` file."""
    own = "${" + _SELF + "}"
    tail = pattern.replace(own, _SELF).removeprefix("/ontology/")
    # A bare USER_EMPLID would read back as the caller's own id.
    if pattern.startswith("/ontology/") and _SELF not in pattern.replace(own, ""):
        if tail in ("*", "**"):
            return f"{ROOT}memory/"
        # A resource cannot spell a dot: a trailing * on the last segment stands for .md.
        for ending, mark in (("/**", ""), ("/*", ""), (".md", "*")):
            path = tail.removesuffix(ending)
            if path != tail and all(_NAME.fullmatch(part) for part in path.split("/")):
                return f"{ROOT}memory/{path}{mark}/"
    raise RuntimeError(
        f"memory_paths: {pattern!r} cannot be kept in the ibl.ai platform. A path is a "
        "folder (/ontology/<folder>/**) or one file (/ontology/<folder>/<name>.md), each "
        "part of letters, digits, - and _."
    )


def _resources(spec: dict[str, Any]) -> list[str]:
    """The policy resources that say what ``spec`` grants; refuses what a resource cannot spell."""
    out: list[str] = []
    for kind, field in (
        ("toolsets", "mcp_toolsets"),
        ("tools", "mcp_tools"),
        ("tables", "cache_tables"),
    ):
        names = spec.get(field) or []
        # A tool is held by its name only: `*` among them is refused below, as no name.
        if "*" in names and kind != "tools":
            out.append(f"{ROOT}{kind}/")
            # Beside the whole kind only a toolset's name says more: one that writes is granted by name.
            names = [n for n in names if n != "*"] if kind == "toolsets" else []
        for name in names:
            if not _NAME.fullmatch(str(name)):
                raise RuntimeError(
                    f"{field}: {name!r} cannot be kept in the ibl.ai platform, whose "
                    "resources take letters, digits, - and _ only."
                )
            out.append(f"{ROOT}{kind}/{name}/")
    out += [_memory(str(pattern)) for pattern in spec.get("memory_paths") or []]
    if spec.get("admin_dashboard"):
        out.append(f"{ROOT}console/")
    if not spec.get("self_service"):
        out.append(f"{ROOT}subjects/")
    rows = (spec.get("concurrency_limits") or {}).get("max_records_per_query")
    if isinstance(rows, int) and not isinstance(rows, bool) and rows > 0:
        out.append(f"{ROOT}limits/rows/{rows}/")
    # In the DM's own order: by depth, then by name.
    return sorted(set(out), key=lambda resource: (resource.count("/"), resource))


def _name(kind: str, tail: str) -> str | None:
    """The toolset, table or memory pattern a resource names under its kind; None if no such shape."""
    if kind in ("toolsets", "tools", "tables"):
        return tail if _NAME.fullmatch(tail) else None
    if kind != "memory":
        return None  # console and subjects are granted whole
    *folders, last = tail.split("/")
    file = last.endswith("*")
    parts = [*folders, last[:-1] if file else last]
    if not all(_NAME.fullmatch(part) for part in parts):
        return None
    path = "/ontology/" + "/".join(parts).replace(_SELF, "${" + _SELF + "}")
    return path + (".md" if file else "/**")


def _read(resources: list[str]) -> dict[str, set[str]]:
    """What a policy's resources grant per kind: names, or ``*`` for the whole kind.

    Strict: a resource of any other shape is skipped and logged, never widened.
    """
    granted: dict[str, set[str]] = {kind: set() for kind in VERBS}
    for resource in resources:
        path = resource if resource.endswith("/") else resource + "/"
        # The root, or a parent of it, covers everything beneath, as in the DM.
        if ROOT.startswith(path):
            for names in granted.values():
                names.add("*")
            continue
        if not path.startswith(ROOT):
            continue  # not the ontology's
        kind, _, tail = path[len(ROOT) :].partition("/")
        if kind == "limits":
            continue  # a limit grants nothing; `granted` reads it
        name = "*" if not tail else _name(kind, tail[:-1])
        if kind not in granted or name is None:
            logger.warning("roles: %s grants nothing here and is skipped", resource)
        else:
            granted[kind].add(name)
    return granted


def _spec(name: str, role: dict, resources: list[str], kept: dict) -> dict[str, Any]:
    """A role as roles.yaml would write it, from the platform role, its policy and its record."""
    granted = _read(resources)

    def reach(kind: str) -> list[str]:
        # A resource counts only when the role holds its kind's verb.
        names = granted[kind] if _holds(role, VERBS[kind]) else set()
        # `*` sorts first; a name stays beside it: a write toolset and a tool are granted by name.
        named = kind in ("toolsets", "tools")
        return sorted(names) if named or "*" not in names else ["*"]

    memory = reach("memory")
    return {
        "display_name": kept.get("display_name") or name,
        "memory_paths": ["/ontology/**"] if memory == ["*"] else memory,
        "mcp_toolsets": reach("toolsets"),
        # The whole kind lends no tool: one is held by its name.
        "mcp_tools": [tool for tool in reach("tools") if tool != "*"],
        "cache_tables": reach("tables"),
        "agents": list(kept.get("agents") or []),
        "concurrency_limits": dict(kept.get("concurrency_limits") or {}),
        "admin_dashboard": reach("console") == ["*"],
        # Self-service is the absence of the grant on every subject.
        "self_service": reach("subjects") != ["*"],
    }


def combine(specs: list[dict[str, Any]]) -> dict[str, Any]:
    """Several role specs as one: every grant of each.

    A limit is the largest any of them names, and subjects stay the caller's own unless
    one of them lifts that.
    """

    def union(field: str) -> list[str]:
        return sorted({item for spec in specs for item in spec.get(field) or []})

    # ponytail: a role with no limit does not lift another's; grants carry no role names to tell.
    limits: dict[str, int] = {}
    for spec in specs:
        for name, value in (spec.get("concurrency_limits") or {}).items():
            if isinstance(value, int) and not isinstance(value, bool):
                limits[name] = max(value, limits.get(name, value))
    return {
        "memory_paths": union("memory_paths"),
        "mcp_toolsets": union("mcp_toolsets"),
        "mcp_tools": union("mcp_tools"),
        "cache_tables": union("cache_tables"),
        "agents": union("agents"),
        "concurrency_limits": limits,
        "admin_dashboard": any(spec.get("admin_dashboard") for spec in specs),
        "self_service": all(spec.get("self_service") for spec in specs),
    }


def granted(grants: dict[str, dict]) -> dict[str, Any]:
    """The spec a caller's own grants amount to: every role that lists them, combined.

    ``grants`` is ``{resource: {"actions": [...]}}`` as the platform resolves them under
    ROOT; a resource counts only where it is held with its kind's verb.
    """
    spec = combine(
        [_spec("", held, [resource], {}) for resource, held in grants.items()]
    )
    rows = [int(found[1]) for found in map(_ROWS.fullmatch, grants) if found]
    if rows:
        spec["concurrency_limits"] = {"max_records_per_query": max(rows)}
    return spec


# -- reading and writing -----------------------------------------------------------------------


def load_roles() -> dict[str, dict[str, Any]]:
    """Every role spec as stored, read now: never the cache, never expanded."""
    if not platform_roles():
        from iblai_ontology.config import writer

        return writer.load_roles()
    from iblai_ontology.backend import store

    # A policy counts when it carries its own role's name.
    bound = {
        policy["role"]["id"]: policy["resources"]
        for policy in _policies(name=POLICY.strip())
        if policy["name"] == POLICY + policy["role"]["name"]
    }
    kept = {record["key"]: record["data"] for record in store.records("role")}
    return {
        name: _spec(name, role, bound.get(role["id"], []), kept.get(name) or {})
        for name, role in _platform_roles().items()
        if _ours(role)
    }


def _forget() -> None:
    from django.core.cache import cache

    cache.delete(CACHE_KEY)


def _write_policy(name: str, role: dict, resources: list[str]) -> None:
    """Create, replace or (when it would grant nothing) delete the role's one policy."""
    from iblai_ontology.backend import store

    client = store.client()
    org = {"platform_key": client.config.org}
    wanted = POLICY + name
    named = [p for p in _policies(name=wanted) if p["name"] == wanted]
    policy = next((p for p in named if p["role"]["id"] == role["id"]), None)
    if named and policy is None:
        raise RuntimeError(
            f"The platform's policy {wanted!r} is bound to the role "
            f"{named[0]['role']['name']!r}: rename or delete it there."
        )
    if policy is None:
        if resources:
            body = {
                **org,
                "name": wanted,
                "role_id": role["id"],
                "resources": resources,
            }
            client.core("POST", "rbac/policies/", json=body)
        return
    # What someone added there that is neither the ontology's nor a parent of it stays.
    others = [
        r for r in policy["resources"] if not (r.startswith(ROOT) or ROOT.startswith(r))
    ]
    path = f"rbac/policies/{policy['id']}/"
    if resources or others:
        client.core("PATCH", path, json={**org, "resources": resources + others})
    else:
        client.core("DELETE", path, params=org)


def put_role(name: str, spec: dict[str, Any]) -> None:
    """Create or replace one role: in the platform its role, its one policy and its record."""
    if not platform_roles():
        from iblai_ontology.config import writer

        return writer.put_role(name, spec)
    import httpx

    from iblai_ontology.backend import store

    client = store.client()
    org = {"platform_key": client.config.org}
    resources = _resources(spec)
    role = _platform_roles(name).get(name)
    created = role is None
    if created:
        body = {**org, "name": name, "actions": [ALL_VERBS]}
        role = client.core("POST", "rbac/roles/", json=body).json()
    elif not _ours(role):
        raise RuntimeError(
            f"The ibl.ai platform has a role named {name!r} that holds no Ontology verb: "
            "pick another name, or give that role one there."
        )
    # The ontology never changes a role's verbs: a role made there with fewer is told so.
    lacking = sorted(
        VERBS[kind]
        for kind, names in _read(resources).items()
        if names and not _holds(role, VERBS[kind])
    )
    if lacking:
        raise RuntimeError(
            f"The platform role {name!r} does not hold {', '.join(lacking)}: add it to "
            "the role in the ibl.ai platform, or grant less here."
        )
    # ponytail: several platform calls, not one transaction; two writers of one role can cross.
    try:
        _write_policy(name, role, resources)
    except (RuntimeError, httpx.HTTPError):
        if created:  # a role that grants nothing is not left behind
            try:
                client.core("DELETE", f"rbac/roles/{role['id']}/", params=org)
            except (RuntimeError, httpx.HTTPError) as exc:
                logger.error(
                    "roles: the new role %s could not be removed: %s", name, exc
                )
        raise
    try:
        store.put_record("role", name, {k: spec[k] for k in _KEPT if k in spec})
    finally:
        _forget()


def delete_role(name: str) -> bool:
    """Remove a role: in the platform its role, whose policy goes with it, and its record."""
    if not platform_roles():
        from iblai_ontology.config import writer

        return writer.delete_role(name)
    from iblai_ontology.backend import store

    client = store.client()
    role = _platform_roles(name).get(name)
    if role is None or not _ours(role):
        return False
    others = sorted(
        policy["name"]
        for policy in _policies(role_id=role["id"])
        if policy["name"] != POLICY + name
    )
    if others:
        raise RuntimeError(
            f"Role {name!r} is bound by other policies in the ibl.ai platform "
            f"({', '.join(others)}), which deleting it would delete too: remove them there."
        )
    params = {"platform_key": client.config.org}
    client.core("DELETE", f"rbac/roles/{role['id']}/", params=params)
    store.delete_record("role", name)
    _forget()
    return True


_REACH = ("memory_paths", "mcp_toolsets", "cache_tables")  # what a role reaches


def extend_role(name: str, reach: dict[str, list[str]], display_name: str = "") -> None:
    """Give the role ``name`` this reach on top of what it holds; a role that is not there is made."""
    if name == DEFAULT_ROLE:
        raise RuntimeError(
            f"The role {DEFAULT_ROLE!r} is every signed-in member's: it is not given a "
            "system's reach. Name the system something else."
        )
    spec = load_roles().get(name) or {"display_name": display_name or name}
    for field in _REACH:
        spec[field] = sorted({*(spec.get(field) or []), *(reach.get(field) or [])})
    put_role(name, spec)


def reduce_role(name: str, reach: dict[str, list[str]]) -> None:
    """Take this reach back from the role ``name``; a role left reaching nothing is removed."""
    spec = load_roles().get(name)
    if spec is None or name == DEFAULT_ROLE:
        return
    for field in _REACH:
        gone = reach.get(field) or []
        spec[field] = [held for held in spec.get(field) or [] if held not in gone]
    reaches = any(spec[field] for field in _REACH) or spec.get("mcp_tools")
    if reaches or spec.get("admin_dashboard"):
        put_role(name, spec)
    else:
        delete_role(name)


def drop_tools(tools: set[str]) -> None:
    """Take these tools from every role that holds one by name: they are gone, or now change data."""
    for name, spec in load_roles().items():
        held = spec.get("mcp_tools") or []
        if tools & set(held):
            put_role(name, {**spec, "mcp_tools": [t for t in held if t not in tools]})


_seed_asked = False  # each process asks the platform once


def seed_once() -> None:
    """Write the example roles into a platform that has never had an ontology role.

    The record ``setup/roles`` marks a platform as asked, so roles an admin deletes stay
    deleted. Never raises: the console works without the examples.
    """
    global _seed_asked
    if _seed_asked or not platform_roles():
        return
    _seed_asked = True
    import httpx

    from iblai_ontology.backend import store

    try:
        if store.record("setup", "roles") is not None:
            return
        written = []
        if not load_roles():
            from iblai_ontology.config.reader import ConfigReader

            # Only toolsets this backend defines: a role naming another cannot be saved again.
            known = {"*", *ConfigReader().get_toolsets()}
            for name, spec in EXAMPLE_ROLES.items():
                toolsets = [t for t in spec["mcp_toolsets"] if t in known]
                try:
                    put_role(name, {**spec, "mcp_toolsets": toolsets})
                except RuntimeError as exc:
                    logger.error(
                        "roles: the example role %s was refused: %s", name, exc
                    )
                else:
                    written.append(name)
            if not written:
                return  # nothing marked: the next start tries again
        store.put_record("setup", "roles", {"roles": written})
    except (RuntimeError, ValueError, LookupError, TypeError, httpx.HTTPError) as exc:
        logger.error("roles: the example roles could not be written: %s", exc)


class DmRoles:
    """What ``RoleResolver`` reads in rbac and dm: the platform's roles, kept for
    ``ONTOLOGY_ROLES_TTL`` seconds and past that while the platform does not answer."""

    def get_roles(self) -> dict[str, Any]:
        import httpx
        from django.conf import settings
        from django.core.cache import cache

        held = cache.get(CACHE_KEY)
        if held and time.time() - held["at"] < settings.ONTOLOGY_ROLES_TTL:
            return held["roles"]
        try:
            roles = load_roles()
        # LookupError, TypeError: an answer that is not the shape the platform documents.
        except (
            RuntimeError,
            ValueError,
            LookupError,
            TypeError,
            httpx.HTTPError,
        ) as exc:
            if not held:
                logger.error("roles: the ibl.ai platform did not answer: %s", exc)
                raise RolesUnavailable(str(exc)) from exc
            # Stamped anew below, so the platform is asked again in a TTL, not per request.
            logger.warning("roles: keeping the last copy, the platform said: %s", exc)
            roles = held["roles"]
        cache.set(CACHE_KEY, {"roles": roles, "at": time.time()}, None)
        return roles


def reader():
    """What ``RoleResolver`` reads roles from."""
    if platform_roles():
        return DmRoles()
    from iblai_ontology.config.reader import ConfigReader

    return ConfigReader()
