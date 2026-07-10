"""Console REST API views — thin DRF surface over the existing engines.

Every view delegates to the same Django-free functions the Typer CLI uses
(``discovery``, ``provisioning``, ``sync``, ``mcp_server``, ``health``,
``identity``) and returns a serializer-produced body. Business-rule failures
(duplicate service, safety-not-passed, missing service on an action, tool
errors) are reported as **HTTP 200 with ``{ok: false, message}``** per the SPA
contract; only auth/transport/unexpected errors use non-2xx.
"""

from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from iblai_ontology.backend.services.models import Service, ServiceHealth
from iblai_ontology.config.reader import ConfigReader, _redact

from .serializers import (
    ApproveResultSerializer,
    ComplianceReportSerializer,
    CountsSerializer,
    GatewayHealthSerializer,
    HealthSnapshotSerializer,
    McpBuildResultSerializer,
    McpSourceSerializer,
    McpTestResultSerializer,
    McpToolSerializer,
    McpToolsetSerializer,
    OkMessageSerializer,
    ProvisioningRunSerializer,
    RoleSerializer,
    SafetyReportSerializer,
    ServiceHealthSerializer,
    ServiceSerializer,
    SyncRunSerializer,
    SyncScheduleSerializer,
)


def _envelope(ok: bool, message: str, *, extra: dict | None = None, serializer=None):
    """A serialized ``{ok, message, ...}`` action envelope (HTTP 200)."""
    payload = {"ok": ok, "message": message}
    if extra:
        payload.update(extra)
    return Response((serializer or OkMessageSerializer)(payload).data)


def _json_null():
    """200 with a literal JSON ``null`` body (the SPA's contract for a missing
    single resource). DRF's ``Response(None)`` renders an *empty* body, which
    would make the client's ``res.json()`` throw."""
    return JsonResponse(None, safe=False)


class ConsoleAPIView(APIView):
    """Base view: auth/permission come from REST_FRAMEWORK defaults; adds audit."""

    @staticmethod
    def _client_ip(request) -> str:
        fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "") or ""

    def _audit(self, request, *, action: str, resource: str, allowed: bool = True):
        """Write an AuditLog row for either principal kind (never blocks)."""
        principal = request.user  # OntologyPrincipal | None (dev-anon)
        resolved = request.auth  # ResolvedRequest for Entra, else None
        try:
            if resolved is not None:
                from iblai_ontology.backend.identity.middleware import write_audit

                write_audit(
                    resolved,
                    action=action,
                    resource=resource,
                    allowed=allowed,
                    ip_address=self._client_ip(request) or None,
                )
            else:
                from iblai_ontology.backend.identity.models import AuditLog

                AuditLog.objects.create(
                    user_id=getattr(principal, "user_id", "") or "dev-anon",
                    user_email=getattr(principal, "email", "") or "",
                    user_role=getattr(principal, "role", "") or "dev-anon",
                    action=action,
                    resource=resource,
                    allowed=allowed,
                    ip_address=self._client_ip(request) or None,
                )
        except Exception:  # pragma: no cover - auditing must not break requests
            pass


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


def _health_snapshot() -> dict:
    from dataclasses import asdict

    from iblai_ontology.backend.health.checks import (
        check_db,
        check_mcp_gateway,
        check_mcp_servers,
        check_storage,
        check_sync,
    )

    servers = check_mcp_servers()  # {} keyed by name; TS wants name inside each item
    return {
        "db": check_db(),
        "mcp_servers": [{**asdict(h), "name": name} for name, h in servers.items()],
        "sync": check_sync(),
        "storage": check_storage(),
        "gateway": check_mcp_gateway(),
        "checked_at": timezone.now(),
    }


class HealthView(ConsoleAPIView):
    def get(self, request):
        return Response(HealthSnapshotSerializer(_health_snapshot()).data)


class HealthRecheckView(ConsoleAPIView):
    def post(self, request):
        return Response(HealthSnapshotSerializer(_health_snapshot()).data)


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------


class ServicesView(ConsoleAPIView):
    def get(self, request):
        services = Service.objects.all()
        return Response(ServiceSerializer(services, many=True).data)

    def post(self, request):
        from .serializers import AddServiceSerializer

        form = AddServiceSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        name = v["name"]
        if Service.objects.filter(name=name).exists():
            self._audit(request, action="service.add", resource=name, allowed=False)
            return _envelope(False, f"Service '{name}' already exists.")
        try:
            from iblai_ontology.backend.discovery.engine import DiscoveryEngine

            DiscoveryEngine().run(
                name=name,
                service_type=v["adapter"],
                host=v.get("host", ""),
                port=v.get("port") or 0,
                database=v.get("database", ""),
                user=v.get("user", ""),
                password=v.get("password", ""),
                use_llm=False,
            )
        except Exception as exc:
            self._audit(request, action="service.add", resource=name, allowed=False)
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.add", resource=name)
        return _envelope(True, f"Service '{name}' added.")


class ServiceDetailView(ConsoleAPIView):
    def get(self, request, name):
        service = Service.objects.filter(name=name).first()
        if not service:
            return _json_null()  # 200 JSON null when missing (SPA contract)
        return Response(ServiceSerializer(service).data)

    def delete(self, request, name):
        if not Service.objects.filter(name=name).exists():
            return _envelope(False, f"Service '{name}' not found.")
        try:
            from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine

            ProvisioningEngine().teardown(name)  # best-effort de-provision
        except Exception:
            pass
        Service.objects.filter(name=name).delete()  # FK-cascades health/runs
        self._audit(request, action="service.delete", resource=name)
        return _envelope(True, f"Service '{name}' removed.")


class ServiceRunsView(ConsoleAPIView):
    def get(self, request, name):
        from iblai_ontology.backend.provisioning.models import ProvisioningRun

        runs = ProvisioningRun.objects.filter(service__name=name).prefetch_related(
            "steps"
        )
        return Response(ProvisioningRunSerializer(runs, many=True).data)


class ServiceSafetyView(ConsoleAPIView):
    def get(self, request, name):
        from iblai_ontology.backend.discovery.models import SafetyReport

        report = SafetyReport.objects.filter(service_name=name).first()
        if not report:
            return _json_null()
        return Response(SafetyReportSerializer(report).data)


class ServiceStatusView(ConsoleAPIView):
    def post(self, request, name):
        service = Service.objects.filter(name=name).first()
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        try:
            from iblai_ontology.backend.services.health import check_connectivity

            result = check_connectivity(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        health = ServiceHealth.objects.create(
            service=service,
            connected=result.connected,
            read_only=result.read_only,
            latency_ms=result.latency_ms,
            detail={"ok": True} if result.connected else {},
        )
        self._audit(request, action="service.status", resource=name)
        return Response(ServiceHealthSerializer(health).data)


class ServiceTestView(ConsoleAPIView):
    def post(self, request, name):
        service = Service.objects.filter(name=name).first()
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        from iblai_ontology.backend.discovery.engine import create_connection
        from iblai_ontology.backend.discovery.models import (
            SafetyReport as SafetyReportModel,
        )
        from iblai_ontology.backend.discovery.safety import SafetyVerifier
        from iblai_ontology.backend.services.encryption import (
            decrypt_connection_config,
        )

        cfg = decrypt_connection_config(service.connection_config_encrypted)
        # One guard over connect → run → persist: a failed suite is a valid
        # SafetyReport (returned below); only *exceptions* become {ok:false}.
        try:
            conn = create_connection(service.adapter, cfg)
            try:
                result = SafetyVerifier(
                    conn, db_type=cfg.get("db_type")
                ).run_all_tests()
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
            report = SafetyReportModel.objects.create(
                service_name=name,
                db_type=result.db_type,
                host=cfg.get("host", ""),
                port=int(cfg.get("port") or 0),
                database=cfg.get("database", ""),
                username=cfg.get("username", ""),
                status=result.overall_status.value,
                tests_run=len(result.tests),
                tests_passed=sum(1 for t in result.tests if t.result.value == "passed"),
                tests_failed=sum(1 for t in result.tests if t.result.value == "failed"),
                # Store the full records (get_details passes a list through as-is).
                details=[
                    {
                        "test_name": t.test_name,
                        "sql_attempted": t.sql_attempted,
                        "result": t.result.value,
                        "detail": t.detail or t.error_message or "",
                    }
                    for t in result.tests
                ],
            )
            service.safety_status = result.overall_status.value
            service.last_safety_check_at = timezone.now()
            service.save(update_fields=["safety_status", "last_safety_check_at"])
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.test", resource=name)
        return Response(SafetyReportSerializer(report).data)


class ServiceDiscoverView(ConsoleAPIView):
    def post(self, request, name):
        if not Service.objects.filter(name=name).exists():
            return _envelope(False, f"Service '{name}' not found.")
        try:
            from iblai_ontology.backend.discovery.engine import DiscoveryEngine

            # ponytail: synchronous re-discovery; move to a celery task if the
            # portal proxy starts timing out on large schemas.
            DiscoveryEngine().rediscover(name, use_llm=False)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.discover", resource=name)
        return _envelope(True, f"Re-discovery complete for '{name}'.")


class ServiceApproveView(ConsoleAPIView):
    def post(self, request, name):
        service = Service.objects.filter(name=name).first()
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        if service.safety_status != "passed":
            return _envelope(
                False,
                "Safety suite must pass before approval.",
                serializer=ApproveResultSerializer,
            )
        try:
            from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine

            run = ProvisioningEngine().provision(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500], serializer=ApproveResultSerializer)
        self._audit(request, action="service.approve", resource=name)
        return _envelope(
            True,
            f"Service '{name}' provisioned.",
            extra={"runId": str(run.id)},
            serializer=ApproveResultSerializer,
        )


class ServiceSyncView(ConsoleAPIView):
    def post(self, request, name):
        if not Service.objects.filter(name=name).exists():
            return _envelope(False, f"Service '{name}' not found.")
        from iblai_ontology.backend.sync.engine import SyncRunner

        try:
            # ponytail: inline sync (records SyncRun rows). Swap to the celery
            # run_schedule task when a worker fleet is deployed.
            SyncRunner().run_service(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.sync", resource=name)
        return _envelope(True, f"Sync triggered for '{name}'.")


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


class SyncRunAllView(ConsoleAPIView):
    def post(self, request):
        from iblai_ontology.backend.sync.engine import SyncRunner

        try:
            # ponytail: inline; celery run_all_due.delay() when a fleet exists.
            SyncRunner().run_all_due()
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="sync.run", resource="all")
        return _envelope(True, "Sync run triggered for all due schedules.")


class SyncSchedulesView(ConsoleAPIView):
    def get(self, request):
        schedules = ConfigReader().get_sync_schedules()
        return Response(SyncScheduleSerializer(schedules, many=True).data)


class SyncStatusView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.sync.models import SyncRun

        latest: dict = {}
        # Latest run per schedule_name, computed portably (SQLite has no DISTINCT ON).
        for run in SyncRun.objects.order_by("schedule_name", "-started_at"):
            latest.setdefault(run.schedule_name, run)
        runs = sorted(latest.values(), key=lambda r: r.started_at, reverse=True)
        return Response(SyncRunSerializer(runs, many=True).data)


class SyncHistoryView(ConsoleAPIView):
    def get(self, request):
        from django.db.models import Q

        from iblai_ontology.backend.sync.models import SyncRun

        service = request.query_params.get("service", "all")
        try:
            limit = int(request.query_params.get("limit", "20"))
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 200))
        qs = SyncRun.objects.all()
        if service and service != "all":
            qs = qs.filter(
                Q(source_system__icontains=service)
                | Q(schedule_name__icontains=service)
            )
        runs = qs.order_by("-started_at")[:limit]
        return Response(SyncRunSerializer(runs, many=True).data)


# ---------------------------------------------------------------------------
# MCP gateway
# ---------------------------------------------------------------------------


class McpStatusView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.health.checks import check_mcp_gateway

        return Response(GatewayHealthSerializer(check_mcp_gateway()).data)


class McpToolsView(ConsoleAPIView):
    def get(self, request):
        return Response(McpToolSerializer(ConfigReader().get_tools(), many=True).data)


class McpToolsetsView(ConsoleAPIView):
    def get(self, request):
        toolsets = list(ConfigReader().get_toolsets().values())
        return Response(McpToolsetSerializer(toolsets, many=True).data)


class McpSourcesView(ConsoleAPIView):
    def get(self, request):
        # SECRET LEAK GUARD: get_sources() env-expands ${VAR} (may inline a
        # password); redact before serializing.
        sources = [_redact(dict(s)) for s in ConfigReader().get_sources()]
        return Response(McpSourceSerializer(sources, many=True).data)


class McpValidateView(ConsoleAPIView):
    def post(self, request):
        from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml
        from iblai_ontology.config import config_dir

        report = validate_tools_yaml(config_dir() / "tools.yaml")
        return Response(ComplianceReportSerializer(report).data)


class McpBuildView(ConsoleAPIView):
    def post(self, request):
        from iblai_ontology.backend.mcp_server.toolbox_config import (
            write_toolbox_config,
        )
        from iblai_ontology.config import config_dir

        src = config_dir() / "tools.yaml"
        dest = config_dir() / "generated" / "toolbox.yaml"
        try:
            result = write_toolbox_config(src, dest)
        except Exception as exc:
            return _envelope(
                False,
                str(exc)[:500],
                extra={"nativeTools": 0, "path": str(dest)},
                serializer=McpBuildResultSerializer,
            )
        self._audit(request, action="mcp.build", resource="tools.yaml")
        return Response(
            McpBuildResultSerializer(
                {
                    "ok": True,
                    "nativeTools": len(result.native_tools),
                    "path": str(dest),
                }
            ).data
        )


class McpTestView(ConsoleAPIView):
    def post(self, request, tool):
        from iblai_ontology.backend.mcp_server.tester import ToolTester

        params = request.data if isinstance(request.data, dict) else {}
        try:
            result = ToolTester().call(tool, params)
        except Exception as exc:
            return Response(
                McpTestResultSerializer(
                    {"ok": False, "result": {"error": str(exc)[:500]}}
                ).data
            )
        return Response(McpTestResultSerializer({"ok": True, "result": result}).data)


# ---------------------------------------------------------------------------
# Roles + counts + reset
# ---------------------------------------------------------------------------


class RolesView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.identity.roles import RoleResolver

        resolver = RoleResolver()
        roles = [resolver.resolve(n) for n in resolver.role_names()]
        return Response(RoleSerializer(roles, many=True).data)


class CountsView(ConsoleAPIView):
    def get(self, request):
        reader = ConfigReader()
        from iblai_ontology.backend.identity.roles import RoleResolver

        payload = {
            "services": Service.objects.count(),
            "tools": len(reader.get_tools()),
            "toolsets": len(reader.get_toolsets()),
            "roles": len(RoleResolver().role_names()),
        }
        return Response(CountsSerializer(payload).data)


class ResetView(ConsoleAPIView):
    def post(self, request):
        if not settings.DEBUG:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        # ponytail: dev reseed = clear console-managed rows (FK-cascades runs,
        # steps, health). Extend with seed fixtures if a demo dataset is wanted.
        from iblai_ontology.backend.discovery.models import SafetyReport
        from iblai_ontology.backend.sync.models import SyncRun

        Service.objects.all().delete()
        SyncRun.objects.all().delete()
        SafetyReport.objects.all().delete()
        return _envelope(True, "Reset complete.")
