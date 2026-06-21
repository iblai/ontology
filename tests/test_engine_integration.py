"""End-to-end DiscoveryEngine integration test against a real (sqlite) ORM.

Marked ``django``; skipped if the backend extra is not installed. Exercises the
full pipeline glue: safety gate -> Service registry write -> SafetyReport ->
rule-based analysis -> config generation.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

django = pytest.importorskip("django")
cryptography = pytest.importorskip("cryptography")

pytestmark = pytest.mark.django

REPO_ROOT = Path(__file__).resolve().parent.parent


class CombinedPGCursor:
    """A fake postgresql cursor handling both safety writes and introspection."""

    _WRITE = ("CREATE", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE")

    def __init__(self):
        self._rows: list = []

    def execute(self, sql: str):
        u = sql.strip().upper()
        if any(u.startswith(k) for k in self._WRITE):
            raise Exception("ERROR: permission denied for relation foo")
        if "INFORMATION_SCHEMA.SCHEMATA" in u:
            self._rows = [("public",)]
        elif "INFORMATION_SCHEMA.TABLES" in u and "TABLE_TYPE" in u:
            self._rows = [("ps_stdnt_car_term", 1000)]
        elif "INFORMATION_SCHEMA.TABLES" in u:  # safety: find a table
            self._rows = [("ps_stdnt_car_term",)]
        elif "TABLE_CONSTRAINTS" in u:
            self._rows = [("emplid",)]
        elif "REFERENTIAL_CONSTRAINTS" in u:
            self._rows = []
        elif "INFORMATION_SCHEMA.COLUMNS" in u:
            self._rows = [("emplid", "text", "NO", None, None)]
        elif "CURRENT_DATABASE" in u:
            self._rows = [("ontology",)]
        else:
            self._rows = [("emplid",)]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class CombinedPGConn:
    def cursor(self):
        return CombinedPGCursor()

    def commit(self):
        pass

    def rollback(self):
        pass


@pytest.fixture()
def django_db(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    shutil.copy(REPO_ROOT / "config" / "roles.yaml", cfg / "roles.yaml")
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())

    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0)
    yield


def test_discovery_engine_end_to_end(django_db, tmp_path, monkeypatch):
    from iblai_ontology.backend.discovery import engine as engine_mod
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine
    from iblai_ontology.backend.discovery.models import SafetyReport
    from iblai_ontology.backend.services.models import Service

    monkeypatch.setattr(engine_mod, "create_connection", lambda *a, **k: CombinedPGConn())

    out = tmp_path / "generated"
    result = DiscoveryEngine().run(
        name="pg-test",
        service_type="generic-postgres",
        host="localhost",
        port=5432,
        database="src",
        user="ro",
        password="x",
        use_llm=False,
        output_dir=str(out),
    )

    # Service registered, safety recorded as passed, config generated.
    service = Service.objects.get(name="pg-test")
    assert service.safety_status == "passed"
    assert SafetyReport.objects.filter(service_name="pg-test", status="passed").exists()
    assert (out / "tools.yaml").exists()
    assert (out / "cache-schema.sql").exists()
    assert result["manifest"].total_tables == 1


def test_discovery_engine_blocks_on_write_access(django_db, tmp_path, monkeypatch):
    from iblai_ontology.backend.discovery import engine as engine_mod
    from iblai_ontology.backend.discovery.engine import DiscoveryEngine, SafetyError

    class WritableConn(CombinedPGConn):
        def cursor(self):
            cur = CombinedPGCursor()
            # Make writes "succeed" (dangerous) by overriding execute.
            cur.execute = lambda sql: setattr(cur, "_rows", [("x",)])  # type: ignore
            return cur

    monkeypatch.setattr(engine_mod, "create_connection", lambda *a, **k: WritableConn())
    with pytest.raises(SafetyError):
        DiscoveryEngine().run(
            name="bad",
            service_type="generic-postgres",
            host="h",
            port=5432,
            database="src",
            user="rw",
            password="x",
            use_llm=False,
            output_dir=str(tmp_path / "g"),
        )
