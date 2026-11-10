"""Unit tests for the read-only safety verifier (no DB required)."""

from __future__ import annotations

from iblai_ontology.backend.discovery.safety import SafetyVerifier
from iblai_ontology.backend.discovery.safety import TestResult as Status

_WRITE_KEYWORDS = ("CREATE", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE")


class FakeCursor:
    """A DB-API-ish cursor whose write behaviour is configurable."""

    def __init__(self, *, deny_writes: bool, has_table: bool = True):
        self.deny_writes = deny_writes
        self.has_table = has_table
        self._result = None

    def execute(self, sql: str):
        upper = sql.strip().upper()
        # Metadata reads used to locate a table / first column.
        if upper.startswith("SELECT") or upper.startswith("SHOW"):
            if "COLUMN_NAME" in upper or "SYS.COLUMNS" in upper:
                self._result = ("some_col",)
            elif (
                "TABLE_SCHEMA, TABLE_NAME" in upper
            ):  # PostgreSQL: schema-qualified probe table
                self._result = ("public", "SOME_TABLE") if self.has_table else None
            elif "TABLE_NAME" in upper or "TABLES" in upper or upper.startswith("SHOW"):
                self._result = ("SOME_TABLE",) if self.has_table else None
            else:
                self._result = ("x",)
            return
        # Any write statement.
        if any(upper.startswith(k) for k in _WRITE_KEYWORDS):
            if self.deny_writes:
                raise Exception("ERROR: permission denied for relation some_table")
            # Write succeeds (dangerous).
            self._result = None
            return
        self._result = None

    def fetchone(self):
        return self._result

    def fetchall(self):
        return [self._result] if self._result else []


class FakeConnection:
    def __init__(self, *, deny_writes: bool, has_table: bool = True):
        self.deny_writes = deny_writes
        self.has_table = has_table
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return FakeCursor(deny_writes=self.deny_writes, has_table=self.has_table)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_readonly_credentials_pass():
    conn = FakeConnection(deny_writes=True)
    result = SafetyVerifier(conn, db_type="postgresql").run_all_tests()
    assert result.all_passed
    assert result.overall_status == Status.PASSED
    assert len(result.tests) == 7
    assert all(t.result == Status.PASSED for t in result.tests)
    assert result.remediation_sql is None


def test_write_credentials_fail_and_get_remediation():
    conn = FakeConnection(deny_writes=False)
    result = SafetyVerifier(conn, db_type="postgresql").run_all_tests()
    assert not result.all_passed
    assert result.overall_status == Status.FAILED
    assert any(t.result == Status.FAILED for t in result.tests)
    assert "CREATE ROLE" in result.remediation_sql  # postgres remediation


def test_no_tables_is_inconclusive():
    conn = FakeConnection(deny_writes=True, has_table=False)
    result = SafetyVerifier(conn, db_type="postgresql").run_all_tests()
    assert result.overall_status == Status.ERROR
    assert result.tests == []


def test_remediation_sql_per_dialect():
    for db_type, marker in [
        ("oracle", "CREATE USER iblai_readonly"),
        ("mysql", "CREATE USER 'iblai_readonly'"),
        ("sqlserver", "db_datareader"),
    ]:
        v = SafetyVerifier(FakeConnection(deny_writes=True), db_type=db_type)
        assert marker in v.remediation_sql()


class RecordingCursor(FakeCursor):
    """Records SQL; a DROP of the never-created probe table reports it missing."""

    def __init__(self, log: list[str], **kw):
        super().__init__(**kw)
        self.log = log

    def execute(self, sql: str):
        self.log.append(sql)
        if sql.strip().upper().startswith("DROP"):
            raise Exception(
                "Table demo.__iblai_safety_test does not exist. (UNKNOWN_TABLE)"
            )
        super().execute(sql)


class RecordingConnection(FakeConnection):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.log: list[str] = []

    def cursor(self):
        return RecordingCursor(
            self.log, deny_writes=self.deny_writes, has_table=self.has_table
        )


def test_drop_of_never_created_probe_table_counts_as_denied():
    result = SafetyVerifier(
        RecordingConnection(deny_writes=True), db_type="postgresql"
    ).run_all_tests()
    assert result.all_passed
    drop = next(t for t in result.tests if t.test_name == "DROP TABLE")
    assert drop.result == Status.PASSED


def test_missing_table_excuses_only_the_drop_probe():
    class MissingOnInsert(RecordingCursor):
        def execute(self, sql: str):
            if sql.strip().upper().startswith("INSERT"):
                raise Exception('relation "some_table" does not exist')
            super().execute(sql)

    class Conn(RecordingConnection):
        def cursor(self):
            return MissingOnInsert(self.log, deny_writes=True)

    result = SafetyVerifier(
        Conn(deny_writes=True), db_type="postgresql"
    ).run_all_tests()
    insert = next(t for t in result.tests if t.test_name == "INSERT")
    assert insert.result == Status.ERROR
    assert not result.all_passed


def test_alter_probe_uses_add_column_except_on_oracle():
    pg = RecordingConnection(deny_writes=True)
    SafetyVerifier(pg, db_type="postgresql").run_all_tests()
    assert any(
        s.startswith('ALTER TABLE "public"."SOME_TABLE" ADD COLUMN ') for s in pg.log
    )

    ora = RecordingConnection(deny_writes=True)
    SafetyVerifier(ora, db_type="oracle").run_all_tests()
    assert any(
        s.startswith("ALTER TABLE SOME_TABLE ADD __iblai_safety_col") for s in ora.log
    )


def test_postgres_probe_targets_any_readable_schema():
    # A CRM keeps its tables outside public; the probes name them quoted, camelCase intact.
    class WorkspaceCursor(RecordingCursor):
        def execute(self, sql: str):
            if "TABLE_SCHEMA, TABLE_NAME" in sql.upper():
                self.log.append(sql)
                self._result = ("workspace_x", "workspaceMember")
                return
            super().execute(sql)

    class Conn(RecordingConnection):
        def cursor(self):
            return WorkspaceCursor(self.log, deny_writes=True)

    conn = Conn(deny_writes=True)
    result = SafetyVerifier(conn, db_type="postgresql").run_all_tests()
    assert result.all_passed
    assert any(
        s.startswith('INSERT INTO "workspace_x"."workspaceMember" ("some_col")')
        for s in conn.log
    )
