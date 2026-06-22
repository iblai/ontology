"""Django-backed test for the cache upsert path (SQLite stands in for Postgres)."""

from __future__ import annotations

import pytest

django = pytest.importorskip("django")

pytestmark = pytest.mark.django


@pytest.fixture()
def django_conn(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.db import connection

    with connection.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS cache_demo (id TEXT PRIMARY KEY, name TEXT)")
    return connection


def test_upsert_inserts_then_updates(django_conn, tmp_path):
    from iblai_ontology.backend.sync.writer import write_entities

    with django_conn.cursor() as cur:
        r1 = write_entities(
            cur,
            [{"id": "1", "name": "Alice"}, {"id": "2", "name": "Bob"}],
            cache_table="cache_demo",
            primary_key="id",
            entity_group="generic",
            files_root=str(tmp_path / "ontology"),
        )
        assert (r1.created, r1.updated) == (2, 0)
        assert r1.processed == 2

        # Re-write one existing (update) + one new (insert).
        r2 = write_entities(
            cur,
            [{"id": "1", "name": "Alice2"}, {"id": "3", "name": "Carol"}],
            cache_table="cache_demo",
            primary_key="id",
            entity_group="generic",
            files_root=str(tmp_path / "ontology"),
        )
        assert (r2.created, r2.updated) == (1, 1)

        cur.execute("SELECT name FROM cache_demo WHERE id = %s", ["1"])
        assert cur.fetchone()[0] == "Alice2"
        cur.execute("SELECT COUNT(*) FROM cache_demo")
        assert cur.fetchone()[0] == 3

    # Text memories were written for each processed row.
    assert (tmp_path / "ontology" / "generic" / "1.md").exists()
    assert (tmp_path / "ontology" / "generic" / "3.md").exists()


def test_upsert_missing_pk_raises(django_conn, tmp_path):
    from iblai_ontology.backend.sync.writer import write_entities

    with django_conn.cursor() as cur:
        with pytest.raises(KeyError):
            write_entities(
                cur,
                [{"name": "no-id"}],
                cache_table="cache_demo",
                primary_key="id",
                files_root=str(tmp_path / "ontology"),
            )
