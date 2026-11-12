"""Celery tasks for the sync engine (Component 2).

Bound to the project's app, so a call from the console is queued on its broker, and runs
where it is called when none is configured (``CELERY_TASK_ALWAYS_EAGER``).
"""

from __future__ import annotations

import logging

from iblai_ontology.backend.celery import app

logger = logging.getLogger("iblai_ontology.sync")


@app.task(name="iblai_ontology.backend.sync.tasks.run_schedule")
def run_schedule(schedule_name: str, due_only: bool = False) -> dict:
    """Run a single named sync schedule; with ``due_only``, only while its cron is still due."""
    from iblai_ontology.backend.sync import scheduler, schedules
    from iblai_ontology.backend.sync.engine import SyncRunner

    sched = next((s for s in schedules.all() if s["name"] == schedule_name), None)
    if not sched:
        return {"schedule": schedule_name, "status": "not_found"}
    if due_only and not scheduler.due(sched):
        return {"schedule": schedule_name, "status": "not_due"}
    result = SyncRunner()._run_schedule(sched, force_full=False)
    return {
        "schedule": result.schedule_name,
        "status": result.status,
        "records": result.records_processed,
    }


@app.task(name="iblai_ontology.backend.sync.tasks.run_service")
def run_service(service: str) -> int:
    """Run every enabled schedule of one service."""
    from iblai_ontology.backend.sync.engine import SyncRunner

    return len(SyncRunner().run_service(service))


@app.task(name="iblai_ontology.backend.sync.tasks.run_all_due")
def run_all_due() -> int:
    """Run all configured schedules, whatever their cron."""
    from iblai_ontology.backend.sync.engine import SyncRunner

    return len(SyncRunner().run_all_due())


@app.task(name="iblai_ontology.backend.sync.tasks.write_rows")
def write_rows(schedule_name: str, rows: list[dict]) -> dict:
    """Write rows a tool just changed at the source into the cache and the memories, as their schedule would."""
    from iblai_ontology.backend.sync import schedules
    from iblai_ontology.backend.sync.engine import SyncRunner

    sched = next((s for s in schedules.all() if s["name"] == schedule_name), None)
    if not sched:
        return {"schedule": schedule_name, "status": "not_found"}
    return SyncRunner()._write(sched, rows)


@app.task(name="iblai_ontology.backend.sync.tasks.tick")
def tick() -> list[str]:
    """Queue every schedule whose cron has come due since its last run; beat calls this each minute."""
    from iblai_ontology.backend.sync import scheduler, schedules

    queued = []
    for sched in schedules.all():
        try:
            if scheduler.due(sched):
                # Asked again when it starts: a schedule still waiting in the queue is not run twice.
                run_schedule.delay(sched["name"], due_only=True)
                queued.append(sched["name"])
        except Exception:
            # One schedule with a cron that cannot be read does not stop the others.
            logger.exception("tick: %s could not be scheduled", sched.get("name"))
    return queued
