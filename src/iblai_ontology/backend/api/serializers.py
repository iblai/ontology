"""DRF serializers for the console REST API.

Every response body the SPA consumes is produced by one of these serializers —
Django models, the Django-free health/safety dataclasses, config dicts, and the
``{ok, message}`` action envelopes alike. The TypeScript contract in
``portal/lib/ontology/types.ts`` is the source of truth for field names and
shapes; the mismatches it documents (encrypted Service config, dict-keyed
``by_domain``, flat ``details`` dict, Decimal durations) are reconciled here so
views stay thin.
"""

from __future__ import annotations

from functools import lru_cache

from rest_framework import serializers

from iblai_ontology.backend.discovery.models import SafetyReport
from iblai_ontology.backend.provisioning.models import ProvisioningRun, ProvisioningStep
from iblai_ontology.backend.services.models import Service, ServiceHealth
from iblai_ontology.config.reader import _redact

# ---------------------------------------------------------------------------
# Health snapshot (dataclasses from backend/health/checks.py)
# ---------------------------------------------------------------------------


class DbHealthSerializer(serializers.Serializer):
    healthy = serializers.BooleanField()
    table_count = serializers.IntegerField()
    total_rows = serializers.IntegerField()
    size_mb = serializers.FloatField()
    active_connections = serializers.IntegerField()


class McpServerHealthSerializer(serializers.Serializer):
    reachable = serializers.BooleanField()
    latency_ms = serializers.IntegerField()
    tool_count = serializers.IntegerField()
    name = serializers.CharField()


class SyncHealthSerializer(serializers.Serializer):
    running = serializers.BooleanField()
    total_schedules = serializers.IntegerField()
    failed_last_24h = serializers.IntegerField()
    next_due_schedule = serializers.CharField(required=False, allow_blank=True)
    next_due_at = serializers.CharField(required=False, allow_blank=True)


class StorageHealthSerializer(serializers.Serializer):
    total_files = serializers.IntegerField()
    total_size_mb = serializers.FloatField()
    by_domain = serializers.SerializerMethodField()

    def get_by_domain(self, obj):
        # StorageHealth.by_domain is {domain: {files, size_mb}}; TS wants a list.
        return [
            {
                "domain": domain,
                "files": int(vals.get("files", 0)),
                "size_mb": float(vals.get("size_mb", 0.0)),
            }
            for domain, vals in (obj.by_domain or {}).items()
        ]


class GatewayHealthSerializer(serializers.Serializer):
    running = serializers.BooleanField()
    url = serializers.CharField(allow_blank=True)
    tool_count = serializers.IntegerField()
    toolset_count = serializers.IntegerField()
    active_sessions = serializers.IntegerField()


class HealthSnapshotSerializer(serializers.Serializer):
    db = DbHealthSerializer()
    mcp_servers = McpServerHealthSerializer(many=True)
    sync = SyncHealthSerializer()
    storage = StorageHealthSerializer()
    gateway = GatewayHealthSerializer()
    checked_at = serializers.DateTimeField()


# ---------------------------------------------------------------------------
# Service (model — encrypted config flattened, secrets masked)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _adapter_domain_map() -> dict[str, str]:
    """adapter -> domain, from the built-in catalog (for domain inference)."""
    from iblai_ontology.catalog import list_entries

    return {e.adapter: e.domain for e in list_entries()}


class ServiceSerializer(serializers.ModelSerializer):
    """Serializes a Service, flattening its Fernet-encrypted connection config.

    ``connection_config_encrypted`` is never in ``fields`` (secret at rest); the
    plaintext is decrypted once per object and exposed only as a masked
    ``connection_config`` plus flattened ``port``/``database``. ``domain`` is
    inferred from the catalog (not a model column).
    """

    port = serializers.SerializerMethodField()
    database = serializers.SerializerMethodField()
    connection_config = serializers.SerializerMethodField()
    domain = serializers.SerializerMethodField()
    schema_manifest = serializers.SerializerMethodField()

    class Meta:
        model = Service
        fields = [
            "name",
            "display_name",
            "service_type",
            "adapter",
            "status",
            "host",
            "port",
            "database",
            "connection_config",
            "schema_manifest",
            "llm_analysis",
            "last_discovery_at",
            "last_safety_check_at",
            "safety_status",
            "last_sync_at",
            "sync_status",
            "tables_synced",
            "rows_synced",
            "domain",
        ]

    def _config(self, obj) -> dict:
        cached = getattr(obj, "_decrypted_config", None)
        if cached is None:
            from iblai_ontology.backend.services.encryption import (
                decrypt_connection_config,
            )

            try:
                cached = decrypt_connection_config(obj.connection_config_encrypted)
            except Exception:  # never 500 a listing over one bad blob
                cached = {}
            obj._decrypted_config = cached
        return cached

    def get_port(self, obj):
        port = self._config(obj).get("port")
        try:
            return int(port) if port not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def get_database(self, obj):
        return self._config(obj).get("database")

    def get_connection_config(self, obj) -> dict:
        # _redact masks password/secret/token/key values; then stringify to the
        # Record<string,string> the SPA expects.
        return {k: str(v) for k, v in _redact(dict(self._config(obj))).items()}

    def get_domain(self, obj) -> str:
        return _adapter_domain_map().get(obj.adapter, "higher-ed")

    def get_schema_manifest(self, obj):
        m = obj.schema_manifest
        if not m:
            return None
        tables = [
            {
                "schema_name": t.get("schema_name", ""),
                "table_name": t.get("table_name", ""),
                "row_count": int(t.get("row_count", 0) or 0),
                "column_count": int(
                    t.get("column_count", len(t.get("columns", []) or []))
                ),
            }
            for t in (m.get("tables") or [])
        ]
        return {
            "db_type": m.get("db_type", ""),
            "total_tables": int(m.get("total_tables", len(tables)) or 0),
            "total_rows": int(m.get("total_rows", 0) or 0),
            "tables": tables,
        }


class ServiceHealthSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    service_name = serializers.CharField(source="service.name", read_only=True)

    class Meta:
        model = ServiceHealth
        fields = [
            "id",
            "service_name",
            "connected",
            "read_only",
            "latency_ms",
            "checked_at",
            "detail",
        ]


# ---------------------------------------------------------------------------
# Safety report (model — flat details dict -> TS record array)
# ---------------------------------------------------------------------------


class SafetyReportSerializer(serializers.ModelSerializer):
    details = serializers.SerializerMethodField()

    class Meta:
        model = SafetyReport
        fields = [
            "service_name",
            "db_type",
            "host",
            "port",
            "database",
            "username",
            "status",
            "tests_run",
            "tests_passed",
            "tests_failed",
            "details",
            "error_message",
            "created_at",
        ]

    def get_details(self, obj):
        d = obj.details or {}
        if isinstance(d, list):  # already array-shaped
            return d
        # Persisted DiscoveryEngine reports store a flat {test_name: result} map.
        return [
            {"test_name": k, "sql_attempted": "", "result": v, "detail": ""}
            for k, v in d.items()
        ]


# ---------------------------------------------------------------------------
# Provisioning runs + steps (models)
# ---------------------------------------------------------------------------


class ProvisioningStepSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    run_id = serializers.CharField(read_only=True)

    class Meta:
        model = ProvisioningStep
        fields = [
            "id",
            "run_id",
            "step_type",
            "status",
            "order",
            "started_at",
            "completed_at",
            "output",
            "error_message",
        ]


class ProvisioningRunSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    service_name = serializers.CharField(source="service.name", read_only=True)
    steps = ProvisioningStepSerializer(many=True, read_only=True)

    class Meta:
        model = ProvisioningRun
        fields = [
            "id",
            "service_name",
            "status",
            "started_at",
            "completed_at",
            "error_message",
            "config_snapshot",
            "steps",
        ]


# ---------------------------------------------------------------------------
# Sync schedules (config yaml) + runs (model)
# ---------------------------------------------------------------------------


class SyncScheduleSerializer(serializers.Serializer):
    """Reads ConfigReader().get_sync_schedules() dicts (or SyncSchedule rows)."""

    name = serializers.CharField()
    cron = serializers.CharField(required=False, allow_blank=True, default="")
    source = serializers.CharField(required=False, allow_blank=True, default="")
    tool = serializers.CharField(required=False, allow_blank=True, default="")
    mode = serializers.SerializerMethodField()
    description = serializers.CharField(required=False, allow_blank=True, default="")
    enabled = serializers.SerializerMethodField()

    def _get(self, obj, key, default=None):
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    def get_mode(self, obj) -> str:
        mode = self._get(obj, "mode")
        if mode:
            return mode
        # ponytail: yaml schedules carry no mode; infer from the name suffix
        # (…-delta / …-event / …-full). Widen if the DSL grows a mode field.
        name = self._get(obj, "name", "") or ""
        for m in ("delta", "event", "full"):
            if name.endswith(f"-{m}"):
                return m
        return "full"

    def get_enabled(self, obj) -> bool:
        val = self._get(obj, "enabled", True)
        return True if val is None else bool(val)


class SyncRunSerializer(serializers.Serializer):
    id = serializers.CharField()
    schedule_name = serializers.CharField()
    source_system = serializers.CharField()
    started_at = serializers.DateTimeField()
    completed_at = serializers.DateTimeField(required=False, allow_null=True)
    status = serializers.CharField()
    records_processed = serializers.IntegerField()
    records_created = serializers.IntegerField()
    records_updated = serializers.IntegerField()
    error_message = serializers.CharField(required=False, allow_null=True)
    duration_seconds = serializers.FloatField()  # model DecimalField -> float


# ---------------------------------------------------------------------------
# MCP catalog (config dicts) + gateway + compliance
# ---------------------------------------------------------------------------


class McpSourceSerializer(serializers.Serializer):
    kind = serializers.CharField(default="source")
    name = serializers.CharField()
    type = serializers.CharField(required=False, allow_blank=True, default="")
    host = serializers.CharField(required=False)
    # port is CharField, not IntegerField: tools.yaml sources use ${ENV} tokens
    # (kept verbatim as config references), which are strings, not integers.
    port = serializers.CharField(required=False)
    database = serializers.CharField(required=False)
    user = serializers.CharField(required=False)
    password = serializers.CharField(required=False)


class McpToolParameterSerializer(serializers.Serializer):
    name = serializers.CharField()
    type = serializers.CharField(required=False, allow_blank=True, default="")
    description = serializers.CharField(required=False, allow_blank=True, default="")
    required = serializers.BooleanField(required=False)


class McpToolSerializer(serializers.Serializer):
    kind = serializers.CharField(default="tool")
    name = serializers.CharField()
    type = serializers.CharField(required=False, allow_blank=True, default="")
    source = serializers.CharField(required=False, allow_blank=True, default="")
    description = serializers.CharField(required=False, allow_blank=True, default="")
    parameters = serializers.SerializerMethodField()
    statement = serializers.CharField(required=False, allow_blank=True)

    def get_parameters(self, obj):
        params = (obj.get("parameters") if isinstance(obj, dict) else None) or []
        return McpToolParameterSerializer(params, many=True).data


class McpToolsetSerializer(serializers.Serializer):
    kind = serializers.CharField(default="toolset")
    name = serializers.CharField()
    tools = serializers.ListField(child=serializers.CharField(), default=list)


class ComplianceIssueSerializer(serializers.Serializer):
    severity = serializers.CharField()
    message = serializers.CharField()


class ComplianceReportSerializer(serializers.Serializer):
    sources = serializers.IntegerField()
    tools = serializers.IntegerField()
    toolsets = serializers.IntegerField()
    issues = ComplianceIssueSerializer(many=True)


# ---------------------------------------------------------------------------
# Roles (Permissions dataclass) + counts
# ---------------------------------------------------------------------------


class RoleSerializer(serializers.Serializer):
    name = serializers.CharField(source="role")
    display_name = serializers.CharField()
    mcp_toolsets = serializers.ListField(child=serializers.CharField())
    memory_paths = serializers.ListField(child=serializers.CharField())
    cache_tables = serializers.ListField(child=serializers.CharField())
    admin_dashboard = serializers.BooleanField()
    agents = serializers.ListField(child=serializers.CharField())
    concurrency_limits = serializers.DictField(required=False)


class CountsSerializer(serializers.Serializer):
    services = serializers.IntegerField()
    tools = serializers.IntegerField()
    toolsets = serializers.IntegerField()
    roles = serializers.IntegerField()


# ---------------------------------------------------------------------------
# Action envelopes + inputs (mutations)
# ---------------------------------------------------------------------------


class OkMessageSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    message = serializers.CharField(allow_blank=True)


class ApproveResultSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    message = serializers.CharField(allow_blank=True)
    runId = serializers.CharField(required=False)


class McpBuildResultSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    nativeTools = serializers.IntegerField()
    path = serializers.CharField()


class McpTestResultSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    result = serializers.JSONField()


class AddServiceSerializer(serializers.Serializer):
    name = serializers.CharField()
    # Optional: the chosen adapter's SERVICE_TYPE is authoritative for the stored
    # category (DiscoveryEngine.run), so this is accepted for the SPA's
    # AddServiceInput shape but not required — and never overrides the adapter.
    service_type = serializers.ChoiceField(choices=["database", "api"], required=False)
    adapter = serializers.CharField()
    host = serializers.CharField(required=False, allow_blank=True, default="")
    port = serializers.IntegerField(required=False, allow_null=True)
    database = serializers.CharField(required=False, allow_blank=True, default="")
    user = serializers.CharField(required=False, allow_blank=True, default="")
    password = serializers.CharField(
        required=False, allow_blank=True, default="", write_only=True
    )
    domain = serializers.CharField(required=False, allow_blank=True, default="")
