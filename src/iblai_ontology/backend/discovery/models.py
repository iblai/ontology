"""Discovery models (Component 5): safety reports."""

from __future__ import annotations

import uuid

from django.db import models


class SafetyReport(models.Model):
    """Records the result of a read-only safety verification."""

    class Status(models.TextChoices):
        PASSED = "passed", "All write operations correctly denied"
        FAILED = "failed", "One or more write operations succeeded (DANGEROUS)"
        ERROR = "error", "Could not complete verification"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service_name = models.CharField(max_length=255)
    db_type = models.CharField(max_length=50)
    host = models.CharField(max_length=255)
    port = models.IntegerField()
    database = models.CharField(max_length=255)
    username = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices)
    tests_run = models.IntegerField(default=0)
    tests_passed = models.IntegerField(default=0)
    tests_failed = models.IntegerField(default=0)
    details = models.JSONField(default=dict)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"SafetyReport({self.service_name}, {self.status})"
