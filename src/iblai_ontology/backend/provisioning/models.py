"""Provisioning models (Component 6)."""

from __future__ import annotations

import uuid

from django.db import models


class ProvisioningRun(models.Model):
    """Tracks a provisioning pipeline execution."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        ROLLED_BACK = "rolled_back", "Rolled Back"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service = models.ForeignKey(
        "services.Service", on_delete=models.CASCADE, related_name="provisioning_runs"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, null=True)
    config_snapshot = models.JSONField(default=dict)
    rollback_data = models.JSONField(default=dict)

    class Meta:
        ordering = ["-started_at"]


class ProvisioningStep(models.Model):
    """Individual step within a provisioning run."""

    class StepType(models.TextChoices):
        CACHE_SCHEMA = "cache_schema", "PostgreSQL Cache Schema"
        TEXT_TEMPLATES = "text_templates", "Text Memory Templates"
        MCP_TOOLS = "mcp_tools", "MCP Tools Configuration"
        SYNC_SCHEDULES = "sync_schedules", "Sync Schedules"
        DOCKER_COMPOSE = "docker_compose", "Docker Compose Update"
        VALIDATION = "validation", "End-to-End Validation"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(
        ProvisioningRun, on_delete=models.CASCADE, related_name="steps"
    )
    step_type = models.CharField(max_length=30, choices=StepType.choices)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    output = models.JSONField(default=dict)
    error_message = models.TextField(blank=True, null=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]
