"""Google MCP Toolbox schema compliance.

Validates that ``tools.yaml`` conforms to the resource shapes Google MCP Toolbox
(github.com/googleapis/mcp-toolbox) expects: ``kind: source | tool | toolset``
documents with the required fields, recognised tool types, and toolsets that
reference defined tools. Django-free so the CLI can run it on a fresh checkout.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

# Source types Toolbox understands (the subset we use + common ones).
SOURCE_TYPES = {
    "postgres",
    "oracle",
    "mysql",
    "mssql",
    "sqlserver",
    "sqlite",
    "snowflake",
    "bigquery",
    "spanner",
}

# Tool types we emit / Toolbox supports for SQL sources.
TOOL_TYPES = {
    "postgres-sql",
    "oracle-sql",
    "mysql-sql",
    "mssql-sql",
    "sqlite-sql",
    "snowflake-sql",
    "http",
}


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

    with open(path) as f:
        docs = [d for d in yaml.safe_load_all(f) if d]

    source_names: set[str] = set()
    tool_names: set[str] = set()
    toolset_refs: list[tuple[str, list[str]]] = []

    for i, doc in enumerate(docs):
        kind = doc.get("kind")
        name = doc.get("name", f"<doc {i}>")
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
            for p in doc.get("parameters", []) or []:
                if "name" not in p or "type" not in p:
                    _err(report, f"tool '{name}' has a parameter missing name/type")
        elif kind == "toolset":
            report.toolsets += 1
            toolset_refs.append((name, doc.get("tools", []) or []))
        else:
            _err(report, f"document {i} has unknown kind '{kind}'")

    # Cross-references: tool.source must exist; toolset tools must exist.
    for doc in docs:
        if doc.get("kind") == "tool" and doc.get("source") and doc["source"] not in source_names:
            _err(report, f"tool '{doc.get('name')}' references undefined source '{doc['source']}'")
    for name, tools in toolset_refs:
        for t in tools:
            if t not in tool_names:
                _err(report, f"toolset '{name}' references undefined tool '{t}'")

    return report
