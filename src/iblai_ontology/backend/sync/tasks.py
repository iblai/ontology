"""Celery tasks for the sync engine (Component 2)."""

from __future__ import annotations

from celery import shared_task


@shared_task(name="iblai_ontology.backend.sync.tasks.run_schedule")
def run_schedule(schedule_name: str) -> dict:
    """Run a single named sync schedule."""
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.config.reader import ConfigReader

    sched = next(
        (s for s in ConfigReader().get_sync_schedules() if s["name"] == schedule_name),
        None,
    )
    if not sched:
        return {"schedule": schedule_name, "status": "not_found"}
    result = SyncRunner()._run_schedule(sched, force_full=False)
    return {
        "schedule": result.schedule_name,
        "status": result.status,
        "records": result.records_processed,
    }


@shared_task(name="iblai_ontology.backend.sync.tasks.run_all_due")
def run_all_due() -> int:
    """Run all configured schedules (cadence is enforced by beat)."""
    from iblai_ontology.backend.sync.engine import SyncRunner

    return len(SyncRunner().run_all_due())
