"""API-based adapters.

API sources (Canvas, Slate, Workday, Salesforce, ServiceNow, Jira, …) don't have
a SQL schema to introspect, so a single data-driven :class:`ApiAdapter` serves
all of them — the per-system specifics (connection env, key operations, sync
cadences) live in the catalog and the vendored SKILL.md rather than in code.
"""

from __future__ import annotations

from .base import BaseAdapter, register

# Every API adapter name referenced by catalog.yaml, plus the bare service-type
# names the `service add` enum uses.
_API_ADAPTERS = [
    "canvas",
    "slate",
    "workday",
    "navigate",
    "canvas_api",
    "slate_api",
    "workday_api",
    "navigate_api",
    "banner_api",
    "salesforce_api",
    "servicenow_api",
    "civitas_api",
    "handshake_api",
    "raisers_edge_api",
    "hubspot_api",
    "jira_api",
    "confluence_api",
    "github_api",
    "okta_api",
    "slack_api",
    "zendesk_api",
    "zoom_api",
]


@register(*_API_ADAPTERS)
class ApiAdapter(BaseAdapter):
    """Generic REST adapter; specifics come from the catalog + SKILL.md."""

    SERVICE_TYPE = "api"
    DB_TYPE = "api"
