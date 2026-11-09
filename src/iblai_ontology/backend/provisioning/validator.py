"""End-to-end provisioning validation (Component 6.6).

Pulls a bounded sample of the biggest tables through the service's own
connection and records the row counts on the run. API services have no tables to
sample; their first sync is the check.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TableValidation:
    table: str
    records: int
    ok: bool
    error: str = ""


@dataclass
class ValidationReport:
    results: list[TableValidation] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(r.ok for r in self.results)


class ProvisioningValidator:
    """Validates a freshly provisioned service with a bounded sample per table."""

    def __init__(
        self, service, *, sample_limit: int = 100, max_tables: int = 3
    ) -> None:
        self.service = service
        self.sample_limit = sample_limit
        self.max_tables = max_tables

    def validate(self) -> ValidationReport:
        from iblai_ontology.backend.sync.engine import SyncRunner

        report = ValidationReport()
        if self.service.service_type == "api":
            report.results.append(
                TableValidation(
                    "*", 0, ok=True, error="api source: checked by the first sync"
                )
            )
            return report
        manifest = self.service.schema_manifest or {}
        tables = sorted(
            manifest.get("tables", []),
            key=lambda t: t.get("row_count", 0),
            reverse=True,
        )[: self.max_tables]
        runner = SyncRunner()
        for t in tables:
            schema, name = t.get("schema_name") or "", t.get("table_name", "?")
            qualified = f"{schema}.{name}" if schema else name
            try:
                rows = runner.pull_table(
                    self.service, qualified, limit=self.sample_limit
                )
                report.results.append(TableValidation(name, len(rows), ok=True))
            except Exception as exc:  # pragma: no cover - integration path
                report.results.append(
                    TableValidation(name, 0, ok=False, error=str(exc)[:200])
                )
        return report
