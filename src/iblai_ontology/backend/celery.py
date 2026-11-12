"""Celery application for scheduled and event-driven syncs (Component 2)."""

from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "iblai_ontology.backend.settings")

app = Celery("iblai_ontology")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks(
    [
        "iblai_ontology.backend.sync",
    ]
)
# One entry: the tick reads the schedules itself, so one saved in the console needs no restart.
app.conf.beat_schedule = {
    "sync-tick": {
        "task": "iblai_ontology.backend.sync.tasks.tick",
        "schedule": 60.0,
        # A tick the worker could not take within the minute is dropped, not piled up.
        "options": {"expires": 55},
    }
}


@app.task(bind=True)
def debug_task(self) -> str:  # pragma: no cover - trivial
    return f"request: {self.request!r}"
