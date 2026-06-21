"""API-based adapters: Canvas, Slate, Workday, EAB Navigate.

These describe REST sources rather than databases. Schema introspection for
APIs is handled by the corresponding custom MCP server; the adapter here carries
entity grouping + sync cadence knowledge for config generation.
"""

from __future__ import annotations

from .base import BaseAdapter, register


@register("canvas")
class CanvasAdapter(BaseAdapter):
    SYSTEM_NAME = "canvas"
    DB_TYPE = "api"
    SERVICE_TYPE = "api"
    KNOWN_TABLES = {
        "ENROLLMENTS": {"description": "Canvas course enrollments + grades.", "sync_cadence": "6h"},
        "SUBMISSIONS": {"description": "Assignment submissions + scores.", "sync_cadence": "1h"},
    }


@register("slate")
class SlateAdapter(BaseAdapter):
    SYSTEM_NAME = "slate"
    DB_TYPE = "api"
    SERVICE_TYPE = "api"
    KNOWN_TABLES = {
        "APPLICATIONS": {"description": "Slate admissions applications.", "sync_cadence": "6h"},
    }


@register("workday")
class WorkdayAdapter(BaseAdapter):
    SYSTEM_NAME = "workday"
    DB_TYPE = "api"
    SERVICE_TYPE = "api"
    KNOWN_TABLES = {
        "WORKERS": {"description": "Workday worker/employee records.", "sync_cadence": "24h"},
    }


@register("navigate")
class NavigateAdapter(BaseAdapter):
    SYSTEM_NAME = "navigate"
    DB_TYPE = "api"
    SERVICE_TYPE = "api"
    KNOWN_TABLES = {
        "ALERTS": {"description": "EAB Navigate early-alert / risk signals.", "sync_cadence": "1h"},
        "APPOINTMENTS": {"description": "Advising appointments + notes.", "sync_cadence": "6h"},
    }
