"""Base adapter for source systems (Component 5.5/5.6).

An adapter encodes system-specific knowledge: how to classify tables into entity
groups, plain-English descriptions for known tables, and sensible sync cadences.
It powers the rule-based fallback used when no LLM key is configured.
"""

from __future__ import annotations


class BaseAdapter:
    """Rule-based knowledge about a source system."""

    SYSTEM_NAME: str = "generic"
    DB_TYPE: str = "generic"
    SERVICE_TYPE: str = "database"  # "database" | "api"

    # prefix -> entity group
    TABLE_PATTERNS: dict[str, str] = {}
    # TABLE_NAME -> {"description", "sync_cadence", "suggested_tools"?}
    KNOWN_TABLES: dict[str, dict] = {}

    def classify_table(self, table_name: str) -> str:
        upper = table_name.upper()
        for prefix, group in self.TABLE_PATTERNS.items():
            if upper.startswith(prefix):
                return group
        return "other"

    def describe_table(self, table_name: str) -> str:
        known = self.KNOWN_TABLES.get(table_name.upper())
        if known:
            return known["description"]
        group = self.classify_table(table_name)
        return f"{table_name}: {group} table (no pre-built description available)"

    def suggest_sync_cadence(self, table_name: str, row_count: int) -> str:
        known = self.KNOWN_TABLES.get(table_name.upper())
        if known:
            return known.get("sync_cadence", "6h")
        if row_count > 1_000_000:
            return "24h"
        if row_count > 100_000:
            return "6h"
        if row_count > 10_000:
            return "1h"
        return "6h"

    def suggested_tools(self, table_name: str) -> list[dict]:
        known = self.KNOWN_TABLES.get(table_name.upper())
        return list(known.get("suggested_tools", [])) if known else []


# Registry of available adapters, keyed by the CLI service-type value.
_ADAPTERS: dict[str, type[BaseAdapter]] = {}


def register(*names: str):
    def _wrap(cls: type[BaseAdapter]) -> type[BaseAdapter]:
        for n in names:
            _ADAPTERS[n] = cls
        return cls

    return _wrap


def get_adapter(name: str) -> BaseAdapter:
    """Return an adapter instance for a service-type/adapter name."""
    # Import side-effect modules so registrations populate the registry.
    from iblai_ontology.backend.discovery import adapters as _pkg  # noqa: F401

    cls = _ADAPTERS.get(name, BaseAdapter)
    return cls()
