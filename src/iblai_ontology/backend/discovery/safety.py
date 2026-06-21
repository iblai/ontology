"""Read-only safety verification suite (Component 5.2).

Before iblai-ontology touches a single row, it must prove the supplied
credentials are read-only by attempting a comprehensive suite of write
operations. Every one must FAIL. ``PASSED`` therefore means "the write was
correctly denied". If ANY write succeeds, the overall result is ``FAILED`` and
nothing else runs.

This module is intentionally Django-free: it operates on any DB-API 2.0
connection (oracledb, psycopg2, pymysql, pyodbc).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger("iblai_ontology.safety")


class TestResult(Enum):
    PASSED = "passed"  # write correctly DENIED (what we want)
    FAILED = "failed"  # write SUCCEEDED (dangerous)
    ERROR = "error"  # could not run the test (inconclusive)


@dataclass
class SafetyTestResult:
    test_name: str
    sql_attempted: str
    result: TestResult
    error_message: Optional[str] = None
    detail: Optional[str] = None


@dataclass
class SafetyVerificationResult:
    overall_status: TestResult
    db_type: str
    tests: list[SafetyTestResult] = field(default_factory=list)
    remediation_sql: Optional[str] = None

    @property
    def all_passed(self) -> bool:
        return bool(self.tests) and all(t.result == TestResult.PASSED for t in self.tests)

    @property
    def summary(self) -> str:
        passed = sum(1 for t in self.tests if t.result == TestResult.PASSED)
        failed = sum(1 for t in self.tests if t.result == TestResult.FAILED)
        errors = sum(1 for t in self.tests if t.result == TestResult.ERROR)
        return f"{passed} passed, {failed} FAILED, {errors} errors out of {len(self.tests)} tests"


# Substrings that indicate a write was *correctly* refused.
PERMISSION_INDICATORS = (
    "permission denied",
    "insufficient privileges",
    "ora-01031",  # Oracle: insufficient privileges
    "ora-01950",  # Oracle: no privileges on tablespace
    "ora-00942",  # Oracle: table or view does not exist (DROP on our temp table)
    "access denied",
    "not allowed",
    "permission",
    "privilege",
    "read-only",
    "readonly",
    "denied to user",
    "must be owner",
)


class SafetyVerifier:
    """Verifies that DB credentials are read-only by attempting writes."""

    WRITE_TESTS = [
        {"name": "CREATE TABLE", "description": "Attempt to create a new table"},
        {"name": "INSERT", "description": "Attempt to insert a row"},
        {"name": "UPDATE", "description": "Attempt to update a row"},
        {"name": "DELETE", "description": "Attempt to delete a row"},
        {"name": "DROP TABLE", "description": "Attempt to drop a table"},
        {"name": "ALTER TABLE", "description": "Attempt to alter a table"},
        {"name": "TRUNCATE", "description": "Attempt to truncate a table"},
    ]

    def __init__(self, connection, db_type: Optional[str] = None) -> None:
        self.connection = connection
        self.db_type = db_type or self._detect_db_type()

    # -- detection -------------------------------------------------------
    def _detect_db_type(self) -> str:
        module_name = type(self.connection).__module__
        if "cx_Oracle" in module_name or "oracledb" in module_name:
            return "oracle"
        if "psycopg" in module_name:
            return "postgresql"
        if "pymysql" in module_name or "MySQLdb" in module_name:
            return "mysql"
        if "pyodbc" in module_name:
            return "sqlserver"
        raise ValueError(f"Unknown database driver module: {module_name}")

    # -- helpers ---------------------------------------------------------
    def _find_existing_table(self) -> Optional[str]:
        cursor = self.connection.cursor()
        queries = {
            "oracle": "SELECT table_name FROM user_tables WHERE ROWNUM = 1",
            "postgresql": (
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' LIMIT 1"
            ),
            "mysql": "SHOW TABLES",
            "sqlserver": "SELECT TOP 1 name FROM sys.tables",
        }
        cursor.execute(queries[self.db_type])
        row = cursor.fetchone()
        return row[0] if row else None

    def _get_first_column(self, table_name: str) -> str:
        cursor = self.connection.cursor()
        queries = {
            "oracle": (
                "SELECT column_name FROM user_tab_columns "
                f"WHERE table_name = '{table_name.upper()}' AND ROWNUM = 1"
            ),
            "postgresql": (
                "SELECT column_name FROM information_schema.columns "
                f"WHERE table_name = '{table_name}' LIMIT 1"
            ),
            "mysql": (
                "SELECT column_name FROM information_schema.columns "
                f"WHERE table_name = '{table_name}' LIMIT 1"
            ),
            "sqlserver": (
                "SELECT TOP 1 name FROM sys.columns "
                f"WHERE object_id = OBJECT_ID('{table_name}')"
            ),
        }
        cursor.execute(queries[self.db_type])
        row = cursor.fetchone()
        return row[0] if row else "id"

    def _get_test_sql(self, test_name: str, existing_table: str) -> str:
        col = self._get_first_column(existing_table)
        return {
            "CREATE TABLE": "CREATE TABLE __iblai_safety_test (id INTEGER)",
            "INSERT": f"INSERT INTO {existing_table} ({col}) VALUES (NULL)",
            "UPDATE": f"UPDATE {existing_table} SET {col} = {col} WHERE 1=0",
            "DELETE": f"DELETE FROM {existing_table} WHERE 1=0",
            "DROP TABLE": "DROP TABLE __iblai_safety_test",
            "ALTER TABLE": f"ALTER TABLE {existing_table} ADD __iblai_safety_col INTEGER",
            "TRUNCATE": f"TRUNCATE TABLE {existing_table}",
        }[test_name]

    # -- runner ----------------------------------------------------------
    def run_all_tests(self) -> SafetyVerificationResult:
        logger.info("Starting safety verification for %s database", self.db_type)
        existing_table = self._find_existing_table()
        if not existing_table:
            return SafetyVerificationResult(
                overall_status=TestResult.ERROR,
                db_type=self.db_type,
                tests=[],
                remediation_sql=self.remediation_sql(),
            )

        results: list[SafetyTestResult] = []
        for test in self.WRITE_TESTS:
            result = self._run_single_test(test["name"], existing_table)
            results.append(result)
            if result.result == TestResult.FAILED:
                logger.critical(
                    "SAFETY FAILURE: %s SUCCEEDED on %s — these credentials have "
                    "write access!",
                    test["name"],
                    self.db_type,
                )

        all_passed = all(r.result == TestResult.PASSED for r in results)
        verification = SafetyVerificationResult(
            overall_status=TestResult.PASSED if all_passed else TestResult.FAILED,
            db_type=self.db_type,
            tests=results,
            remediation_sql=None if all_passed else self.remediation_sql(),
        )
        logger.info("Safety verification complete: %s", verification.summary)
        return verification

    def _run_single_test(self, test_name: str, existing_table: str) -> SafetyTestResult:
        try:
            sql = self._get_test_sql(test_name, existing_table)
        except Exception as exc:  # building the SQL needs a read; surface as ERROR
            return SafetyTestResult(test_name, "", TestResult.ERROR, error_message=str(exc)[:500])

        cursor = self.connection.cursor()
        try:
            cursor.execute(sql)
            # If we reach here, the write SUCCEEDED — dangerous. Undo it.
            try:
                self.connection.rollback()
            except Exception:
                pass
            if test_name == "CREATE TABLE":
                try:
                    cursor.execute("DROP TABLE __iblai_safety_test")
                    self.connection.commit()
                except Exception:
                    pass
            return SafetyTestResult(
                test_name=test_name,
                sql_attempted=sql,
                result=TestResult.FAILED,
                detail=f"DANGEROUS: {test_name} succeeded — user has write access.",
            )
        except Exception as exc:
            error_str = str(exc).lower()
            if any(ind in error_str for ind in PERMISSION_INDICATORS):
                return SafetyTestResult(
                    test_name=test_name,
                    sql_attempted=sql,
                    result=TestResult.PASSED,
                    detail=f"Correctly denied: {str(exc)[:200]}",
                )
            return SafetyTestResult(
                test_name=test_name,
                sql_attempted=sql,
                result=TestResult.ERROR,
                error_message=str(exc)[:500],
                detail="Non-permission error — test inconclusive",
            )
        finally:
            try:
                self.connection.rollback()
            except Exception:
                pass

    # -- remediation -----------------------------------------------------
    def remediation_sql(self) -> str:
        return REMEDIATION_SQL.get(
            self.db_type, "Unknown database type. Please create a read-only user manually."
        )


REMEDIATION_SQL = {
    "oracle": """\
-- Oracle: create a read-only user for iblai-ontology (run as SYSDBA/DBA)
CREATE USER iblai_readonly IDENTIFIED BY "<STRONG_PASSWORD_HERE>";
GRANT CREATE SESSION TO iblai_readonly;
BEGIN
    FOR t IN (SELECT table_name FROM all_tables WHERE owner = 'SYSADM') LOOP
        EXECUTE IMMEDIATE 'GRANT SELECT ON SYSADM.' || t.table_name || ' TO iblai_readonly';
    END LOOP;
END;
/
""",
    "postgresql": """\
-- PostgreSQL: create a read-only role (run as superuser/owner)
CREATE ROLE iblai_readonly WITH LOGIN PASSWORD '<STRONG_PASSWORD_HERE>';
GRANT CONNECT ON DATABASE your_database TO iblai_readonly;
GRANT USAGE ON SCHEMA public TO iblai_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO iblai_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO iblai_readonly;
""",
    "mysql": """\
-- MySQL: create a read-only user
CREATE USER 'iblai_readonly'@'%' IDENTIFIED BY '<STRONG_PASSWORD_HERE>';
GRANT SELECT ON your_database.* TO 'iblai_readonly'@'%';
FLUSH PRIVILEGES;
""",
    "sqlserver": """\
-- SQL Server: create a read-only login/user
CREATE LOGIN iblai_readonly WITH PASSWORD = '<STRONG_PASSWORD_HERE>';
USE your_database;
CREATE USER iblai_readonly FOR LOGIN iblai_readonly;
ALTER ROLE db_datareader ADD MEMBER iblai_readonly;
""",
}
