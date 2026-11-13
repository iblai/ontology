"""Business terms for a database system's tables, written by a model on an administrator's word.

After the term step of NVIDIA Auto Ontology, in our own words: one question per table,
holding its name, what discovery says it holds, and each column's name, type and keys.
Never a row. The model is the one configured in ontology.yaml, else the platform's own
through its OpenAI-compatible endpoint. Joins are not inferred: that takes embeddings,
which the platform does not serve.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as OutOfTime

WORKERS = 4  # questions asked at a time
# ponytail: one press works this long inside the request (the hosted frontend gives one 60 s);
# a queued run when a schema is too many presses, which needs somewhere to report to.
DEADLINE = 45
CALL_TIMEOUT = 40  # one answer, under the press's own time
COLUMNS = 150  # the columns one question lists

SYSTEM = """You name what a database table stands for, for people who do not know the database.
For the table you are given, answer with one JSON object and nothing else:
{"term": "...", "description": "...", "synonyms": ["..."], "columns": {"<column>": "<business name>"}}
- term: the business thing one row is, in one to three plain words with spaces (Purchase Order, not purchase_orders or PurchaseOrder). One term for the table.
- description: one sentence saying what one row is.
- synonyms: other names people use for that thing, five at most; an empty list when there is none.
- columns: a plain name with spaces for every column given (Order Date, Total Amount), keyed by the column's name exactly as given.
- A table that is a copy of another kind (its name says ARC, ARCHIVE, HIST, HISTORY, STAGING, DELETED or TEMP) says so in every name."""

# What the platform's refusal means, by its HTTP status.
_REFUSALS = {
    401: "the platform refused this server's key",
    402: "the platform has no credits left for its model",
    403: "the platform does not let this server's key use its model",
}


class TermsError(RuntimeError):
    """Why no term was written: said in words an administrator can act on."""


def _words(value, cap: int) -> str:
    """Text as it is kept: a string on one line, cut to ``cap``; anything else is nothing."""
    return " ".join(value.split())[:cap] if isinstance(value, str) else ""


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:64]


def _qualified(table: dict) -> str:
    schema, name = table.get("schema_name") or "", table.get("table_name") or ""
    return f"{schema}.{name}" if schema else name


def prompt(manifest: dict, table: dict, about: str = "") -> str:
    """What the model is sent about one table: names, types and keys, never a value."""
    lines = [
        f"Database: {manifest.get('db_type') or ''} {manifest.get('database') or ''}".rstrip(),
        f"Table: {_qualified(table)}",
    ]
    if about:
        lines.append(f"What it holds: {about}")
    lines.append("Columns:")
    for column in (table.get("columns") or [])[:COLUMNS]:
        flags = " [PK]" if column.get("is_primary_key") else ""
        if column.get("foreign_key_table"):
            flags += f" [FK -> {column['foreign_key_table']}.{column.get('foreign_key_column')}]"
        lines.append(
            f"- {column.get('name')} ({column.get('data_type') or '?'}){flags}"
        )
    return "\n".join(lines)


def read(raw: str, table: dict) -> dict | None:
    """The term in a model's answer, cut to what is kept; None for an answer that names nothing.

    Only the table's own columns are kept, and the term's id is made from its name here.
    """
    from iblai_ontology.backend.discovery.llm_analyzer import _json_block

    try:
        said = _json_block(raw)
    except (ValueError, IndexError):
        return None
    if not isinstance(said, dict):
        return None
    name = _words(said.get("term"), 100)
    if not re.search(r"[^\W\d_]", name):  # a name holds a letter
        return None
    real = {str(c.get("name")) for c in table.get("columns") or []}
    columns = said.get("columns") if isinstance(said.get("columns"), dict) else {}
    synonyms = said.get("synonyms") if isinstance(said.get("synonyms"), list) else []
    others = [_words(s, 100) for s in synonyms]
    return {
        "id": _slug(name) or _slug(str(table.get("table_name") or "")) or "term",
        "name": name,
        "description": _words(said.get("description"), 2000),
        "synonyms": [s for s in others if s and s.lower() != name.lower()][:5],
        "columns": {
            str(column): label
            for column, label in ((c, _words(v, 100)) for c, v in columns.items())
            if str(column) in real and label
        },
    }


def _why(exc: Exception) -> str:
    """A refusal in words: the platform's status where it gave one, else the error's own."""
    known = _REFUSALS.get(getattr(exc, "status", None))
    return known or " ".join(str(exc).split())[:300]


def generate(service) -> str:
    """Ask the model for a term for each table that has none, biggest first, and say what came of it.

    Each answer is kept on its table's own row as it arrives, so a press that runs out of
    time loses nothing and the next one goes on. An answer that cannot be read is counted
    and left out, never made up. A refusal stops the run. Raises ``TermsError`` when
    nothing was written and something stopped it.
    """
    import httpx

    from iblai_ontology.backend import store
    from iblai_ontology.backend.discovery.config_generator import table_descriptions
    from iblai_ontology.backend.discovery.llm_analyzer import call_llm
    from iblai_ontology.backend.services.models import ServiceTable
    from iblai_ontology.backend.services.registry import summarise

    rows = store.filter(ServiceTable, service=service.pk)
    if not rows:
        raise TermsError(f"'{service.name}' has no tables yet: discover it first.")
    waiting = [row for row in rows if not (row.payload or {}).get("term")]
    if not waiting:
        return f"Every one of its {len(rows)} tables has a term already."
    waiting.sort(key=lambda row: -int((row.payload or {}).get("row_count") or 0))
    manifest = service.schema_manifest or {}
    told = table_descriptions(service.llm_analysis or {})

    def ask(row) -> str:
        table = row.payload
        about = told.get(_qualified(table)) or told.get(table.get("table_name")) or {}
        question = prompt(manifest, table, str(about.get("description") or ""))
        return call_llm(SYSTEM, question, default="iblai", timeout=CALL_TIMEOUT)

    made = unread = slow = 0
    stopped: Exception | None = None
    pool = ThreadPoolExecutor(max_workers=WORKERS)
    started = time.monotonic()
    try:
        asked = {pool.submit(ask, row): row for row in waiting}
        # The answers come back on the pool's threads; each is written here, on this one.
        for future in as_completed(asked, timeout=DEADLINE):
            row = asked[future]
            try:
                term = read(future.result(), row.payload)
            except httpx.TimeoutException:
                slow += 1
                continue
            except (
                Exception
            ) as exc:  # a refusal, or no model to ask: the rest would fare the same
                stopped = exc
                break
            if term is None:
                unread += 1
                continue
            row.payload = {**row.payload, "term": term}
            store.save(row, ["payload"])
            made += 1
            if time.monotonic() - started > DEADLINE:
                break
    except OutOfTime:
        pass
    finally:
        # What was not started is dropped; what is in the air is never written.
        pool.shutdown(wait=False, cancel_futures=True)
    if made:
        summarise(service, rows)
    left = len(waiting) - made
    if stopped is not None and not made:
        raise TermsError(f"No term was written: {_why(stopped)}.")
    said = [f"{made} of its {len(rows)} tables got a term."] if made else []
    if stopped is not None:
        said.append(f"Then it stopped: {_why(stopped)}.")
    if unread:
        said.append(f"{unread} answers could not be read and were left out.")
    if slow:
        said.append(f"{slow} were not answered in time.")
    if not made and stopped is None:
        raise TermsError("No term was written. " + " ".join(said))
    if left:
        said.append(f"{left} are left: press Generate terms again.")
    return " ".join(said)


def detail(service, term_id: str) -> dict:
    """A generated term's columns under their plain names, from the tables that hold it."""
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    columns = []
    for row in store.filter(ServiceTable, service=service.pk):
        term = (row.payload or {}).get("term") or {}
        if term.get("id") != term_id:
            continue
        columns += [
            {
                "name": label,
                "description": "",
                "certified": False,
                "table": row.payload.get("table_name") or "",
                "column": column,
            }
            for column, label in (term.get("columns") or {}).items()
        ]
    return {"columns": columns, "calculations": []}
