"""Discovery engine orchestrator (Component 5) and DB connection factory.

``DiscoveryEngine.run`` is the full pipeline behind ``ontology service add``:
connect → verify read-only (hard gate) → introspect → analyze (LLM or
rule-based) → generate reviewable config.
"""

from __future__ import annotations

import logging
from pathlib import Path

from iblai_ontology.backend.discovery.adapters import get_adapter
from iblai_ontology.backend.discovery.config_generator import ConfigGenerator
from iblai_ontology.backend.discovery.introspection import SchemaIntrospector
from iblai_ontology.backend.discovery.llm_analyzer import (
    LLMAnalysisResult,
    RuleBasedAnalyzer,
    SchemaAnalyzer,
)
from iblai_ontology.backend.discovery.safety import SafetyVerifier

logger = logging.getLogger("iblai_ontology.discovery")

# CLI service-type -> DB-API driver db_type.
_DB_TYPE = {
    "peoplesoft": "oracle",
    "banner": "oracle",
    "generic-oracle": "oracle",
    "generic-postgres": "postgresql",
    "generic-mysql": "mysql",
    "generic-mssql": "sqlserver",
}


def create_connection(adapter_or_type: str, config: dict):
    """Create a DB-API 2.0 connection for a service from its config."""
    db_type = config.get("db_type") or _DB_TYPE.get(adapter_or_type, "oracle")

    if db_type == "oracle":
        import oracledb

        return oracledb.connect(
            user=config["username"],
            password=config["password"],
            dsn=f"{config['host']}:{config['port']}/{config['database']}",
        )
    if db_type == "postgresql":
        import psycopg2

        return psycopg2.connect(
            host=config["host"],
            port=config["port"],
            dbname=config["database"],
            user=config["username"],
            password=config["password"],
        )
    if db_type == "mysql":
        import pymysql

        return pymysql.connect(
            host=config["host"],
            port=int(config["port"]),
            database=config["database"],
            user=config["username"],
            password=config["password"],
        )
    if db_type == "sqlserver":
        import pyodbc

        return pyodbc.connect(
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={config['host']},{config['port']};"
            f"DATABASE={config['database']};"
            f"UID={config['username']};PWD={config['password']}"
        )
    raise ValueError(f"Unsupported database type: {db_type}")


class SafetyError(RuntimeError):
    """Raised when the read-only safety verification fails."""


class DiscoveryEngine:
    """Runs the discovery pipeline and persists results to the Service registry."""

    def run(
        self,
        *,
        name: str,
        service_type: str,
        host: str,
        port: int,
        database: str,
        user: str,
        password: str,
        use_llm: bool = True,
        skip_safety: bool = False,
        output_dir: str | None = None,
    ):
        from django.utils import timezone

        from iblai_ontology.backend.discovery.models import SafetyReport
        from iblai_ontology.backend.services.encryption import encrypt_connection_config
        from iblai_ontology.backend.services.models import Service

        db_type = _DB_TYPE.get(service_type, "oracle")
        config = {
            "db_type": db_type,
            "host": host,
            "port": port,
            "database": database,
            "username": user,
            "password": password,
        }
        adapter = get_adapter(service_type)

        service, _ = Service.objects.update_or_create(
            name=name,
            defaults={
                "display_name": f"{service_type} @ {host}",
                "service_type": adapter.SERVICE_TYPE,
                "adapter": service_type,
                "host": host,
                "connection_config_encrypted": encrypt_connection_config(config),
            },
        )

        conn = create_connection(service_type, config)
        try:
            # Step 1 — safety (hard gate)
            if not skip_safety:
                logger.info("Running read-only safety verification for %s", name)
                safety = SafetyVerifier(conn, db_type=db_type).run_all_tests()
                SafetyReport.objects.create(
                    service_name=name,
                    db_type=db_type,
                    host=host,
                    port=port,
                    database=database,
                    username=user,
                    status=safety.overall_status.value,
                    tests_run=len(safety.tests),
                    tests_passed=sum(
                        1 for t in safety.tests if t.result.value == "passed"
                    ),
                    tests_failed=sum(
                        1 for t in safety.tests if t.result.value == "failed"
                    ),
                    details={t.test_name: t.result.value for t in safety.tests},
                )
                service.last_safety_check_at = timezone.now()
                service.safety_status = safety.overall_status.value
                service.save(update_fields=["last_safety_check_at", "safety_status"])
                if not safety.all_passed:
                    raise SafetyError(
                        f"Safety verification failed: {safety.summary}\n"
                        f"Refusing to proceed.\n\n{safety.remediation_sql}"
                    )

            # Step 2 — introspect
            manifest = SchemaIntrospector(conn, db_type).introspect()
            service.schema_manifest = manifest.to_dict()
            service.last_discovery_at = timezone.now()
            service.save(update_fields=["schema_manifest", "last_discovery_at"])

            # Step 3 — analyze (LLM or rule-based)
            analysis = self._analyze(manifest, adapter, use_llm)
            service.llm_analysis = analysis.to_dict()
            service.save(update_fields=["llm_analysis"])

            # Step 4 — generate config
            out = output_dir or str(Path("config/generated") / name)
            written = ConfigGenerator(name, manifest, analysis).generate_all(out)
            service.status = Service.Status.PENDING
            service.save(update_fields=["status"])
            return {"manifest": manifest, "analysis": analysis, "generated": written}
        finally:
            try:
                conn.close()
            except Exception:  # pragma: no cover
                pass

    def rediscover(self, name: str, *, use_llm: bool = True):
        from iblai_ontology.backend.services.encryption import decrypt_connection_config
        from iblai_ontology.backend.services.models import Service

        service = Service.objects.get(name=name)
        config = decrypt_connection_config(service.connection_config_encrypted)
        return self.run(
            name=name,
            service_type=service.adapter,
            host=config["host"],
            port=config["port"],
            database=config["database"],
            user=config["username"],
            password=config["password"],
            use_llm=use_llm,
        )

    @staticmethod
    def _analyze(manifest, adapter, use_llm: bool) -> LLMAnalysisResult:
        if use_llm:
            try:
                return SchemaAnalyzer().analyze(manifest)
            except ValueError as exc:
                logger.warning(
                    "LLM not configured (%s); using rule-based analysis", exc
                )
            except Exception as exc:  # pragma: no cover - network/provider errors
                logger.warning(
                    "LLM analysis failed (%s); using rule-based analysis", exc
                )
        return RuleBasedAnalyzer(adapter).analyze(manifest)
