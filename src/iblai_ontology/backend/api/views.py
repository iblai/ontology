"""Console REST API views — thin DRF surface over the existing engines.

Every view delegates to the same Django-free functions the Typer CLI uses
(``discovery``, ``provisioning``, ``sync``, ``mcp_server``, ``health``,
``identity``) and returns a serializer-produced body. Business-rule failures
(duplicate service, safety-not-passed, missing service on an action, tool
errors) are reported as **HTTP 200 with ``{ok: false, message}``** per the SPA
contract; only auth/transport/unexpected errors use non-2xx.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import yaml
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import APIView

from iblai_ontology.backend import store
from iblai_ontology.backend.platform import setup
from iblai_ontology.backend.services.models import Service, ServiceHealth
from iblai_ontology.config import data_store, dm_store, platform_roles
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

logger = logging.getLogger("iblai_ontology.audit")


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


class NotSetUp(APIException):
    """A server installed with no platform, before the frontend has set it up."""

    status_code = 503
    default_code = "not_set_up"
    default_detail = (
        "This server is not set up yet: open the link its install printed, or run the "
        "install command again to print it."
    )


class ConsoleAPIView(APIView):
    """Base view: auth/permission come from REST_FRAMEWORK defaults; adds audit."""

    def initial(self, request, *args, **kwargs):
        # Before any sign-in is judged: with no platform yet, any platform's admin would pass.
        if setup.pending():
            raise NotSetUp()
        super().initial(request, *args, **kwargs)
        # Past the admin check: a new platform's first console request gets the example roles.
        from iblai_ontology.backend.identity import role_source

        role_source.seed_once()

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

                store.create(
                    AuditLog,
                    user_id=getattr(principal, "user_id", "") or "dev-anon",
                    user_email=getattr(principal, "email", "") or "",
                    user_role=getattr(principal, "role", "") or "dev-anon",
                    action=action,
                    resource=resource,
                    allowed=allowed,
                    ip_address=self._client_ip(request) or None,
                )
        except Exception:  # pragma: no cover - auditing must not break requests
            logger.exception("audit write failed: %s %s", action, resource)


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
        return Response(ServiceSerializer(store.filter(Service), many=True).data)

    def post(self, request):
        from .serializers import AddServiceSerializer

        form = AddServiceSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        name = v["name"]
        if store.count(Service, name=name):
            self._audit(request, action="service.add", resource=name, allowed=False)
            return _envelope(False, f"Service '{name}' already exists.")
        try:
            from iblai_ontology.backend.discovery.adapters import get_adapter
            from iblai_ontology.backend.discovery.engine import DiscoveryEngine

            if get_adapter(v["adapter"]).SERVICE_TYPE == "api":
                from iblai_ontology.backend.services import twenty

                # No database to introspect: the Service row and its catalog schedules.
                service = DiscoveryEngine().register_api(
                    name=name,
                    adapter=v["adapter"],
                    host=v.get("host", ""),
                    api_key=v.get("api_key", ""),
                )
                if service.adapter == twenty.ADAPTER:
                    return self._connect_now(request, name, service.display_name)
            else:
                DiscoveryEngine().run(
                    name=name,
                    service_type=v["adapter"],
                    host=v.get("host", ""),
                    port=v.get("port") or 0,
                    database=v.get("database", ""),
                    user=v.get("user", ""),
                    password=v.get("password", ""),
                    use_llm=False,
                    options=v.get("options"),
                )
        except Exception as exc:
            self._audit(request, action="service.add", resource=name, allowed=False)
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.add", resource=name)
        return _envelope(True, f"Service '{name}' added.")

    def _connect_now(self, request, name: str, display_name: str):
        """A system whose key was just tried needs no review: approve it, give the role of
        its name what it brings, and start its first sync."""
        from iblai_ontology.backend.identity import role_source
        from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine
        from iblai_ontology.backend.sync import tasks

        engine = ProvisioningEngine()
        try:
            engine.provision(name)
        except Exception:
            try:  # nothing half-connected is left to refuse the next try
                engine.teardown(name)
            except Exception:
                logger.exception("service.add: %s could not be undone", name)
            raise
        self._audit(request, action="service.add", resource=name)
        self._audit(request, action="service.approve", resource=name)
        said = [f"'{name}' is connected."]
        try:
            tasks.run_service.delay(name)
            said.append("Its records are on their way.")
        except Exception as exc:
            why = " ".join(str(exc).split())[:200]
            said.append(f"Its first sync did not start ({why}): use Sync now.")
        try:
            # The role an agent is connected as: this system's tables, memory and operations.
            role_source.extend_role(name, engine.reach(name), display_name)
            self._audit(request, action="role.upsert", resource=name)
        except Exception as exc:
            # The system is connected all the same; the role is one to make on Access.
            why = " ".join(str(exc).split())[:300]
            said.append(f"No role was made for it: {why}")
        return _envelope(True, " ".join(said))


class ServiceDatabasesView(ConsoleAPIView):
    """The databases a login may open, so the form offers the name instead of asking for it."""

    def post(self, request):
        from .serializers import DatabaseListSerializer, DatabaseLookupSerializer

        form = DatabaseLookupSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        try:
            from iblai_ontology.backend.discovery.engine import list_databases

            found = list_databases(
                v["adapter"],
                host=v["host"],
                port=v["port"],
                user=v["user"],
                password=v["password"],
            )
        except Exception as exc:
            # A driver's error runs over several lines; its first words are the reason.
            why = " ".join(str(exc).split())[:300]
            return _envelope(False, why, serializer=DatabaseListSerializer)
        return _envelope(
            True,
            f"{len(found)} database(s).",
            extra={"databases": found},
            serializer=DatabaseListSerializer,
        )


class ServiceDetailView(ConsoleAPIView):
    def get(self, request, name):
        service = store.first(Service, name=name)
        if not service:
            return _json_null()  # 200 JSON null when missing (SPA contract)
        return Response(ServiceSerializer(service).data)

    def delete(self, request, name):
        if not store.count(Service, name=name):
            return _envelope(False, f"Service '{name}' not found.")
        try:
            from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine

            # Its schedules and tools first, its registry rows last: what fails can be tried again.
            ProvisioningEngine().teardown(name)
        except Exception as exc:
            why = " ".join(str(exc).split())[:400]
            return _envelope(False, f"'{name}' was not removed: {why}")
        self._audit(request, action="service.delete", resource=name)
        return _envelope(True, f"Service '{name}' removed.")


class ServiceRunsView(ConsoleAPIView):
    def get(self, request, name):
        from iblai_ontology.backend.provisioning.models import ProvisioningRun

        service = store.first(Service, name=name)
        runs = store.filter(ProvisioningRun, service=service.pk) if service else []
        for run in runs:
            run.service = (
                service  # the serializer's service_name, without another lookup
            )
        return Response(ProvisioningRunSerializer(runs, many=True).data)


class ServiceSafetyView(ConsoleAPIView):
    def get(self, request, name):
        from iblai_ontology.backend.discovery.models import SafetyReport

        report = store.first(SafetyReport, service_name=name)
        if not report:
            return _json_null()
        return Response(SafetyReportSerializer(report).data)


class ServiceStatusView(ConsoleAPIView):
    def post(self, request, name):
        service = store.first(Service, name=name)
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        try:
            from iblai_ontology.backend.services.health import check_connectivity

            result = check_connectivity(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        health = store.create(
            ServiceHealth,
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
        service = store.first(Service, name=name)
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        if service.service_type == "api":
            return _envelope(
                False,
                "An API system has no read-only test: what an agent may change through "
                "it is the toolset its role is granted.",
            )
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
            report = store.create(
                SafetyReportModel,
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
            store.save(service, ["safety_status", "last_safety_check_at"])
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.test", resource=name)
        return Response(SafetyReportSerializer(report).data)


class ServiceDiscoverView(ConsoleAPIView):
    def post(self, request, name):
        service = store.first(Service, name=name)
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        if service.service_type == "api":
            return _envelope(
                False,
                "An API system has no schema to discover: what it syncs is the catalog's list.",
            )
        try:
            from iblai_ontology.backend.discovery.engine import DiscoveryEngine

            # ponytail: synchronous re-discovery; move to a celery task if the
            # portal proxy starts timing out on large schemas.
            DiscoveryEngine().rediscover(name, use_llm=False)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.discover", resource=name)
        return _envelope(True, f"Re-discovery complete for '{name}'.")


class ServiceMapView(ConsoleAPIView):
    def post(self, request, name):
        from .serializers import MapResultSerializer

        if not store.count(Service, name=name):
            return _envelope(
                False, f"Service '{name}' not found.", serializer=MapResultSerializer
            )
        try:
            from iblai_ontology.backend.discovery.engine import DiscoveryEngine

            # ponytail: synchronous, one completion per service; a task if it times out.
            tables = DiscoveryEngine().map(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500], serializer=MapResultSerializer)
        self._audit(request, action="service.map", resource=name)
        return _envelope(
            True,
            f"Mapped {len(tables)} table(s); review them, then approve.",
            extra={"tables": tables},
            serializer=MapResultSerializer,
        )


class ServiceApproveView(ConsoleAPIView):
    def post(self, request, name):
        service = store.first(Service, name=name)
        if not service:
            return _envelope(False, f"Service '{name}' not found.")
        # The read-only suite guards database sources; an API source has none to run.
        if service.service_type != "api" and service.safety_status != "passed":
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
        if not store.count(Service, name=name):
            return _envelope(False, f"Service '{name}' not found.")
        from iblai_ontology.backend.sync import tasks

        try:
            # On the worker when a broker is configured, here when none is.
            tasks.run_service.delay(name)
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="service.sync", resource=name)
        return _envelope(True, f"Sync triggered for '{name}'.")


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


class SyncRunAllView(ConsoleAPIView):
    def post(self, request):
        from iblai_ontology.backend.sync import tasks

        try:
            tasks.run_all_due.delay()
        except Exception as exc:
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="sync.run", resource="all")
        return _envelope(True, "Sync run triggered for all due schedules.")


class SyncSchedulesView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.sync import schedules

        return Response(SyncScheduleSerializer(schedules.all(), many=True).data)


class SyncStatusView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.sync.engine import latest_runs

        return Response(SyncRunSerializer(latest_runs(), many=True).data)


class SyncHistoryView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.sync.models import SyncRun

        service = request.query_params.get("service", "all")
        try:
            limit = int(request.query_params.get("limit", "20"))
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 200))
        if not service or service == "all":
            runs = store.filter(SyncRun, order="-started_at", limit=limit)
        else:
            # Either column matches: the newest N of the union lie within each side's newest N.
            merged = {
                r.pk: r
                for key in ("source_system__icontains", "schedule_name__icontains")
                for r in store.filter(
                    SyncRun, order="-started_at", limit=limit, **{key: service}
                )
            }
            runs = sorted(merged.values(), key=lambda r: r.started_at, reverse=True)[
                :limit
            ]
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
            "services": store.count(Service),
            "tools": len(reader.get_tools()),
            "toolsets": len(reader.get_toolsets()),
            "roles": len(RoleResolver().role_names()),
            "data_store": data_store(),
            "platform": setup.platform(),
        }
        return Response(CountsSerializer(payload).data)


# ---------------------------------------------------------------------------
# Setting up a server that was installed with no platform
# ---------------------------------------------------------------------------


class SetupView(APIView):
    """Whether this server is set up, which anyone may ask, and setting it up from the frontend.

    None of DRF's sign-ins: a server that waits has no platform to judge one by. The code
    its install printed, and the platform's own word about the caller, stand in for it.
    """

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request):
        from .serializers import SetupStatusSerializer

        return Response(SetupStatusSerializer({"set_up": not setup.pending()}).data)

    def post(self, request):
        from iblai_ontology.backend.identity.models import AuditLog

        from .serializers import SetupInputSerializer

        form = SetupInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        try:
            done = setup.set_up(
                _authorization(request), named=v["platform"], code=v["code"]
            )
        except setup.SetupRefused as exc:
            done = {"message": str(exc), "by": "", "changed": False}
            ok = False
        else:
            ok = True
        if done["changed"] or not ok:
            try:
                store.create(
                    AuditLog,
                    user_id=done["by"] or "unknown",
                    user_email="",
                    user_role="platform-admin" if done["by"] else "unknown",
                    action="server.setup",
                    resource=v["platform"] or setup.platform() or "-",
                    allowed=ok,
                    ip_address=ConsoleAPIView._client_ip(request) or None,
                )
            except Exception:  # pragma: no cover - auditing must not break requests
                logger.exception("audit write failed: server.setup")
        return _envelope(ok, done["message"])


# ---------------------------------------------------------------------------
# Agents connected to this gateway (platform store)
# ---------------------------------------------------------------------------


def _authorization(request) -> str:
    """The caller's own Authorization header: the platform is asked in their name."""
    return request.META.get("HTTP_AUTHORIZATION", "")


class AgentsView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.platform import agents

        from .serializers import AgentListSerializer

        try:
            found = agents.agents(_authorization(request))
        except Exception as exc:
            why = " ".join(str(exc).split())[:400]
            return _envelope(False, why, serializer=AgentListSerializer)
        return _envelope(
            True, "", extra={"agents": found}, serializer=AgentListSerializer
        )


class AgentConnectionsView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.platform import agents

        from .serializers import AgentConnectionSerializer

        return Response(AgentConnectionSerializer(agents.connections(), many=True).data)

    def post(self, request):
        from iblai_ontology.backend.platform import agents

        from .serializers import AgentConnectionInputSerializer

        form = AgentConnectionInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        try:
            made = agents.connect(
                _authorization(request),
                agent=v["agent"],
                role=v["role"],
                by=getattr(request.user, "username", "") or "",
            )
        except Exception as exc:
            self._audit(
                request, action="agent.connect", resource=v["agent"], allowed=False
            )
            return _envelope(False, " ".join(str(exc).split())[:500])
        self._audit(request, action="agent.connect", resource=made["name"])
        return _envelope(True, f"{made['agent_name']} is connected as {made['role']}.")


class AgentConnectionDetailView(ConsoleAPIView):
    def delete(self, request, name):
        from iblai_ontology.backend.platform import agents

        if not _NAME_RE.match(name):
            return _envelope(False, "Invalid name.")
        try:
            agents.disconnect(_authorization(request), name)
        except Exception as exc:
            return _envelope(False, " ".join(str(exc).split())[:500])
        self._audit(request, action="agent.disconnect", resource=name)
        return _envelope(True, "The connection is removed and its key deleted.")


# The config directory's files the Configuration page shows, under the page's own ids.
_CONFIG_FILES = {
    "ontology": "ontology.yaml",
    "schedules": "sync-schedules.yaml",
    "roles": "roles.yaml",
    "tools": "tools.yaml",
    "caddyfile": "Caddyfile",
}


def _in_platform(file_id: str) -> bool:
    """Whether the ibl.ai platform keeps what this file would hold: roles in rbac and dm, schedules in dm."""
    return (file_id == "roles" and platform_roles()) or (
        file_id == "schedules" and dm_store()
    )


class ConfigFilesView(ConsoleAPIView):
    """The config directory's files and the catalog as text, secrets masked on this host."""

    def get(self, request):
        from datetime import UTC, datetime

        from iblai_ontology import catalog
        from iblai_ontology.config import config_dir
        from iblai_ontology.config.reader import mask_secrets

        from .serializers import ConfigFilesSerializer

        root = config_dir()
        paths = {
            file_id: root / name
            for file_id, name in _CONFIG_FILES.items()
            if not _in_platform(file_id)
        }
        paths["catalog"] = Path(catalog.__file__).with_name("catalog.yaml")
        files = []
        for file_id, path in paths.items():
            try:
                text, changed = path.read_text(), path.stat().st_mtime
            except (OSError, ValueError):  # absent or unreadable: the page says so
                files.append({"id": file_id, "content": None, "modified_at": None})
                continue
            files.append(
                {
                    "id": file_id,
                    "content": mask_secrets(text),
                    "modified_at": datetime.fromtimestamp(changed, UTC),
                }
            )
        payload = {"root": str(root), "files": files}
        return Response(ConfigFilesSerializer(payload).data)


class ResetView(ConsoleAPIView):
    def post(self, request):
        if not settings.DEBUG:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        # ponytail: dev reseed = clear console-managed rows (FK-cascades runs,
        # steps, health). Extend with seed fixtures if a demo dataset is wanted.
        from iblai_ontology.backend.discovery.models import SafetyReport
        from iblai_ontology.backend.sync.models import SyncRun

        store.delete(Service)
        store.delete(SyncRun)
        store.delete(SafetyReport)
        return _envelope(True, "Reset complete.")


# ---------------------------------------------------------------------------
# Semantic map + console edits (table categories, roles, schedules, tools.yaml)
# ---------------------------------------------------------------------------

_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
# Lines of tools.yaml whose key looks like a secret and whose value is not a ${VAR}, alone or after a scheme word.
_SECRET_LINE_RE = re.compile(
    r"^(\s*[\w-]*(?:password|secret|api_key|api-key|token|client_secret|key"
    r"|authorization|cookie)\s*:\s*)"
    r"(?!['\"]?(?:[A-Za-z][A-Za-z0-9-]* )?\$\{)(\S.*)$",
    re.I | re.M,
)


def _plain(data):
    """validated_data (OrderedDicts) -> plain dicts/lists that yaml.safe_dump accepts."""
    return json.loads(json.dumps(data))


_EMPTY_GRAPH = {
    "nodes": [],
    "links": [],
    "stats": {"hubs": [], "orphans": 0, "dangling": 0},
}


def _graph_services():
    from iblai_ontology.backend.services.registry import with_tables

    return [with_tables(s) for s in store.filter(Service)]


class GraphView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.backend.graph.builder import build_graph
        from iblai_ontology.backend.health.checks import check_storage
        from iblai_ontology.backend.identity.role_source import load_roles
        from iblai_ontology.backend.sync import schedules
        from iblai_ontology.config.reader import ConfigReader

        from .serializers import GraphQuerySerializer, GraphSerializer

        query = GraphQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        reader = ConfigReader()
        try:
            data = build_graph(
                _graph_services(),
                reader=reader,
                roles=load_roles(),
                schedules=schedules.all(),
                by_domain=check_storage().by_domain,
                columns=query.validated_data["columns"],
            )
        # RuntimeError: the platform refused or did not answer (dm mode).
        except (OSError, ValueError, RuntimeError, yaml.YAMLError) as exc:
            return _envelope(
                False, str(exc)[:500], extra=_EMPTY_GRAPH, serializer=GraphSerializer
            )
        return Response(GraphSerializer({"ok": True, "message": "", **data}).data)


class GraphRecordsView(ConsoleAPIView):
    def get(self, request):
        import os

        from iblai_ontology.backend.graph.builder import domain_records, record_fk_map

        from .serializers import GraphRecordsQuerySerializer, GraphRecordsSerializer

        query = GraphRecordsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        v = query.validated_data
        found = domain_records(
            v["domain"],
            files_root=os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology"),
            fk_map=record_fk_map(_graph_services()),
            limit=v["limit"],
        )
        if found is None:
            return _envelope(
                False,
                "Unknown domain.",
                extra={"nodes": [], "links": [], "total": 0},
                serializer=GraphRecordsSerializer,
            )
        return Response(
            GraphRecordsSerializer({"ok": True, "message": "", **found}).data
        )


class ServiceTablesView(ConsoleAPIView):
    def patch(self, request, name):
        from iblai_ontology.backend.discovery.config_generator import (
            apply_table_edits,
            rewrite_entity_files,
        )

        from .serializers import TableEditResultSerializer, TableEditSerializer

        service = store.first(Service, name=name)
        if not service:
            return _envelope(
                False,
                f"Service '{name}' not found.",
                serializer=TableEditResultSerializer,
            )
        form = TableEditSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        v = form.validated_data
        known: set[str] = set()
        for t in (service.schema_manifest or {}).get("tables") or []:
            schema, table = t.get("schema_name") or "", t.get("table_name") or ""
            known.add(f"{schema}.{table}" if schema else table)
        unknown = [t for t in v["tables"] if t not in known]
        if unknown:
            return _envelope(
                False,
                f"Unknown tables: {', '.join(unknown[:5])}",
                serializer=TableEditResultSerializer,
            )
        # ponytail: last write wins on llm_analysis; no locking.
        analysis = apply_table_edits(
            dict(service.llm_analysis or {}),
            v["tables"],
            entity_group=v.get("entity_group"),
            description=v.get("description"),
            entity=v.get("entity"),
            fields=v.get("fields"),
            template=v.get("template"),
        )
        service.llm_analysis = analysis
        # ponytail: one JSON value under the DM's 2 MiB cap (see the engine's analysis save).
        store.save(service, ["llm_analysis"])
        generated = Path("config/generated") / name  # cwd-relative, like the engine
        if generated.is_dir():
            rewrite_entity_files(name, analysis, generated)
        self._audit(request, action="service.tables", resource=name)
        return _envelope(
            True,
            f"Updated {len(v['tables'])} table(s).",
            extra={"updated": len(v["tables"])},
            serializer=TableEditResultSerializer,
        )


class RoleDetailView(ConsoleAPIView):
    def put(self, request, name):
        from iblai_ontology.backend.identity import role_source

        from .serializers import RoleInputSerializer

        if not _NAME_RE.match(name):
            return _envelope(False, "Invalid name.")
        try:
            existing = role_source.load_roles().get(name)
        except RuntimeError as exc:  # the platform's own words (dm mode)
            return _envelope(False, str(exc)[:500])
        form = RoleInputSerializer(data=request.data, partial=existing is not None)
        form.is_valid(raise_exception=True)
        spec = {**(existing or {}), **_plain(form.validated_data)}
        known = set(ConfigReader().get_toolsets())
        bad = [
            t
            for t in spec.get("mcp_toolsets") or []
            if t != "*" and known and t not in known
        ]
        if bad:
            return _envelope(False, f"Unknown toolsets: {', '.join(bad)}")
        try:
            role_source.put_role(name, spec)
        except RuntimeError as exc:  # the platform's own words (dm mode)
            return _envelope(False, str(exc)[:500])
        self._audit(request, action="role.upsert", resource=name)
        return _envelope(True, f"Role '{name}' saved.")

    def delete(self, request, name):
        from iblai_ontology.backend.identity import role_source
        from iblai_ontology.backend.identity.roles import DEFAULT_ROLE

        if name == DEFAULT_ROLE:
            return _envelope(
                False, "The default role is the fallback and cannot be deleted."
            )
        try:
            found = role_source.delete_role(name)
        except RuntimeError as exc:
            return _envelope(False, str(exc)[:500])
        if not found:
            return _envelope(False, f"Role '{name}' not found.")
        self._audit(request, action="role.delete", resource=name)
        return _envelope(True, f"Role '{name}' removed.")


class SyncScheduleDetailView(ConsoleAPIView):
    def put(self, request, name):
        from iblai_ontology.backend.provisioning.sync_generator import (
            SyncScheduleGenerator,
        )

        from .serializers import SyncScheduleInputSerializer

        if not _NAME_RE.match(name):
            return _envelope(False, "Invalid name.")
        gen = SyncScheduleGenerator()
        existing = next((s for s in gen._existing() if s.get("name") == name), None)
        form = SyncScheduleInputSerializer(
            data=request.data, partial=existing is not None
        )
        form.is_valid(raise_exception=True)
        merged = {**(existing or {}), **_plain(form.validated_data), "name": name}
        from iblai_ontology.backend.sync.engine import SyncRunner

        refused = SyncRunner.refuses(str(merged.get("tool") or ""))
        if refused:
            return _envelope(False, refused)
        gen.apply(yaml.safe_dump({"schedules": [merged]}, sort_keys=False))
        self._audit(request, action="schedule.upsert", resource=name)
        # The scheduler reads the schedules every minute: nothing to restart.
        return _envelope(True, f"Schedule '{name}' saved.")

    def delete(self, request, name):
        from iblai_ontology.backend.sync import schedules

        if not schedules.delete(name):
            return _envelope(False, f"Schedule '{name}' not found.")
        self._audit(request, action="schedule.delete", resource=name)
        return _envelope(True, f"Schedule '{name}' removed.")


class McpResourceView(ConsoleAPIView):
    """PUT/DELETE one ``kind: tool | toolset | source`` document of tools.yaml."""

    def _result(self, request, report, *, action, resource, ok_message):
        from .serializers import McpSaveResultSerializer

        if not report.ok:
            message = "; ".join(
                i.message for i in report.issues if i.severity == "error"
            )
            return Response(
                McpSaveResultSerializer(
                    {"ok": False, "message": message[:500], "report": report}
                ).data
            )
        self._audit(request, action=action, resource=resource)
        return Response(
            McpSaveResultSerializer(
                {"ok": True, "message": ok_message, "report": report}
            ).data
        )

    def put(self, request, name, kind):
        from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml
        from iblai_ontology.backend.provisioning.tools_generator import ToolsGenerator

        from .serializers import (
            McpSaveResultSerializer,
            McpSourceSerializer,
            McpToolInputSerializer,
            McpToolsetSerializer,
        )

        if not _NAME_RE.match(name):
            return _envelope(False, "Invalid name.", serializer=McpSaveResultSerializer)
        inputs = {
            "tool": McpToolInputSerializer,
            "toolset": McpToolsetSerializer,
            "source": McpSourceSerializer,
        }
        gen = ToolsGenerator()
        existing = next(
            (
                d
                for d in gen._existing_docs()
                if d.get("kind") == kind and d.get("name") == name
            ),
            None,
        )
        body = request.data if isinstance(request.data, dict) else {}
        form = inputs[kind](
            data={**body, "kind": kind, "name": name}, partial=existing is not None
        )
        form.is_valid(raise_exception=True)
        merged = {
            **(existing or {}),
            **_plain(form.validated_data),
            "kind": kind,
            "name": name,
        }
        # The file says `write` only for a toolset that does.
        if kind == "toolset" and not merged.get("write"):
            merged.pop("write", None)
        report = save_tools_yaml(
            gen.merge(yaml.safe_dump(merged, sort_keys=False)), gen.path
        )
        return self._result(
            request,
            report,
            action=f"mcp.{kind}.upsert",
            resource=name,
            ok_message=f"{kind} '{name}' saved. Build and restart the MCP Toolbox to apply.",
        )

    def delete(self, request, name, kind):
        from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml
        from iblai_ontology.backend.provisioning.tools_generator import ToolsGenerator

        from .serializers import McpSaveResultSerializer

        gen = ToolsGenerator()
        docs = gen._existing_docs()
        rest = [
            d for d in docs if not (d.get("kind") == kind and d.get("name") == name)
        ]
        if len(rest) == len(docs):
            return _envelope(
                False, f"{kind} '{name}' not found.", serializer=McpSaveResultSerializer
            )
        report = save_tools_yaml(
            yaml.safe_dump_all(rest, default_flow_style=False, sort_keys=False),
            gen.path,
        )
        return self._result(
            request,
            report,
            action=f"mcp.{kind}.delete",
            resource=name,
            ok_message=f"{kind} '{name}' removed. Build and restart the MCP Toolbox to apply.",
        )


class McpConfigView(ConsoleAPIView):
    def get(self, request):
        from iblai_ontology.config import config_dir

        from .serializers import McpConfigTextSerializer

        path = config_dir() / "tools.yaml"
        text = path.read_text() if path.exists() else ""
        # Unexpanded (${VAR} stays a reference); literal secret values are masked.
        masked = _SECRET_LINE_RE.sub(r"\1********", text)
        return Response(McpConfigTextSerializer({"text": masked}).data)

    def put(self, request):
        from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml
        from iblai_ontology.config import config_dir

        from .serializers import McpConfigTextSerializer

        form = McpConfigTextSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        report = save_tools_yaml(
            form.validated_data["text"], config_dir() / "tools.yaml"
        )
        return McpResourceView._result(
            self,
            request,
            report,
            action="mcp.config.save",
            resource="tools.yaml",
            ok_message="tools.yaml saved. Build and restart the MCP Toolbox to apply.",
        )
