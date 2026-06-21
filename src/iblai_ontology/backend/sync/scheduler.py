"""Cron-based scheduling from sync-schedules.yaml (Component 2).

Translates the declarative schedules into Celery beat entries. Sync modes:
  * full   — periodic full refresh (nightly/weekly)
  * delta  — frequent incremental refresh (minutes)
  * event  — driven by webhooks (registered out-of-band, not on a cron)
"""

from __future__ import annotations

from typing import Any

from iblai_ontology.config.reader import ConfigReader


def _parse_cron(expr: str) -> dict[str, str]:
    """Split a 5-field cron string into celery crontab kwargs."""
    minute, hour, dom, month, dow = (expr.split() + ["*"] * 5)[:5]
    return {
        "minute": minute,
        "hour": hour,
        "day_of_month": dom,
        "month_of_year": month,
        "day_of_week": dow,
    }


def infer_mode(cron: str) -> str:
    """Heuristically classify a schedule by cadence."""
    minute = cron.split()[0] if cron else "0"
    if minute.startswith("*/"):
        return "delta"
    return "full"


def build_beat_schedule() -> dict[str, dict[str, Any]]:
    """Build a Celery beat schedule dict from sync-schedules.yaml."""
    from celery.schedules import crontab

    beat: dict[str, dict[str, Any]] = {}
    for sched in ConfigReader().get_sync_schedules():
        name = sched["name"]
        cron = sched.get("cron")
        if not cron:
            continue  # event-driven schedules have no cron
        beat[f"sync-{name}"] = {
            "task": "iblai_ontology.backend.sync.tasks.run_schedule",
            "schedule": crontab(**_parse_cron(cron)),
            "args": (name,),
        }
    return beat
