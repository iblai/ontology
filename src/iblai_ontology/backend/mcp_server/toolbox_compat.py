"""Google MCP Toolbox schema compliance.

Validates that ``tools.yaml`` conforms to the resource shapes Google MCP Toolbox
(github.com/googleapis/mcp-toolbox) expects: ``kind: source | tool | toolset``
documents with the required fields, recognised tool types, and toolsets that
reference defined tools. Django-free so the CLI can run it on a fresh checkout.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from iblai_ontology.backend.mcp_server.toolbox_config import _INJECTION_RE

# Source types Toolbox understands (the subset we use + common ones).
SOURCE_TYPES = {
    "postgres",
    "oracle",
    "mysql",
    "mssql",
    "sqlserver",
    "sqlite",
    "snowflake",
    "trino",
    "clickhouse",
    "bigquery",
    "spanner",
    "http",
}

# Tool types we emit / Toolbox supports for SQL sources.
TOOL_TYPES = {
    "postgres-sql",
    "oracle-sql",
    "mysql-sql",
    "mssql-sql",
    "sqlite-sql",
    "snowflake-sql",
    "trino-sql",
    "clickhouse-sql",
    "http",
}

# The gateway runs its own read-only code for these when tools.yaml leaves the statement to it.
GATEWAY_TOOLS = {"read-memory", "query-ontology-cache", "get-sync-status"}
# What a statement that only reads starts with; EXPLAIN is absent, EXPLAIN ANALYZE runs the query.
_READ_LEAD_RE = re.compile(
    r"[\s(]*(SELECT|WITH|SHOW|DESCRIBE|DESC|VALUES|TABLE)\b", re.IGNORECASE
)
# Any of these words anywhere makes a statement a write: a CTE, SELECT INTO and a T-SQL batch hide them.
_WRITE_WORD_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|INTO|TRUNCATE|DROP|ALTER|CREATE|RENAME|GRANT"
    r"|REVOKE|CALL|EXEC|EXECUTE|COPY|LOCK)\b",
    re.IGNORECASE,
)


def _why_statement_writes(statement) -> str | None:
    """Why a SQL statement counts as a write, or None when it only reads."""
    if not isinstance(statement, str) or not statement.strip():
        return "it has no statement of its own, so the caller writes the SQL"
    body = statement.strip().rstrip(";").rstrip()
    if ";" in body:
        return "its statement holds a ';', so more than one statement"
    if not _READ_LEAD_RE.match(body):
        return "its statement does not start with SELECT, WITH, SHOW, DESCRIBE, VALUES or TABLE"
    word = _WRITE_WORD_RE.search(body)
    return f"its statement holds {word[0].upper()}" if word else None


def writing_tools(docs: list[dict]) -> dict[str, str]:
    """The tools of a tools.yaml that can change data, each with why.

    Fails closed: a tool not known to read counts as a write. It is a text scan, not a
    parser, so a write word inside a string counts too, and a function that writes
    inside a SELECT is not seen (the read source's read-only account is what stops it).
    """
    tools = [d for d in docs if isinstance(d, dict) and d.get("kind") == "tool"]
    why: dict[str, str] = {}
    gateway: set[str] = set()
    for tool in tools:
        name, kind = str(tool.get("name")), str(tool.get("type") or "")
        statement = tool.get("statement")
        if (
            name in GATEWAY_TOOLS
            and isinstance(statement, str)
            and _INJECTION_RE.search(statement)
        ):
            gateway.add(name)  # never reaches the Toolbox, whatever its source
            continue
        if kind == "http":
            method = str(tool.get("method") or "").upper()
            reason = (
                None
                if method in ("GET", "HEAD")
                else f"its method is {method or 'not given'}"
            )
        elif not kind.endswith("-sql") or kind.endswith("-execute-sql"):
            reason = f"its type ({kind or 'none'}) does not run one fixed statement"
        elif tool.get("templateParameters"):
            reason = "its templateParameters let the caller change the SQL"
        else:
            reason = _why_statement_writes(statement)
        if reason:
            why[name] = reason
    # A source one tool writes through is a write account: every tool on it counts.
    through: dict[str, str] = {}
    for tool in tools:
        if str(tool.get("name")) in why and tool.get("source"):
            through.setdefault(str(tool["source"]), str(tool.get("name")))
    for tool in tools:
        name, source = str(tool.get("name")), str(tool.get("source") or "")
        if name not in why and name not in gateway and source in through:
            why[name] = f"it shares the source '{source}' with '{through[source]}'"
    return why


@dataclass
class ComplianceIssue:
    severity: str  # "error" | "warning"
    message: str


@dataclass
class ComplianceReport:
    sources: int = 0
    tools: int = 0
    toolsets: int = 0
    issues: list[ComplianceIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)


def _err(report: ComplianceReport, msg: str) -> None:
    report.issues.append(ComplianceIssue("error", msg))


def _warn(report: ComplianceReport, msg: str) -> None:
    report.issues.append(ComplianceIssue("warning", msg))


def validate_tools_yaml(path: str | Path) -> ComplianceReport:
    """Validate a tools.yaml file against the Toolbox resource schema."""
    report = ComplianceReport()
    path = Path(path)
    if not path.exists():
        _err(report, f"tools.yaml not found at {path}")
        return report

    try:
        with open(path) as f:
            docs = [d for d in yaml.safe_load_all(f) if d]
    except yaml.YAMLError as exc:
        _err(report, "YAML parse error: " + " ".join(str(exc).split()))
        return report
    for i, d in enumerate(docs):
        if not isinstance(d, dict):
            _err(report, f"document {i} is not a mapping")
    docs = [d for d in docs if isinstance(d, dict)]

    source_names: set[str] = set()
    tool_names: set[str] = set()
    toolset_refs: list[tuple[str, list[str]]] = []
    seen: set[tuple] = set()

    for i, doc in enumerate(docs):
        kind = doc.get("kind")
        name = doc.get("name", f"<doc {i}>")
        if kind in ("source", "tool", "toolset"):
            if (kind, name) in seen:
                # The gateway would read the last one and the Toolbox its own pick.
                _err(report, f"two {kind}s are named '{name}'")
            seen.add((kind, name))
        if kind == "source":
            report.sources += 1
            source_names.add(name)
            stype = doc.get("type")
            if not stype:
                _err(report, f"source '{name}' missing 'type'")
            elif stype not in SOURCE_TYPES:
                _warn(report, f"source '{name}' has unrecognised type '{stype}'")
        elif kind == "tool":
            report.tools += 1
            tool_names.add(name)
            ttype = doc.get("type")
            if not ttype:
                _err(report, f"tool '{name}' missing 'type'")
            elif ttype not in TOOL_TYPES:
                _warn(report, f"tool '{name}' has unrecognised type '{ttype}'")
            if not doc.get("source"):
                _err(report, f"tool '{name}' missing 'source'")
            if "statement" not in doc and ttype != "http":
                _err(report, f"tool '{name}' missing 'statement'")
            if ttype == "http":
                for key in ("method", "path"):
                    if not doc.get(key):
                        _err(report, f"http tool '{name}' missing '{key}'")
            for p in doc.get("parameters", []) or []:
                if "name" not in p or "type" not in p:
                    _err(report, f"tool '{name}' has a parameter missing name/type")
        elif kind == "toolset":
            report.toolsets += 1
            toolset_refs.append((name, doc.get("tools", []) or []))
            if not isinstance(doc.get("write", False), bool):
                _err(report, f"toolset '{name}' has 'write' that is not true or false")
        else:
            _err(report, f"document {i} has unknown kind '{kind}'")

    # Cross-references: tool.source must exist; toolset tools must exist.
    for doc in docs:
        if (
            doc.get("kind") == "tool"
            and doc.get("source")
            and doc["source"] not in source_names
        ):
            _err(
                report,
                f"tool '{doc.get('name')}' references undefined source '{doc['source']}'",
            )
    for name, tools in toolset_refs:
        for t in tools:
            if t not in tool_names:
                _err(report, f"toolset '{name}' references undefined tool '{t}'")

    # A tool that can change data lives only in a toolset marked as writing.
    writing = writing_tools(docs)
    for doc in docs:
        if doc.get("kind") != "toolset" or doc.get("write") is True:
            continue
        for t in doc.get("tools", []) or []:
            if t in writing:
                _err(
                    report,
                    f"toolset '{doc.get('name')}' holds '{t}', which can change data "
                    f"({writing[t]}): mark the toolset as one that changes data "
                    "(write: true), or take the tool out of it",
                )

    return report


# ``${VAR}``, or a scheme word and ``${VAR}`` as an Authorization header is written.
_ENV_REF_RE = re.compile(r"^(?:[A-Za-z][A-Za-z0-9-]* )?\$\{[A-Z0-9_]+\}$")


def _literal_secrets(value, where: str = ""):
    """The paths of secret-looking keys, at any depth, whose value is not a ``${VAR}`` reference."""
    from iblai_ontology.config.reader import _SECRET_KEY_RE

    if isinstance(value, list):
        for inner in value:
            yield from _literal_secrets(inner, where)
    if not isinstance(value, dict):
        return
    for key, inner in value.items():
        path = f"{where}.{key}" if where else str(key)
        typed = isinstance(inner, (str, int, float)) and not isinstance(inner, bool)
        if typed and _SECRET_KEY_RE.search(str(key)):
            if not _ENV_REF_RE.match(str(inner)):
                yield path
        else:
            yield from _literal_secrets(inner, path)


def save_tools_yaml(text: str, path: str | Path) -> ComplianceReport:
    """Validate ``text`` as a tools.yaml and atomically replace ``path`` only if it passes.

    Literal secrets on sources and tools are refused: the file holds ``${VAR}``
    references, so a password typed into the console never lands on disk.
    """
    path = Path(path)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text)
    try:
        report = validate_tools_yaml(tmp)
        if not text.strip():
            _err(report, "tools.yaml must not be empty")
        if report.ok:
            with open(tmp) as f:
                docs = [d for d in yaml.safe_load_all(f) if isinstance(d, dict)]
            for doc in docs:
                if doc.get("kind") not in ("source", "tool"):
                    continue
                for key in _literal_secrets(doc):
                    _err(
                        report,
                        f"{doc['kind']} '{doc.get('name')}' has a literal '{key}'; "
                        "use a ${VAR} reference",
                    )
        if report.ok:
            os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return report
