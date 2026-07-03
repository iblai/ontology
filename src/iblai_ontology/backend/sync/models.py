"""Sync engine models (Component 2)."""

from __future__ import annotations

import uuid

from django.db import models


class SyncSchedule(models.Model):
    """A configured sync schedule (mirrors an entry in sync-schedules.yaml)."""

    class Mode(models.TextChoices):
        FULL = "full", "Full refresh"
        DELTA = "delta", "Delta refresh"
        EVENT = "event", "Event-driven"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    cron = models.CharField(max_length=100, blank=True, default="")
    source = models.CharField(max_length=255)
    tool = models.CharField(max_length=255)
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.FULL)
    text_memories_path = models.CharField(max_length=500, blank=True, default="")
    structured_cache_table = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.cron})"


class SyncRun(models.Model):
    """A single execution of a sync schedule."""

    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    schedule_name = models.CharField(max_length=255)
    source_system = models.CharField(max_length=255)
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.RUNNING
    )
    records_processed = models.IntegerField(default=0)
    records_created = models.IntegerField(default=0)
    records_updated = models.IntegerField(default=0)
    error_message = models.TextField(blank=True, null=True)
    duration_seconds = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["schedule_name"]),
            models.Index(fields=["status"]),
        ]
