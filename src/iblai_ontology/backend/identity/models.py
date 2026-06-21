"""Identity & permissions models (Component 3)."""

from __future__ import annotations

import uuid

from django.db import models


class IdentityMap(models.Model):
    """Maps an Entra ID object id to a source-system person id (e.g. EMPLID).

    Populated during sync by matching on email. Used to resolve ``${USER_EMPLID}``
    in role memory paths so a student can only see their own record.
    """

    entra_oid = models.CharField(max_length=255, primary_key=True)
    emplid = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    full_name = models.CharField(max_length=255, blank=True, default="")
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["email"])]

    def __str__(self) -> str:
        return f"{self.email} -> {self.emplid}"


class AuditLog(models.Model):
    """Every data access (allowed or denied), keyed by JWT jti for traceability."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(auto_now_add=True)
    user_id = models.CharField(max_length=255)
    user_email = models.EmailField(blank=True, default="")
    user_role = models.CharField(max_length=255)
    action = models.CharField(max_length=255)
    resource = models.CharField(max_length=500)
    allowed = models.BooleanField(default=True)
    details = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    session_id = models.CharField(max_length=255, blank=True, default="")
    entra_token_id = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["timestamp"]),
            models.Index(fields=["user_id"]),
            models.Index(fields=["entra_token_id"]),
        ]
