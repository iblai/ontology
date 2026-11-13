"""NVIDIA Auto Ontology: the business terms of a server an administrator connects.

A reading takes every term with the tables linked to it and the joins NVIDIA inferred through
it, and keeps them as the system's rows (one ``ServiceTable`` each, as a discovered table is
kept), so the map never waits on that server. Only GETs are made, and a viewer's token is
enough for them. What the server answers is another system's word: an id is checked before it
goes into a URL or a node's id, text is cut to a length, and the sample values its answers
carry are never kept.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import httpx

from iblai_ontology.backend.services import http_api

logger = logging.getLogger("iblai_ontology.services")

ADAPTER = "auto_ontology"
TIMEOUT = 10.0  # one call
DEADLINE = 45.0  # one reading: the hosted frontend gives a request 60 seconds
WORKERS = 8  # calls made at a time
# ponytail: the first TERM_CAP terms by name, read inside the request; a queued reading per database lifts both.
TERM_CAP = 1000
ROW_CAP = 200  # tables, joins, columns or calculations kept for one term
TEXT_CAP = 2000  # characters of a description or an expression
NAME_CAP = 255
BODY_CAP = 16_000_000  # bytes of one answer
_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
HOLDS = {
    "REPRESENTS",
    "HAS_ATTRIBUTE",
}  # a table that stands for a term, or carries a column of it
REFERS = "SEMANTIC_FK"  # a table that only points at a term: the join NVIDIA inferred
_CERTIFICATION = {"certified", "partial", "pending"}


class LayerError(RuntimeError):
    """What an Auto Ontology server, or the way to it, refused: in words an administrator can act on."""


def _address(base: str) -> str:
    """The address as it is kept, by a custom API's rules; checked again before every reading."""
    try:
        return http_api.address(base)[0]
    except http_api.ApiError as exc:
        raise LayerError(str(exc)) from exc


def _config(service) -> dict:
    from iblai_ontology.backend.services.encryption import decrypt_connection_config

    return decrypt_connection_config(service.connection_config_encrypted)


def _client(base: str, token: str) -> httpx.Client:
    # No redirect is followed: the token goes to the address that was checked, nowhere else.
    return httpx.Client(
        base_url=base,
        headers={"x-api-key": token} if token else {},
        timeout=TIMEOUT,
        follow_redirects=False,
    )


def _ask(client: httpx.Client, path: str, **params) -> dict:
    """One GET. A refusal, a silence or an answer that is not this API's is a LayerError.

    The error names a status and never the answer's body: the address is an administrator's
    choice, and what stands there is not theirs to read through this server.
    """
    body = bytearray()
    try:
        with client.stream("GET", path, params=params or None) as resp:
            status = resp.status_code
            if 200 <= status < 300:
                for chunk in resp.iter_bytes():
                    body.extend(chunk)
                    if len(body) > BODY_CAP:
                        raise LayerError(
                            f"{client.base_url} sent more than this server reads in one answer."
                        )
    except httpx.HTTPError as exc:
        logger.warning("auto ontology: %s did not answer: %r", client.base_url, exc)
        raise LayerError(f"{client.base_url} did not answer.") from exc
    if status in (401, 403):
        raise LayerError(f"{client.base_url} refused the token ({status}).")
    if not 200 <= status < 300:
        raise LayerError(f"{client.base_url} answered {status} for {path}.")
    try:
        answer = json.loads(bytes(body))
    except ValueError:
        answer = None
    if not isinstance(answer, dict) or "data" not in answer:
        raise LayerError(
            f"{client.base_url} did not answer as an Auto Ontology server does."
        )
    return answer


def _rows(answer: dict) -> list[dict]:
    """The rows of a list answer; anything else there is not this API's."""
    data = answer["data"]
    if not isinstance(data, list):
        raise LayerError("The server did not answer as an Auto Ontology server does.")
    return [row for row in data if isinstance(row, dict)]


def _text(value, cap: int = NAME_CAP) -> str:
    return " ".join(str(value or "").split())[:cap]


def _probe(base: str, token: str) -> int:
    """One small call: the server is Auto Ontology and takes the token. How many terms it has."""
    with _client(base, token) as client:
        answer = _ask(client, "api/terms", limit=1)
    _rows(answer)
    total = answer.get("total")
    return total if isinstance(total, int) else 0


def _term(client: httpx.Client, row: dict) -> dict:
    """One term as it is kept: its meaning, the tables linked to it, the joins inferred through it."""
    term_id = str(row["id"])
    found = _ask(client, f"api/exploration/terms/{term_id}/details")["data"]
    linked = found.get("tables") if isinstance(found, dict) else None
    place: dict[str, list[str]] = {}  # NVIDIA's table id -> [database, schema, table]
    tables: list[dict] = []
    pointed_at = False
    for table in (linked if isinstance(linked, list) else [])[:ROW_CAP]:
        if not isinstance(table, dict):
            continue
        where = [
            _text(table.get("database_name")),
            _text(table.get("schema_name")),
            _text(table.get("name")),
        ]
        types = table.get("relationship_types")
        kinds = {
            t for t in (types if isinstance(types, list) else []) if isinstance(t, str)
        }
        if not where[0] or not where[2] or not kinds & (HOLDS | {REFERS}):
            continue
        if isinstance(table.get("id"), str):
            place[table["id"]] = where
        pointed_at = pointed_at or REFERS in kinds
        # holds: the table stands for the term or carries a column of it, not only points at it.
        tables.append(
            {
                "database": where[0],
                "schema": where[1],
                "table": where[2],
                "holds": bool(kinds & HOLDS),
            }
        )
    joins: list[list[list[str]]] = []
    # Only a term another table points at can carry a join: the others are not asked.
    if pointed_at:
        for attribute in _rows(_ask(client, f"api/terms/{term_id}/column-attributes")):
            to = place.get(_table_id(attribute.get("primary_column")))
            refs = attribute.get("referenced_columns")
            for ref in refs if isinstance(refs, list) else []:
                source = place.get(_table_id(ref))
                if to and source and source != to and [source, to] not in joins:
                    joins.append([source, to])
    names = row.get("synonyms")
    certification = row.get("certification")
    return {
        "id": term_id,
        "name": _text(row.get("name")) or term_id,
        "description": _text(row.get("description"), TEXT_CAP),
        "synonyms": [
            _text(n, 100)
            for n in (names if isinstance(names, list) else [])
            if isinstance(n, str) and n.strip()
        ][:20],
        "certification": certification if certification in _CERTIFICATION else "",
        "tables": tables,
        "joins": joins[:ROW_CAP],
    }


def _table_id(column) -> str:
    """The table a column of NVIDIA's answer is in, by its id there; empty when it names none."""
    found = column.get("table_id") if isinstance(column, dict) else None
    return found if isinstance(found, str) else ""


def _fetch(base: str, token: str) -> dict:
    """A whole reading, held in memory: ``{terms, of, dropped}``. Nothing is written here."""
    started = time.monotonic()
    with _client(base, token) as client:
        answer = _ask(client, "api/terms")
        found = _rows(answer)
        listed = [row for row in found if _ID.match(str(row.get("id") or ""))]
        dropped = len(found) - len(listed)
        total = answer.get("total")
        pool = ThreadPoolExecutor(max_workers=WORKERS)
        try:
            # The workers only call NVIDIA's server: the registry is written by this thread alone.
            futures = [pool.submit(_term, client, row) for row in listed[:TERM_CAP]]
            terms = []
            for future in futures:
                left = DEADLINE - (time.monotonic() - started)
                try:
                    terms.append(future.result(timeout=max(left, 0)))
                except TimeoutError:
                    raise LayerError(
                        f"Reading {len(futures)} terms took longer than {int(DEADLINE)} "
                        "seconds: nothing was changed."
                    ) from None
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    return {
        "terms": terms,
        "of": (total if isinstance(total, int) else len(found)) - dropped,
        "dropped": dropped,
    }


def _keep(service, reading: dict) -> None:
    """Replace the system's stored terms with a reading: the rows first, the header last."""
    from django.utils import timezone

    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    terms = reading["terms"]
    # ponytail: delete-then-insert is not atomic, as registry.save_manifest's is not; Read again mends it.
    store.delete(ServiceTable, service=service.pk)
    store.bulk_create(
        ServiceTable,
        [
            ServiceTable(service=service, position=i, payload=term)
            for i, term in enumerate(terms)
        ],
    )
    held = Counter(
        database
        for term in terms
        for database in {t["database"] for t in term["tables"] if t["holds"]}
    )
    service.schema_manifest = {
        "terms": len(terms),
        "of": reading["of"],
        "databases": [{"name": n, "terms": held[n]} for n in sorted(held)],
        "tables": [],
    }
    service.last_discovery_at = timezone.now()
    store.save(service, ["schema_manifest", "last_discovery_at"])


def read(service) -> str:
    """Read the server's terms again, keep them and say how many.

    Raises ``LayerError`` with why it could not; the reading before is then still in place.
    """
    config = _config(service)
    reading = _fetch(_address(config["host"]), config.get("api_key") or "")
    _keep(service, reading)
    count = len(reading["terms"])
    said = [f"{count} term{'' if count == 1 else 's'} read."]
    if not reading["of"]:
        said.append("Its semantic layer may not be built yet.")
    elif reading["of"] > count:
        said.append(
            f"It holds {reading['of']}: only the first {count} by name are read."
        )
    if reading["dropped"]:
        verb = "was" if reading["dropped"] == 1 else "were"
        said.append(
            f"{reading['dropped']} carried an id this server cannot use and {verb} left out."
        )
    return " ".join(said)


def connect(name: str, base: str, token: str = "", display_name: str = "") -> str:
    """Register an Auto Ontology server, read its terms once and say so.

    Raises ``LayerError`` when the address is refused or no such server takes the token
    there. A first reading that fails leaves the system connected, to be read again.
    """
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    kept = _address(base)
    token = token.strip()
    if not token.isprintable():
        raise LayerError("The token holds a character no header carries.")
    _probe(kept, token)
    service = store.create(
        Service,
        name=name,
        display_name=display_name or name,
        service_type="api",
        adapter=ADAPTER,
        host=kept,
        status=Service.Status.ACTIVE,
        connection_config_encrypted=encrypt_connection_config(
            {"db_type": "api", "host": kept, "api_key": token}
        ),
    )
    try:
        return f"'{name}' is connected: {read(service)}"
    except LayerError as exc:
        return (
            f"'{name}' is connected, but its terms were not read: {exc} "
            "Read again from its page."
        )


def check(service) -> None:
    """The status probe: one call that the server still answers and still takes the token."""
    config = _config(service)
    _probe(_address(config["host"]), config.get("api_key") or "")


def term(service, term_id: str) -> dict:
    """A term's columns and calculations, read now: ``{columns, calculations}``.

    Not kept: stored, every load of the map would carry them. Sample values are left behind.
    """
    if not _ID.match(term_id):
        raise LayerError("That is not a term's id.")
    config = _config(service)
    with _client(_address(config["host"]), config.get("api_key") or "") as client:
        attributes = _rows(_ask(client, f"api/terms/{term_id}/column-attributes"))
        calculations = _rows(_ask(client, f"api/terms/{term_id}/sql-attributes"))
    columns = []
    for attribute in attributes[:ROW_CAP]:
        column = attribute.get("primary_column")
        column = column if isinstance(column, dict) else {}
        columns.append(
            {
                "name": _text(attribute.get("name")),
                "description": _text(attribute.get("description"), TEXT_CAP),
                "certified": attribute.get("certified") is True,
                "table": _text(column.get("table_name")),
                "column": _text(
                    column.get("column_name") or attribute.get("source_column")
                ),
            }
        )
    return {
        "columns": columns,
        "calculations": [
            {
                "name": _text(c.get("name")),
                "description": _text(c.get("description"), TEXT_CAP),
                "expression": str(c.get("expression") or "")[:TEXT_CAP],
                "certified": c.get("certified") is True,
            }
            for c in calculations[:ROW_CAP]
        ],
    }
