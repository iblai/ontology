"""API-based adapters.

API sources (Canvas, Slate, Workday, Salesforce, ServiceNow, Jira, …) don't have
a SQL schema to introspect, so a single data-driven :class:`ApiAdapter` serves
all of them — the per-system specifics (connection env, key operations, sync
cadences) live in the catalog and the vendored SKILL.md rather than in code.
"""

from __future__ import annotations

from iblai_ontology.catalog import list_entries

from .base import BaseAdapter, register

# Bare service-type names the `service add` enum uses, plus every API adapter
# referenced by catalog.yaml (derived so the two never drift apart).
_BARE_NAMES = ["canvas", "slate", "workday", "navigate"]
_API_ADAPTERS = _BARE_NAMES + [
    e.adapter for e in list_entries() if e.type == "api"
]


@register(*_API_ADAPTERS)
class ApiAdapter(BaseAdapter):
    """Generic REST adapter; specifics come from the catalog + SKILL.md."""

    SERVICE_TYPE = "api"
    DB_TYPE = "api"
