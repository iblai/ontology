"""Twenty CRM over its REST API, in this process.

The sync's reads (``list_records``), the check a registration runs (``check``) and the
named operations a role may be granted (``call``). A record is flattened the way Twenty
names its own database columns (``name.firstName`` is ``nameFirstName``), so the catalog's
one mapping serves a self-hosted database and the API alike. The address and the API key
are the system's registry entry, encrypted as a database's login is.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from urllib.parse import urlsplit

import httpx

ADAPTER = "twenty_api"  # the catalog's adapter name for Twenty
PAGE = 200  # Twenty's QUERY_MAX_RECORDS
TIMEOUT = 60
# Field types whose value is an object of sub-fields, stored as one column per sub-field
# (the metadata API names the bodyV2 composite RICH_TEXT; a legacy plain-text value stays as is).
COMPOSITE_TYPES = {
    "FULL_NAME",
    "EMAILS",
    "PHONES",
    "LINKS",
    "ADDRESS",
    "CURRENCY",
    "ACTOR",
    "RICH_TEXT",
    "RICH_TEXT_V2",
}
_LOCAL = {"localhost", "127.0.0.1", "::1"}
# What a `writes` field of the catalog may be typed as, and the JSON values each takes.
_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool}


class TwentyError(RuntimeError):
    """What Twenty, or the way to it, refused: said in words an admin or an agent can act on."""


def address(host: str) -> str:
    """A Twenty address as it is kept: https, or http on this machine only; no trailing slash."""
    url = urlsplit(host.strip())
    if url.scheme not in ("http", "https") or not url.hostname or url.username:
        raise TwentyError(f"{host!r} is not a Twenty address: one starts with https://")
    if url.scheme == "http" and url.hostname not in _LOCAL:
        # The API key rides on every call.
        raise TwentyError("A Twenty address is https; http is taken on localhost only.")
    return host.strip().rstrip("/")


def _said(resp: httpx.Response) -> str:
    """Twenty's own words for a refusal: its ``messages``, or the start of its answer."""
    try:
        body = resp.json()
    except ValueError:
        body = None
    words = body.get("messages") if isinstance(body, dict) else None
    if isinstance(words, list) and words:
        return "; ".join(str(word) for word in words)
    return " ".join(resp.text.split())[:120] or "no reason given"


@contextmanager
def _client(config: dict):
    """One connection to the system's Twenty, carrying its API key."""
    with httpx.Client(
        base_url=config["host"],
        headers={"Authorization": f"Bearer {config['api_key']}"},
        timeout=TIMEOUT,
    ) as client:
        yield client


def _ask(client: httpx.Client, method: str, path: str, **kwargs) -> dict:
    """One call; a refusal, a silence or an answer that is not Twenty's is a TwentyError."""
    try:
        resp = client.request(method, path, **kwargs)
    except httpx.HTTPError as exc:
        raise TwentyError(f"Twenty did not answer at {client.base_url}: {exc}") from exc
    if resp.status_code == 401:
        raise TwentyError(f"Twenty refused the API key: {_said(resp)}")
    if resp.status_code >= 400:
        raise TwentyError(
            f"{client.base_url} answered {resp.status_code}: {_said(resp)}"
        )
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise TwentyError(f"{client.base_url} did not answer as Twenty's API does.")
    return body


def _fields(client: httpx.Client) -> dict[str, dict[str, str]]:
    """Per object (by its REST plural), each field's type, from the metadata API."""
    # ponytail: one page of 200 objects (a stock workspace has 46); page it past that.
    body = _ask(client, "GET", "/rest/metadata/objects", params={"limit": PAGE})
    out: dict[str, dict[str, str]] = {}
    for obj in body["data"].get("objects") or []:
        if obj.get("fields") is None:
            raise TwentyError(
                f"Twenty's metadata for {obj.get('namePlural')} carries no fields: "
                "its composite fields cannot be told apart."
            )
        out[obj["namePlural"]] = {f["name"]: f.get("type") for f in obj["fields"]}
    if not out:
        raise TwentyError(f"{client.base_url} did not answer as Twenty's API does.")
    return out


def _composites(fields: dict[str, dict[str, str]], plural: str) -> set[str]:
    if plural not in fields:
        raise TwentyError(f"This Twenty workspace has no object named {plural}.")
    return {name for name, kind in fields[plural].items() if kind in COMPOSITE_TYPES}


def flatten(record: dict, composites: set[str]) -> dict:
    """Composite values as Twenty's columns (name.firstName -> nameFirstName); other JSON stays a value."""
    out = {}
    for key, value in record.items():
        if key in composites and isinstance(value, dict):
            for sub, v in value.items():
                out[f"{key}{sub[:1].upper()}{sub[1:]}"] = v
        else:
            out[key] = value
    return out


def nest(columns: dict, composites: set[str]) -> dict:
    """The inverse of :func:`flatten`: Twenty's columns as the body its REST API takes."""
    out: dict = {}
    for key, value in columns.items():
        # The longest composite that starts the column: `linkedinLink` before `link`.
        owner = max(
            (
                c
                for c in composites
                if key.startswith(c) and key[len(c) : len(c) + 1].isupper()
            ),
            key=len,
            default=None,
        )
        if owner is None:
            out[key] = value
        else:
            sub = key[len(owner) :]
            out.setdefault(owner, {})[sub[:1].lower() + sub[1:]] = value
    return out


def check(config: dict) -> None:
    """Raise :class:`TwentyError` unless the address answers as Twenty and takes the key."""
    with _client(config) as client:
        _fields(client)


def list_records(config: dict, plural: str) -> list[dict]:
    """Every record of an object, paged by cursor, composites flattened."""
    rows: list[dict] = []
    with _client(config) as client:
        composites = _composites(_fields(client), plural)
        params: dict = {"limit": PAGE, "depth": 0}
        while True:
            body = _ask(client, "GET", f"/rest/{plural}", params=params)
            rows += [flatten(r, composites) for r in body["data"][plural]]
            page = body.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return rows
            params = {**params, "starting_after": page["endCursor"]}


# -- named operations ------------------------------------------------------------------------


def _renames(entry, plural: str) -> dict[str, str]:
    """Twenty's column -> the house column, for one object of the catalog's mapping."""
    return dict((entry.mapping.get(plural) or {}).get("fields") or {})


def house(entry, plural: str, row: dict) -> dict:
    """A flattened record in the house's column names: what the sync stores for it."""
    renames = {k.lower(): v.lower() for k, v in _renames(entry, plural).items()}
    return {renames.get(k.lower(), k.lower()): v for k, v in row.items()}


def _record_id(value, what: str) -> str:
    """A record id as Twenty spells one; it goes into a path, so nothing else passes."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise TwentyError(
            f"{what} must be a record id (a UUID), not {value!r}."
        ) from None


def _one(body: dict) -> dict:
    """The record of a create, update or single read: the one value under ``data``."""
    record = next(iter(body["data"].values()), None)
    if not isinstance(record, dict) or "id" not in record:
        raise TwentyError("Twenty's answer names no record.")
    return record


def _read(
    client: httpx.Client, plural: str, record_id: str, composites: set[str]
) -> dict:
    """One record as the sync reads it: no nested relations, composites flattened."""
    body = _ask(client, "GET", f"/rest/{plural}/{record_id}", params={"depth": 0})
    return flatten(_one(body), composites)


def call(
    config: dict, entry, tool: dict, arguments: dict
) -> tuple[dict, dict[str, list[dict]]]:
    """Create or update one record, as the tool's ``object`` and ``operation`` say.

    Answers the record in house column names, and the rows the change touched as the sync
    reads them, per object, for the cache. Refuses a field the catalog's ``writes`` does
    not name or whose value is of another type; what Twenty refuses is said in its words.
    """
    plural, update = tool["object"], tool["operation"] == "update"
    rules = entry.writes[plural]
    targets = rules.get("targets") or {}
    takes = [
        *(["id"] if update else []),
        *rules["fields"],
        *(targets.get("links") or []),
    ]
    unknown = sorted(set(arguments) - set(takes))
    if unknown:
        raise TwentyError(
            f"{tool['name']} takes no {', '.join(unknown)}; it takes {', '.join(takes)}."
        )
    values = {name: arguments[name] for name in rules["fields"] if name in arguments}
    # Every id is read before anything is sent: a bad link must not leave a record without it.
    links = {
        n: _record_id(arguments[n], n)
        for n in targets.get("links") or []
        if n in arguments
    }
    for name, value in values.items():
        kind = rules["fields"][name]
        # A bool is an int to Python, never to a CRM.
        if isinstance(value, bool) != (kind == "boolean") or not isinstance(
            value, _TYPES[kind]
        ):
            raise TwentyError(f"{name} must be {kind}, not {value!r}.")
    if not values and not links:
        raise TwentyError(f"{tool['name']} was given nothing to {tool['operation']}.")
    record_id = _record_id(arguments.get("id"), "id") if update else None
    to_twenty = {name: column for column, name in _renames(entry, plural).items()}
    depth = {"depth": 0}  # no nested relations: the record as the sync reads it
    with _client(config) as client:
        fields = _fields(client)
        composites = _composites(fields, plural)
        body = nest({to_twenty.get(k, k): v for k, v in values.items()}, composites)
        if update and body:
            _ask(
                client, "PATCH", f"/rest/{plural}/{record_id}", json=body, params=depth
            )
        elif not update:
            made = _ask(client, "POST", f"/rest/{plural}", json=body, params=depth)
            record_id = _one(made)["id"]
        rows = {plural: [_read(client, plural, record_id, composites)]}
        if links:
            # One target row per record the note or task is about, as Twenty links them.
            linked, owner = targets["object"], targets["owner"]
            to_target = {
                name: column for column, name in _renames(entry, linked).items()
            }
            link_composites = _composites(fields, linked)
            rows[linked] = []
            for name, value in links.items():
                target = {
                    to_target[owner]: record_id,
                    to_target[name]: value,
                }
                made = _ask(
                    client, "POST", f"/rest/{linked}", json=target, params=depth
                )
                target_id = _one(made)["id"]
                rows[linked].append(_read(client, linked, target_id, link_composites))
    return house(entry, plural, rows[plural][0]), rows
