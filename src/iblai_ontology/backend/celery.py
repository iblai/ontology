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


@app.task(bind=True)
def debug_task(self) -> str:  # pragma: no cover - trivial
    return f"request: {self.request!r}"
