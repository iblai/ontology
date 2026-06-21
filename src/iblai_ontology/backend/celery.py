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


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):  # pragma: no cover - wiring
    """Populate the beat schedule from sync-schedules.yaml at startup."""
    try:
        from iblai_ontology.backend.sync.scheduler import build_beat_schedule

        sender.conf.beat_schedule.update(build_beat_schedule())
    except Exception:
        # A deployment without sync-schedules.yaml still boots.
        pass


@app.task(bind=True)
def debug_task(self) -> str:  # pragma: no cover - trivial
    return f"request: {self.request!r}"
