"""The sync path end to end on SQLite: table pulls through the service connection,
the cache DDL applied at approve, the mapping layer, the LLM probe through the DM,
and API sources read through their custom MCP server."""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal

import pytest
import yaml

django = pytest.importorskip("django")
pytest.importorskip("cryptography")

pytestmark = pytest.mark.django


@pytest.fixture()
def backend(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    (tmp_path / "config").mkdir()
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0)
    # One SQLite per process: clear what an earlier test left behind.
    from django.db import connection

    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.backend.sync.models import SyncRun

    Service.objects.all().delete()
    SyncRun.objects.all().delete()
    with connection.cursor() as cur:
        for table in ("courses", "students", "contacts"):
            cur.execute(f"DROP TABLE IF EXISTS {table}")
    return tmp_path


class FakeCursor:
    def __init__(self, rows, cols, log):
        self._rows, self._cols, self._log = rows, cols, log
        self.description = None

    def execute(self, sql):
        self._log.append(sql)
        self.description = [(c, None, None, None, None, None, None) for c in self._cols]

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, rows, cols, log):
        self._args = (rows, cols, log)

    def cursor(self):
        return FakeCursor(*self._args)

    def close(self):
        pass


def _fake_connection(monkeypatch, rows, cols):
    from iblai_ontology.backend.discovery import engine as engine_mod

    log: list[str] = []
    monkeypatch.setattr(
        engine_mod,
        "create_connection",
        lambda adapter, config: FakeConn(rows, cols, log),
    )
    return log


_COURSES = {
    "schema_name": "campus",
    "table_name": "courses",
    "row_count": 2,
    "columns": [
        {"name": "course_id", "data_type": "String", "nullable": False},
        {"name": "title", "data_type": "String", "nullable": False},
        {"name": "credits", "data_type": "UInt32", "nullable": False},
    ],
    "primary_key_columns": ["course_id"],
}
_STUDENTS = {
    "schema_name": "campus",
    "table_name": "students",
    "row_count": 3,
    "columns": [
        {"name": "STUDENT_ID", "data_type": "String", "nullable": False},
        {"name": "NAME", "data_type": "String", "nullable": False},
        {"name": "EMAIL", "data_type": "String", "nullable": True},
    ],
    "primary_key_columns": ["STUDENT_ID"],
}


def _make_service(name="campus", *, db_type="clickhouse", tables=(), analysis=None):
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.backend.services.registry import save_manifest

    service = Service.objects.create(
        name=name,
        display_name=name,
        service_type="database",
        adapter="generic-clickhouse",
        host="127.0.0.1",
        connection_config_encrypted=encrypt_connection_config(
            {
                "db_type": db_type,
                "host": "127.0.0.1",
                "port": 1,
                "database": "campus",
                "username": "ro",
                "password": "x",
            }
        ),
        llm_analysis=analysis or {},
    )
    save_manifest(
        service,
        {
            "db_type": db_type,
            "host": "127.0.0.1",
            "database": "campus",
            "schemas": ["campus"],
            "tables": list(tables),
        },
    )
    return service


def _cache_rows(sql):
    from django.db import connection

    with connection.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def test_table_schedule_pulls_through_the_service_connection(backend, monkeypatch):
    from iblai_ontology.backend.discovery.introspection import SchemaManifest
    from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine
    from iblai_ontology.backend.provisioning.schema_generator import (
        CacheSchemaGenerator,
    )
    from iblai_ontology.backend.services.registry import with_tables
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.backend.sync.models import SyncRun

    service = _make_service(tables=[_COURSES])
    gen = backend / "generated" / "campus"
    gen.mkdir(parents=True)
    manifest = SchemaManifest.from_dict(with_tables(service).schema_manifest)
    (gen / "cache-schema.sql").write_text(CacheSchemaGenerator(manifest).generate())
    out = ProvisioningEngine(backend / "generated")._step_cache_schema(service, gen)
    assert out["statements"] == 2  # the table and its _synced_at index
    assert (backend / "sql" / "campus-cache.sql").exists()

    log = _fake_connection(
        monkeypatch,
        [("C1", "Algebra", Decimal("3")), ("C2", "Poetry", datetime(2026, 1, 1))],
        ["COURSE_ID", "TITLE", "CREDITS"],
    )
    sched = {
        "name": "campus-courses",
        "source": "campus-source",
        "service": "campus",
        "table": "campus.courses",
        "output": {
            "structured_cache": "courses",
            "text_memories": "/ontology/courses/",
            "primary_key": ["course_id"],
        },
    }
    result = SyncRunner()._run_schedule(sched, force_full=False)
    assert result.status == "success"
    assert (result.records_processed, result.records_created) == (2, 2)
    assert log == ["SELECT * FROM campus.courses"]
    # Decimal and datetime bound as text; keys lowercased onto the DDL's columns.
    assert _cache_rows("SELECT course_id, title, credits FROM courses ORDER BY 1") == [
        ("C1", "Algebra", "3"),
        ("C2", "Poetry", "2026-01-01 00:00:00"),
    ]
    assert (backend / "ontology" / "courses" / "C1.md").exists()

    again = SyncRunner()._run_schedule(sched, force_full=False)
    assert (again.records_created, again.records_updated) == (0, 2)
    assert (
        SyncRun.objects.filter(schedule_name="campus-courses", status="success").count()
        == 2
    )


def test_schedule_without_table_or_tool_fails_loudly(backend):
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.backend.sync.models import SyncRun

    result = SyncRunner()._run_schedule(
        {"name": "odd", "source": "x"}, force_full=False
    )
    assert result.status == "failed"
    assert (
        "neither a table nor a tool"
        in SyncRun.objects.get(schedule_name="odd").error_message
    )


def test_mapping_renames_columns_and_approve_regenerates(backend, monkeypatch):
    from iblai_ontology.backend.discovery.config_generator import apply_table_edits
    from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine
    from iblai_ontology.backend.sync.engine import SyncRunner

    analysis = {
        "table_descriptions": [
            {
                "table_name": "campus.students",
                "description": "",
                "entity_group": "students",
                "suggested_sync_cadence": "6h",
            }
        ],
        "entity_groups": {"students": ["students"]},
        "suggested_sync_schedules": {"campus.students": "6h"},
    }
    service = _make_service(tables=[_STUDENTS], analysis=analysis)
    # The console's edit: land the rows in the house `students` shape.
    service.llm_analysis = apply_table_edits(
        dict(service.llm_analysis),
        ["campus.students"],
        entity="students",
        fields={"STUDENT_ID": "id", "NAME": "full_name"},
        template="student",
    )
    service.save()
    assert service.llm_analysis["overrides"]["campus.students"]["fields"] == {
        "STUDENT_ID": "id",
        "NAME": "full_name",
    }

    gen = backend / "generated" / "campus"
    gen.mkdir(parents=True)
    (gen / "sync-schedules.yaml").write_text("schedules: []\n")
    ProvisioningEngine._regenerate(service, gen)
    sched = yaml.safe_load((gen / "sync-schedules.yaml").read_text())["schedules"][0]
    assert sched["service"] == "campus" and sched["table"] == "campus.students"
    assert sched["output"] == {
        "structured_cache": "students",
        "text_memories": "/ontology/students/",
        "primary_key": ["id"],
        "map": {"student_id": "id", "name": "full_name"},
        "template": "student",
    }
    ddl = (gen / "cache-schema.sql").read_text()
    assert "CREATE TABLE IF NOT EXISTS students (" in ddl
    assert "    id TEXT NOT NULL" in ddl and "    full_name TEXT NOT NULL" in ddl

    ProvisioningEngine(backend / "generated")._step_cache_schema(service, gen)
    _fake_connection(
        monkeypatch, [("S1", "Ada", "ada@x.edu")], ["STUDENT_ID", "NAME", "EMAIL"]
    )
    result = SyncRunner()._run_schedule(sched, force_full=False)
    assert result.status == "success" and result.records_created == 1
    assert _cache_rows("SELECT id, full_name, email FROM students") == [
        ("S1", "Ada", "ada@x.edu")
    ]
    # Renamed keys reach the memory too; the student template lacks fields, so generic.
    memory = (backend / "ontology" / "students" / "S1.md").read_text()
    assert "- full_name: Ada" in memory


def test_connector_cursor_exposes_description_and_plain_values():
    pd = pytest.importorskip("pandas")
    from iblai_ontology.backend.discovery.connectors import ConnectorConnection

    class Connector:
        def execute(self, sql):
            return pd.DataFrame(
                {
                    "ID": [1, 2],
                    "WHEN": pd.to_datetime(["2026-01-01", "2026-01-02"]),
                    "AMOUNT": [1.5, None],
                }
            )

    cur = ConnectorConnection(Connector(), "clickhouse").cursor()
    cur.execute("SELECT 1")
    assert [d[0] for d in cur.description] == ["ID", "WHEN", "AMOUNT"]
    rows = cur.fetchall()
    assert rows[0][0] == 1 and rows[0][1].startswith("2026-01-01")
    assert rows[1][2] is None


@pytest.mark.parametrize(
    "db_type,expected",
    [
        ("clickhouse", "SELECT * FROM s.t LIMIT 100"),
        ("oracle", "SELECT * FROM s.t FETCH FIRST 100 ROWS ONLY"),
        ("sqlserver", "SELECT TOP 100 * FROM s.t"),
    ],
)
def test_validator_samples_with_the_dialects_limit(
    backend, monkeypatch, db_type, expected
):
    from iblai_ontology.backend.provisioning.validator import ProvisioningValidator

    service = _make_service(
        db_type=db_type,
        tables=[{"schema_name": "s", "table_name": "t", "row_count": 5, "columns": []}],
    )
    log = _fake_connection(monkeypatch, [("x",)], ["A"])
    report = ProvisioningValidator(service).validate()
    assert report.ok and report.results[0].records == 1
    assert log == [expected]


def test_pull_table_refuses_a_capped_connector_result(backend, monkeypatch):
    from iblai_ontology.backend.discovery import engine as engine_mod
    from iblai_ontology.backend.discovery.connectors import ConnectorConnection
    from iblai_ontology.backend.sync.engine import SyncRunner

    pd = pytest.importorskip("pandas")

    class Capped:
        _max_rows = 2

        def execute(self, sql):
            return pd.DataFrame({"id": [1, 2]})

        def close(self):
            pass

    monkeypatch.setattr(
        engine_mod,
        "create_connection",
        lambda adapter, config: ConnectorConnection(Capped(), "clickhouse"),
    )
    service = _make_service(tables=[_COURSES])
    with pytest.raises(RuntimeError, match="capped the result at 2 rows"):
        SyncRunner().pull_table(service, "campus.courses")


def test_call_llm_iblai_posts_to_the_dm(backend, monkeypatch):
    import httpx
    from django.conf import settings

    from iblai_ontology.backend.discovery import llm_analyzer

    for key, value in (
        ("LLM_PROVIDER", "iblai"),
        ("LLM_MODEL", "iblai/iblai-pro"),
        ("LLM_BASE_URL", ""),
        ("LLM_API_KEY", None),
    ):
        monkeypatch.setattr(settings, key, value)
    monkeypatch.setenv("IBLAI_ORG", "demo")
    monkeypatch.setenv("IBLAI_ADMIN_TOKEN", "k")
    monkeypatch.setenv("IBLAI_AUTH_SCHEME", "Api-Token")
    monkeypatch.setenv("IBLAI_BASE_URL", "https://dm.example")
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update(url=url, headers=headers, json=json)
        content = '```json\n{"ok": true}\n```'
        return httpx.Response(
            200, json={"choices": [{"message": {"content": content}}]}
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    assert llm_analyzer._json_block(llm_analyzer.call_llm("sys", "prompt")) == {
        "ok": True
    }
    assert (
        captured["url"]
        == "https://dm.example/api/ai-mentor/orgs/demo/v1/chat/completions"
    )
    assert captured["headers"] == {"Authorization": "Api-Token k"}
    assert captured["json"]["model"] == "iblai/iblai-pro"
    assert captured["json"]["stream"] is False
    assert captured["json"]["messages"][0] == {"role": "system", "content": "sys"}

    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://asgi.example/")
    llm_analyzer.call_llm("sys", "prompt")
    assert captured["url"].startswith("https://asgi.example/api/ai-mentor/")

    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: httpx.Response(402, text="no credits"),
    )
    with pytest.raises(RuntimeError, match="HTTP 402 no credits"):
        llm_analyzer.call_llm("sys", "prompt")


def test_map_records_the_llm_proposal_as_overrides(backend, monkeypatch):
    from iblai_ontology.backend.discovery import llm_analyzer
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.backend.sync.engine import SyncRunner

    (backend / "sql").mkdir()
    (backend / "sql" / "schema.sql").write_text(
        "CREATE TABLE students (\n    id TEXT PRIMARY KEY,\n"
        "    full_name TEXT NOT NULL,\n    -- a comment\n    PRIMARY KEY (id)\n);\n"
    )
    assert llm_analyzer.MappingProposer.house_entities() == {
        "students": ["id", "full_name"]
    }
    _make_service(tables=[_STUDENTS])
    seen = {}

    def fake_llm(system, prompt):
        seen["prompt"] = prompt
        return json.dumps(
            {
                "tables": {
                    "campus.students": {
                        "entity": "students",
                        "fields": {
                            "STUDENT_ID": "id",
                            "NAME": "full_name",
                            "x": "Bad Name",
                        },
                        "template": "student",
                        "entity_group": "students",
                        "description": "One row per enrolled student.",
                    },
                    "campus.ghost": {"entity": "ghost"},
                }
            }
        )

    monkeypatch.setattr(llm_analyzer, "call_llm", fake_llm)
    monkeypatch.setattr(
        SyncRunner,
        "pull_table",
        lambda self, service, table, limit=None: [
            {"STUDENT_ID": "S1", "NAME": "Ada", "EMAIL": "ada@x.edu"}
        ],
    )
    applied = DiscoveryEngine().map("campus")
    assert applied == {
        "campus.students": {
            "entity": "students",
            "fields": {"student_id": "id", "name": "full_name"},
            "template": "student",
            "entity_group": "students",
            "description": "One row per enrolled student.",
        }
    }
    assert "students: id, full_name" in seen["prompt"]
    assert "sample rows" in seen["prompt"] and "S1" in seen["prompt"]
    overrides = Service.objects.get(name="campus").llm_analysis["overrides"]
    assert overrides["campus.students"]["entity"] == "students"
    assert "campus.ghost" not in overrides


def test_map_without_samples_sends_names_only(backend, monkeypatch):
    from iblai_ontology.backend.discovery import llm_analyzer
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine
    from iblai_ontology.backend.sync.engine import SyncRunner

    _make_service(tables=[_STUDENTS])
    seen = {}

    def fake_llm(system, prompt):
        seen["prompt"] = prompt
        return '{"tables": {}}'

    monkeypatch.setattr(llm_analyzer, "call_llm", fake_llm)
    monkeypatch.setattr(
        SyncRunner, "pull_table", lambda *a, **k: pytest.fail("no rows should be read")
    )
    assert DiscoveryEngine().map("campus", sample_rows=0) == {}
    assert (
        "STUDENT_ID (String)" in seen["prompt"] and "sample rows" not in seen["prompt"]
    )


def test_table_edit_serializer_accepts_the_mapping_keys():
    from iblai_ontology.backend.api.serializers import TableEditSerializer

    form = TableEditSerializer(
        data={"tables": ["a.b"], "fields": {"X": "id"}, "entity": "students"}
    )
    assert form.is_valid(), form.errors
    assert form.validated_data["fields"] == {"X": "id"}
    assert not TableEditSerializer(data={"tables": ["a.b"]}).is_valid()
    assert not TableEditSerializer(
        data={"tables": ["a.b"], "fields": {"X": "Bad Name"}}
    ).is_valid()


def test_tool_schedule_reads_its_custom_mcp_server(backend, monkeypatch):
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.backend.sync.models import SyncRun

    captured = {}

    class FakeResp:
        status_code = 200
        headers = {"content-type": "application/json"}
        # The custom servers answer one text item holding the whole JSON array.
        text = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                [
                                    {"id": "1", "name": "A", "props": {"k": 1}},
                                    {"id": "2", "name": "B", "props": {}},
                                ]
                            ),
                        }
                    ]
                },
            }
        )

        def raise_for_status(self):
            pass

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        return FakeResp()

    monkeypatch.setattr(
        "iblai_ontology.backend.mcp_server.toolbox_client.httpx.post", fake_post
    )
    monkeypatch.setenv("MCP_HUBSPOT_URL", "http://hubspot-mcp:3000")
    sched = {
        "name": "hubspot-contacts",
        "source": "hubspot-mcp",
        "tool": "list-contacts",
        "output": {
            "structured_cache": "contacts",
            "text_memories": "/ontology/contacts/",
            "primary_key": ["id"],
            "create_table": True,
        },
    }
    result = SyncRunner()._run_schedule(sched, force_full=False)
    assert result.status == "success" and result.records_processed == 2
    assert captured["url"] == "http://hubspot-mcp:3000/mcp"
    # Schema-on-write: the table came from the first row, nested values as JSON text.
    assert _cache_rows("SELECT id, name, props FROM contacts ORDER BY 1") == [
        ("1", "A", '{"k": 1}'),
        ("2", "B", "{}"),
    ]

    monkeypatch.delenv("MCP_HUBSPOT_URL")
    failed = SyncRunner()._run_schedule(sched, force_full=False)
    assert failed.status == "failed"
    error = SyncRun.objects.filter(
        schedule_name="hubspot-contacts", status="failed"
    ).get()
    assert "MCP_HUBSPOT_URL is not set" in error.error_message


def test_register_api_creates_the_service_and_catalog_schedules(backend):
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine
    from iblai_ontology.backend.provisioning.validator import ProvisioningValidator

    service = DiscoveryEngine().register_api(
        name="crm", adapter="hubspot_api", output_dir=str(backend / "gen")
    )
    assert (service.service_type, service.status) == ("api", "pending")
    assert service.display_name == "HubSpot CRM"
    assert service.host == "https://api.hubapi.com"
    schedules = yaml.safe_load((backend / "gen" / "sync-schedules.yaml").read_text())
    by_name = {s["name"]: s for s in schedules["schedules"]}
    assert set(by_name) == {"crm-deals", "crm-contacts"}
    assert by_name["crm-contacts"]["source"] == "crm-mcp"
    assert by_name["crm-contacts"]["tool"] == "list-contacts"
    assert by_name["crm-contacts"]["output"] == {
        "structured_cache": "contacts",
        "text_memories": "/ontology/contacts/",
        "primary_key": ["id"],
        "create_table": True,
    }
    # No tables to sample: the first sync is the check.
    report = ProvisioningValidator(service).validate()
    assert report.ok and report.results[0].error.startswith("api source")


def test_pull_table_quotes_postgres_identifiers(backend, monkeypatch):
    from iblai_ontology.backend.sync.engine import SyncRunner

    log = _fake_connection(monkeypatch, rows=[("1",)], cols=["id"])
    pg = _make_service(name="twenty", db_type="postgresql")
    SyncRunner().pull_table(pg, "workspace_x.workspaceMember", limit=5)
    assert log[-1] == 'SELECT * FROM "workspace_x"."workspaceMember" LIMIT 5'
    # Other dialects stay as they were.
    SyncRunner().pull_table(_make_service(), "campus.courses", limit=5)
    assert log[-1] == "SELECT * FROM campus.courses LIMIT 5"


_TWENTY_PEOPLE = {
    "people": {
        "table": "person",
        "entity": "persons",
        "fields": {"nameFirstName": "first_name", "companyId": "organization_id"},
    }
}


def test_api_schedules_carry_the_catalog_mapping():
    from iblai_ontology.backend.discovery.config_generator import api_schedules_yaml

    sched = yaml.safe_load(
        api_schedules_yaml("crm", "Twenty", {"people": "1h"}, _TWENTY_PEOPLE)
    )["schedules"][0]
    assert sched["tool"] == "list-people"
    assert sched["output"] == {
        "structured_cache": "persons",
        "text_memories": "/ontology/persons/",
        "primary_key": ["id"],
        "create_table": True,
        "map": {"namefirstname": "first_name", "companyid": "organization_id"},
    }


def test_map_from_catalog_applies_the_vendor_mapping(backend):
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine

    person = {
        "schema_name": "workspace_x",
        "table_name": "person",
        "row_count": 2,
        "columns": [
            {"name": "id", "data_type": "uuid", "nullable": False},
            {"name": "nameFirstName", "data_type": "text", "nullable": True},
            {"name": "companyId", "data_type": "uuid", "nullable": True},
        ],
        "primary_key_columns": ["id"],
    }
    _make_service(
        name="twenty",
        db_type="postgresql",
        tables=[person, _COURSES],
        analysis={"table_descriptions": [], "entity_groups": {}},
    )
    applied = DiscoveryEngine().map("twenty", catalog="twenty")
    # Only the tables the vendor mapping names; the renames lowercased, no LLM involved.
    assert set(applied) == {"workspace_x.person"}
    assert applied["workspace_x.person"]["entity"] == "persons"
    assert applied["workspace_x.person"]["fields"]["namefirstname"] == "first_name"
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    overrides = store.get(Service, name="twenty").llm_analysis["overrides"]
    assert overrides["workspace_x.person"]["entity"] == "persons"
