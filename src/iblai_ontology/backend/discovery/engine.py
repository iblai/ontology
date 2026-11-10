"""Discovery engine orchestrator (Component 5) and DB connection factory.

``DiscoveryEngine.run`` is the full pipeline behind ``ontology service add``:
connect → verify read-only (hard gate) → introspect → analyze (LLM or
rule-based) → generate reviewable config.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from iblai_ontology.backend.discovery.adapters import get_adapter
from iblai_ontology.backend.discovery.config_generator import (
    ConfigGenerator,
    api_schedules_yaml,
    apply_overrides,
    apply_table_edits,
    rewrite_entity_files,
)
from iblai_ontology.backend.discovery.connectors import CONNECTOR_DB_TYPES, connect
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
    "snowflake": "snowflake",
    "generic-trino": "trino",
    "generic-clickhouse": "clickhouse",
}


def create_connection(adapter_or_type: str, config: dict):
    """Create a DB-API 2.0 connection for a service from its config."""
    db_type = config.get("db_type") or _DB_TYPE.get(adapter_or_type, "oracle")

    if db_type in CONNECTOR_DB_TYPES:
        return connect(db_type, config)
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
        options: dict | None = None,
    ):
        from django.utils import timezone

        from iblai_ontology.backend import store
        from iblai_ontology.backend.discovery.models import SafetyReport
        from iblai_ontology.backend.services.encryption import encrypt_connection_config
        from iblai_ontology.backend.services.models import Service
        from iblai_ontology.backend.services.registry import save_manifest

        db_type = _DB_TYPE.get(service_type, "oracle")
        config = {
            "db_type": db_type,
            "host": host,
            "port": port,
            "database": database,
            "username": user,
            "password": password,
            "options": options or {},
        }
        adapter = get_adapter(service_type)

        defaults = {
            "display_name": f"{service_type} @ {host}",
            "service_type": adapter.SERVICE_TYPE,
            "adapter": service_type,
            "host": host,
            "connection_config_encrypted": encrypt_connection_config(config),
        }
        service = store.first(Service, name=name) or Service(name=name)
        for field, value in defaults.items():
            setattr(service, field, value)
        store.save(service, [*defaults, "updated_at"])

        conn = create_connection(service_type, config)
        try:
            # Step 1 — safety (hard gate)
            if not skip_safety:
                logger.info("Running read-only safety verification for %s", name)
                safety = SafetyVerifier(conn, db_type=db_type).run_all_tests()
                store.create(
                    SafetyReport,
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
                store.save(service, ["last_safety_check_at", "safety_status"])
                if not safety.all_passed:
                    raise SafetyError(
                        f"Safety verification failed: {safety.summary}\n"
                        f"Refusing to proceed.\n\n{safety.remediation_sql}"
                    )

            # Step 2 — introspect
            manifest = SchemaIntrospector(conn, db_type).introspect()
            service.last_discovery_at = timezone.now()
            save_manifest(service, manifest.to_dict(), ("last_discovery_at",))

            # Step 3 — analyze (LLM or rule-based)
            analysis = self._analyze(manifest, adapter, use_llm)
            analysis_dict = analysis.to_dict()
            # Console edits (entity group, description) survive a rediscovery.
            overrides = (service.llm_analysis or {}).get("overrides") or {}
            apply_overrides(analysis_dict, overrides)
            service.llm_analysis = analysis_dict
            # ponytail: one JSON value (~0.25 MB rule-based at 847 tables, under the DM's
            # 2 MiB cap to ~7k tables); move per-table descriptions to ServiceTable past that.
            store.save(service, ["llm_analysis"])

            # Step 4 — generate config
            out = output_dir or str(Path("config/generated") / name)
            written = ConfigGenerator(name, manifest, analysis).generate_all(out)
            if overrides:
                rewrite_entity_files(name, analysis_dict, out)
            service.status = Service.Status.PENDING
            store.save(service, ["status"])
            return {"manifest": manifest, "analysis": analysis, "generated": written}
        finally:
            try:
                conn.close()
            except Exception:  # pragma: no cover
                pass

    def rediscover(self, name: str, *, use_llm: bool = True):
        from iblai_ontology.backend import store
        from iblai_ontology.backend.services.encryption import decrypt_connection_config
        from iblai_ontology.backend.services.models import Service

        service = store.get(Service, name=name)
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
            options=config.get("options"),
        )

    def register_api(
        self, *, name: str, adapter: str, host: str = "", output_dir: str | None = None
    ):
        """Register an API source without database discovery.

        The Service row plus the catalog's ``sync_defaults`` as schedules; the
        service's custom MCP server (``mcp-servers/``, reached at ``MCP_<NAME>_URL``)
        does the pulling once approved.
        """
        from iblai_ontology.backend import store
        from iblai_ontology.backend.services.encryption import encrypt_connection_config
        from iblai_ontology.backend.services.models import Service
        from iblai_ontology.catalog import list_entries

        entry = next((e for e in list_entries() if adapter in (e.adapter, e.key)), None)
        display = entry.display_name if entry else adapter
        host = host or (
            str(
                entry.connection.get("base_url")
                or entry.connection.get("base_url_env")
                or ""
            )
            if entry
            else ""
        )
        service = store.first(Service, name=name) or Service(name=name)
        defaults = {
            "display_name": display,
            "service_type": "api",
            "adapter": adapter,
            "host": host,
            "status": Service.Status.PENDING,
            "connection_config_encrypted": encrypt_connection_config(
                {
                    "db_type": "api",
                    "host": host,
                    "env": list(entry.env) if entry else [],
                }
            ),
        }
        for field, value in defaults.items():
            setattr(service, field, value)
        store.save(service, [*defaults, "updated_at"])

        out = Path(output_dir or Path("config/generated") / name)
        out.mkdir(parents=True, exist_ok=True)
        (out / "sync-schedules.yaml").write_text(
            api_schedules_yaml(
                name,
                display,
                entry.sync_defaults if entry else {},
                entry.mapping if entry else None,
            )
        )
        return service

    def map(
        self,
        name: str,
        *,
        sample_rows: int | None = None,
        catalog: str | None = None,
    ) -> dict[str, dict]:
        """Ask the configured LLM how each discovered table maps onto the house entities.

        The answer is recorded as table edits (``overrides``), so it is reviewable in
        the console and survives a rediscovery; approve regenerates the config from it.
        ``catalog`` applies a catalog entry's vendor mapping (by table name) instead.
        """
        from iblai_ontology.backend import store
        from iblai_ontology.backend.discovery.llm_analyzer import MappingProposer
        from iblai_ontology.backend.services.models import Service
        from iblai_ontology.backend.services.registry import with_tables

        service = with_tables(store.get(Service, name=name))
        known = {
            f"{t.get('schema_name')}.{t.get('table_name')}"
            if t.get("schema_name")
            else str(t.get("table_name"))
            for t in (service.schema_manifest or {}).get("tables") or []
        }
        if catalog:
            from iblai_ontology.catalog import get_entry

            by_table = {
                m["table"]: m
                for m in get_entry(catalog).mapping.values()
                if m.get("table")
            }
            proposed = {
                t: by_table[t.split(".")[-1]]
                for t in known
                if t.split(".")[-1] in by_table
            }
        else:
            proposed = MappingProposer(service, sample_rows=sample_rows).propose()
        analysis = dict(service.llm_analysis or {})
        applied: dict[str, dict] = {}
        for table, m in proposed.items():
            if table not in known:
                continue
            clean = _clean_mapping(m)
            apply_table_edits(analysis, [table], **clean)
            applied[table] = {k: v for k, v in clean.items() if v is not None}
        service.llm_analysis = analysis
        store.save(service, ["llm_analysis"])
        out = Path("config/generated") / name
        if out.is_dir():
            rewrite_entity_files(name, analysis, out)
        return applied

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


_SLUG = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _slug(value) -> str | None:
    value = str(value or "").strip().lower()
    return value if _SLUG.match(value) else None


def _clean_mapping(m: dict) -> dict:
    """The table-edit kwargs an LLM answer may set, with every name validated as a slug."""
    fields = {
        str(k).lower(): _slug(v)
        for k, v in (m.get("fields") or {}).items()
        if isinstance(m.get("fields"), dict) and _slug(v)
    }
    return {
        "entity": _slug(m.get("entity")),
        "fields": fields or None,
        "template": _slug(m.get("template")),
        "entity_group": _slug(m.get("entity_group")),
        "description": str(m.get("description") or "")[:2000] or None,
    }
