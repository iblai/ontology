"""Cron-based scheduling of the sync schedules (Component 2).

Celery beat runs one task a minute (``tasks.tick``), which asks :func:`due` of each
schedule. Sync modes:
  * full   — periodic full refresh (nightly/weekly)
  * delta  — frequent incremental refresh (minutes)
  * event  — driven by webhooks (registered out-of-band, not on a cron)
"""

from __future__ import annotations


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


def due(sched: dict) -> bool:
    """Whether a schedule's cron has come round since its newest run; one that never ran is due."""
    from celery.schedules import crontab

    from iblai_ontology.backend import store
    from iblai_ontology.backend.celery import app
    from iblai_ontology.backend.sync.models import SyncRun

    cron = sched.get("cron")
    if not cron or sched.get("enabled", True) is False:
        return False  # event-driven schedules have no cron; disabled ones never run
    last = store.first(SyncRun, order="-started_at", schedule_name=sched["name"])
    if last is None:
        return True
    return crontab(**_parse_cron(cron), app=app).is_due(last.started_at).is_due
