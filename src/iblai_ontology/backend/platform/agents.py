"""Connecting one of the platform's agents to this gateway, as one role (roles in the platform only).

A connection is three things in the ibl.ai platform and one record: an API key limited to
the role's own policy, this gateway registered as an MCP server of that agent alone with the
key as its credential, the agent's MCP tool switched on, and the ontology record
``agent_connection/<name>`` that names them, which this host keeps itself where the platform
keeps none. The key is never kept: twelve characters of its hash name it, the same twelve the
audit log writes for its calls.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone

from iblai_ontology.config import platform_roles

KIND = "agent_connection"
KEYS = "api/core/platform/api-tokens/"


class ConnectionRefused(RuntimeError):
    """Why an agent could not be connected or a connection removed, in words for the console."""


def _sign_in(authorization: str) -> dict[str, str]:
    """The admin's own ibl.ai sign-in, as the header the platform is sent in their name."""
    if not authorization.lower().startswith("token "):
        raise ConnectionRefused(
            "Connecting an agent needs your ibl.ai sign-in: the platform lets only a "
            "signed-in administrator make or delete an API key."
        )
    return {"Authorization": authorization}


def _slug(text: str, most: int) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:most].strip("-")


def _platform_roles() -> None:
    """Refuse on a backend whose roles are a file on its own host: a key is limited to a platform role."""
    if not platform_roles():
        raise ConnectionRefused(
            "No agent can be connected to this backend yet: it keeps its roles in a file "
            "on its own server. Install it with your platform's key, so the roles live in "
            "the ibl.ai platform."
        )


def agents(authorization: str) -> list[dict]:
    """The platform's agents, newest first: each one's id and name."""
    from iblai_ontology.backend import store

    _platform_roles()
    listed = store.client().agents(headers=_sign_in(authorization))
    return [{"id": str(a["unique_id"]), "name": a.get("name") or ""} for a in listed]


def connections() -> list[dict]:
    """Every connection as kept, newest first; none while the roles live on this host."""
    from iblai_ontology.backend import store

    if not platform_roles():
        return []
    found = [
        {**record["data"], "name": record["key"]} for record in store.records(KIND)
    ]
    return sorted(found, key=lambda c: c.get("created_at") or "", reverse=True)


def connect(authorization: str, *, agent: str, role: str, by: str = "") -> dict:
    """Give one agent one role's reach on this gateway; returns the connection as kept.

    A step that fails takes back the ones before it; what could not be taken back is said.
    """
    from iblai_ontology.backend import store
    from iblai_ontology.backend.identity import role_source

    _platform_roles()
    url = (os.environ.get("ONTOLOGY_GATEWAY_URL") or "").strip()
    if not url:
        raise ConnectionRefused(
            "This backend does not know the address agents reach it at "
            "(ONTOLOGY_GATEWAY_URL)."
        )
    headers = _sign_in(authorization)
    client = store.client()
    wanted = role_source.POLICY + role
    policy = next(
        (p for p in role_source._policies(name=wanted) if p["name"] == wanted), None
    )
    if policy is None:
        raise ConnectionRefused(
            f"Role {role!r} reaches nothing yet: grant it something, then connect."
        )
    listed = {str(a["unique_id"]): a for a in client.agents(headers=headers)}
    if agent not in listed:
        raise ConnectionRefused("That agent is not one of this platform's.")
    label = listed[agent].get("name") or agent
    # The agent's id keeps two agents of one name apart.
    name = f"{_slug(label, 24) or 'agent'}-{agent[:8]}-{_slug(role, 16)}"
    if store.record(KIND, name) is not None:
        raise ConnectionRefused(
            f"{label} is already connected as {role}. Remove that connection first."
        )

    undo = []  # what a later failure takes back, in the order it was made
    try:
        asked = {
            "name": f"ontology-{name}",
            "mode": "token_policies",
            "policies_to_add": [policy["id"]],
        }
        made = client._call("POST", KEYS, headers=headers, json=asked).json()
        key, key_id = made["key"], made["unique_id"]
        undo.append(
            (
                "the API key",
                # No slash at its end: the platform routes one key's address without one.
                lambda: client._call("DELETE", f"{KEYS}{key_id}", headers=headers),
            )
        )
        server = client.register_mcp_server(
            name=f"Ontology: {role}",
            description=f"The ontology gateway, with the reach of the role {role}.",
            url=url,
            # Sent as it is on every call: no per-user connection to set up.
            auth_type="none",
            credentials=f"Api-Token {key}",
            mentor=agent,
        )
        undo.append(("the MCP server", lambda: client.delete_mcp_server(server["id"])))
        client.attach_to_agent(agent_id=agent, server_id=server["id"])
        record = {
            "agent": agent,
            "agent_name": label,
            "role": role,
            "server": server["id"],
            "key_id": key_id,
            "fingerprint": hashlib.sha256(key.encode()).hexdigest()[:12],
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "created_by": by,
        }
        store.put_record(KIND, name, record)
    except Exception as exc:
        kept = []
        for what, take_back in reversed(undo):
            try:
                take_back()
            except Exception as failed:
                kept.append(f"{what} ({' '.join(str(failed).split())[:120]})")
        why = " ".join(str(exc).split())[:400]
        if kept:
            why += f" Not taken back, remove it in the platform: {'; '.join(kept)}."
        raise ConnectionRefused(why) from exc
    return {**record, "name": name}


def disconnect(authorization: str, name: str) -> None:
    """Remove a connection: the key first, so access stops at once, then the server, then the record."""
    from iblai_ontology.backend import store

    headers = _sign_in(authorization)
    record = store.record(KIND, name)
    if record is None:
        raise ConnectionRefused(f"No connection named {name!r}.")
    client = store.client()
    try:
        client._call("DELETE", f"{KEYS}{record['key_id']}", headers=headers, ok=(404,))
    except Exception as exc:
        why = " ".join(str(exc).split())[:300]
        raise ConnectionRefused(
            f"Its API key was not deleted, so it still works: {why}"
        ) from exc
    try:
        client.delete_mcp_server(record["server"])
        store.delete_record(KIND, name)
    except Exception as exc:
        why = " ".join(str(exc).split())[:300]
        raise ConnectionRefused(
            f"Its API key is deleted, so the agent no longer reaches this gateway; "
            f"the rest was not removed, try again: {why}"
        ) from exc
