"""Service registry models (Component 5.7)."""

from __future__ import annotations

import uuid

from django.db import models


class Service(models.Model):
    """A registered external service (database or API)."""

    class ServiceType(models.TextChoices):
        DATABASE = "database", "Database"
        API = "api", "REST API"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ERROR = "error", "Error"
        PENDING = "pending", "Pending Setup"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    display_name = models.CharField(max_length=255)
    service_type = models.CharField(max_length=20, choices=ServiceType.choices)
    adapter = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )

    host = models.CharField(max_length=255, blank=True, default="")
    # Connection details, Fernet-encrypted JSON (see encryption.py).
    connection_config_encrypted = models.BinaryField(null=True, blank=True)

    schema_manifest = models.JSONField(null=True, blank=True)
    llm_analysis = models.JSONField(null=True, blank=True)
    last_discovery_at = models.DateTimeField(null=True, blank=True)

    last_safety_check_at = models.DateTimeField(null=True, blank=True)
    safety_status = models.CharField(max_length=20, default="pending")

    last_sync_at = models.DateTimeField(null=True, blank=True)
    sync_status = models.CharField(max_length=20, default="never_run")
    tables_synced = models.IntegerField(default=0)
    rows_synced = models.BigIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.display_name} ({self.status})"


class ServiceHealth(models.Model):
    """A point-in-time health observation for a service."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service = models.ForeignKey(
        Service, on_delete=models.CASCADE, related_name="health_checks"
    )
    connected = models.BooleanField(default=False)
    read_only = models.BooleanField(default=False)
    latency_ms = models.IntegerField(default=0)
    checked_at = models.DateTimeField(auto_now_add=True)
    detail = models.JSONField(default=dict)

    class Meta:
        ordering = ["-checked_at"]
