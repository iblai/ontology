"""``seed_example_data`` — populate a fresh SQLite cache with demo data.

Mirrors the console SPA's mock dataset (``portal/lib/ontology/mock/seed.ts``) so
the UI renders identically against a real backend during demos / LAN testing.

Guarded on purpose — it refuses to run unless **both**:
  1. the configured database is SQLite, and
  2. the SQLite file does not yet exist (it never clobbers an existing cache),
and it needs ``ONTOLOGY_CREDENTIAL_KEY`` set (the same key the server runs with)
to seal the demo connection credentials.

    uv run python -m iblai_ontology.backend.manage seed_example_data
"""

from __future__ import annotations

import os
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from iblai_ontology.backend.discovery.models import SafetyReport
from iblai_ontology.backend.provisioning.models import ProvisioningRun, ProvisioningStep
from iblai_ontology.backend.services.encryption import encrypt_connection_config
from iblai_ontology.backend.services.models import Service
from iblai_ontology.backend.services.registry import save_manifest
from iblai_ontology.backend.sync.models import SyncRun

# Demo credential value — masked by the API's redactor anyway; never a real secret.
_SECRET = "demo-not-a-real-secret"

_MANIFESTS = {
    "peoplesoft": {
        "db_type": "oracle",
        "total_tables": 847,
        "total_rows": 12_400_000,
        "tables": [
            {
                "schema_name": "SYSADM",
                "table_name": "PS_STDNT_CAR_TERM",
                "row_count": 2_345_678,
                "column_count": 24,
            },
            {
                "schema_name": "SYSADM",
                "table_name": "PS_STDNT_ENRL",
                "row_count": 1_876_543,
                "column_count": 31,
            },
            {
                "schema_name": "SYSADM",
                "table_name": "PS_FIN_AID_AWD",
                "row_count": 987_654,
                "column_count": 18,
            },
            {
                "schema_name": "SYSADM",
                "table_name": "PS_CLASS_TBL",
                "row_count": 543_210,
                "column_count": 42,
            },
            {
                "schema_name": "SYSADM",
                "table_name": "PS_STDNT_BIO",
                "row_count": 432_109,
                "column_count": 27,
            },
            {
                "schema_name": "SYSADM",
                "table_name": "PS_INSTITUTION",
                "row_count": 12,
                "column_count": 15,
            },
        ],
    },
    "canvas": {
        "db_type": "postgres",
        "total_tables": 38,
        "total_rows": 383_283,
        "tables": [
            {
                "schema_name": "public",
                "table_name": "enrollments",
                "row_count": 89_432,
                "column_count": 12,
            },
            {
                "schema_name": "public",
                "table_name": "submissions",
                "row_count": 234_871,
                "column_count": 9,
            },
            {
                "schema_name": "public",
                "table_name": "courses",
                "row_count": 1_204,
                "column_count": 14,
            },
            {
                "schema_name": "public",
                "table_name": "users",
                "row_count": 45_678,
                "column_count": 8,
            },
            {
                "schema_name": "public",
                "table_name": "assignments",
                "row_count": 12_098,
                "column_count": 11,
            },
        ],
    },
    "slate": {
        "db_type": "postgres",
        "total_tables": 19,
        "total_rows": 52_233,
        "tables": [
            {
                "schema_name": "slate",
                "table_name": "applications",
                "row_count": 14_567,
                "column_count": 22,
            },
            {
                "schema_name": "slate",
                "table_name": "prospects",
                "row_count": 28_901,
                "column_count": 16,
            },
            {
                "schema_name": "slate",
                "table_name": "decisions",
                "row_count": 8_765,
                "column_count": 11,
            },
        ],
    },
    "snowflake": {
        "db_type": "snowflake",
        "total_tables": 124,
        "total_rows": 25_317_762,
        "tables": [
            {
                "schema_name": "SALES",
                "table_name": "ORDERS",
                "row_count": 5_432_109,
                "column_count": 28,
            },
            {
                "schema_name": "SALES",
                "table_name": "CUSTOMERS",
                "row_count": 1_098_765,
                "column_count": 19,
            },
            {
                "schema_name": "HR",
                "table_name": "EMPLOYEES",
                "row_count": 23_456,
                "column_count": 23,
            },
            {
                "schema_name": "FINANCE",
                "table_name": "LEDGER",
                "row_count": 18_765_432,
                "column_count": 31,
            },
        ],
    },
}

# A few columns per seeded table (the real pipeline stores every column), and the
# entity group + description the analysis would produce, so the semantic map has
# something to colour. Mirrors portal/lib/ontology/mock/seed.ts.
_COLUMNS = {
    "PS_STDNT_CAR_TERM": ["EMPLID", "STRM", "ACAD_CAREER", "CUM_GPA", "TOT_CUMULATIVE"],
    "PS_STDNT_ENRL": [
        "EMPLID",
        "STRM",
        "CLASS_NBR",
        "ENRL_STATUS_REASON",
        "CRSE_GRADE_OFF",
    ],
    "PS_FIN_AID_AWD": [
        "EMPLID",
        "AID_YEAR",
        "ITEM_TYPE",
        "OFFER_AMOUNT",
        "DISBURSED_AMT",
    ],
    "PS_CLASS_TBL": ["CRSE_ID", "STRM", "CLASS_NBR", "SUBJECT", "CATALOG_NBR"],
    "PS_STDNT_BIO": ["EMPLID", "NAME", "BIRTHDATE", "SEX", "CITIZENSHIP_STATUS"],
    "PS_INSTITUTION": ["INSTITUTION", "DESCR", "COUNTRY", "EFFDT"],
    "enrollments": ["id", "user_id", "course_id", "role", "enrollment_state"],
    "submissions": ["id", "assignment_id", "user_id", "score", "submitted_at"],
    "courses": ["id", "name", "course_code", "term_id", "workflow_state"],
    "users": ["id", "name", "email", "login_id", "created_at"],
    "assignments": ["id", "course_id", "title", "due_at", "points_possible"],
    "applications": ["id", "prospect_id", "program", "term", "status"],
    "prospects": ["id", "first_name", "last_name", "email", "source"],
    "decisions": ["id", "application_id", "decision", "decided_at", "notes"],
    "ORDERS": ["ORDER_ID", "CUSTOMER_ID", "ORDER_DATE", "TOTAL_AMOUNT", "STATUS"],
    "CUSTOMERS": ["CUSTOMER_ID", "NAME", "EMAIL", "REGION", "CREATED_AT"],
    "EMPLOYEES": ["EMPLOYEE_ID", "NAME", "DEPARTMENT", "HIRE_DATE", "SALARY"],
    "LEDGER": ["ENTRY_ID", "ACCOUNT", "AMOUNT", "POSTED_AT", "MEMO"],
}
_GROUPS = {
    "PS_STDNT_CAR_TERM": (
        "students",
        "Student career/term records: GPA, credits, status.",
    ),
    "PS_STDNT_ENRL": ("enrollment", "Class enrollments per student and term."),
    "PS_FIN_AID_AWD": ("financial_aid", "Financial aid awards by aid year."),
    "PS_CLASS_TBL": ("courses", "Scheduled class sections per term."),
    "PS_STDNT_BIO": ("students", "Student biographic and demographic data."),
    "PS_INSTITUTION": ("other", "Institution reference table."),
    "enrollments": ("enrollment", "Course enrollments with role and state."),
    "submissions": ("courses", "Assignment submissions and scores."),
    "courses": ("courses", "Canvas courses by term."),
    "users": ("students", "Canvas user accounts."),
    "assignments": ("courses", "Assignments with due dates and points."),
    "applications": ("admissions", "Admission applications by program and term."),
    "prospects": ("admissions", "Prospective students and their source."),
    "decisions": ("admissions", "Admission decisions per application."),
    "ORDERS": ("finance", "Sales orders and totals."),
    "CUSTOMERS": ("customers", "Customer master records."),
    "EMPLOYEES": ("hr", "Employee records with department and salary."),
    "LEDGER": ("finance", "General ledger entries."),
}
# Foreign keys the discovery adapters would report, so the graph can link tables and records.
_FOREIGN_KEYS = {
    "PS_STDNT_ENRL": [
        ("EMPLID", "PS_STDNT_BIO", "EMPLID"),
        ("CLASS_NBR", "PS_CLASS_TBL", "CLASS_NBR"),
    ],
    "PS_STDNT_CAR_TERM": [("EMPLID", "PS_STDNT_BIO", "EMPLID")],
    "PS_FIN_AID_AWD": [("EMPLID", "PS_STDNT_BIO", "EMPLID")],
    "enrollments": [("user_id", "users", "id"), ("course_id", "courses", "id")],
    "submissions": [("assignment_id", "assignments", "id"), ("user_id", "users", "id")],
    "assignments": [("course_id", "courses", "id")],
    "applications": [("prospect_id", "prospects", "id")],
    "decisions": [("application_id", "applications", "id")],
    "ORDERS": [("CUSTOMER_ID", "CUSTOMERS", "CUSTOMER_ID")],
}

for _manifest in _MANIFESTS.values():
    for _t in _manifest["tables"]:
        _t["foreign_keys"] = [
            {"column": c, "references_table": rt, "references_column": rc}
            for c, rt, rc in _FOREIGN_KEYS.get(_t["table_name"], [])
        ]
        _t["columns"] = [
            {
                "name": c,
                "data_type": "text",
                "nullable": i > 0,
                "is_primary_key": i == 0,
            }
            for i, c in enumerate(_COLUMNS[_t["table_name"]])
        ]


def _analysis(service: str) -> dict:
    """A discovery-shaped llm_analysis (table_descriptions + entity_groups)."""
    descriptions, groups = [], {}
    for t in _MANIFESTS[service]["tables"]:
        group, desc = _GROUPS[t["table_name"]]
        descriptions.append(
            {
                "table_name": f"{t['schema_name']}.{t['table_name']}",
                "description": desc,
                "entity_group": group,
                "suggested_sync_cadence": "6h",
                "sync_rationale": "seeded",
            }
        )
        groups.setdefault(group, []).append(t["table_name"])
    return {
        "table_descriptions": descriptions,
        "entity_groups": groups,
        "used_llm": False,
    }


_STEP_TYPES = [
    "cache_schema",
    "text_templates",
    "mcp_tools",
    "sync_schedules",
    "docker_compose",
    "validation",
]

_SAFETY_TESTS = [
    "CREATE TABLE",
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP TABLE",
    "ALTER TABLE",
    "TRUNCATE",
]


def _write_vault(root: Path) -> int:
    """A small synthetic memory vault: students, courses and enrollments that reference them."""
    written = 0
    for domain in ("students", "courses", "enrollment"):
        (root / domain).mkdir(parents=True, exist_ok=True)
    for i in range(1, 121):
        (root / "students" / f"S{i:04d}.md").write_text(
            f"# Student S{i:04d}\n\n- id: S{i:04d}\n- name: Student {i}\n- email: s{i}@example.edu\n"
        )
        written += 1
    for i in range(1, 41):
        (root / "courses" / f"C{100 + i}.md").write_text(
            f"# Course C{100 + i}\n\n- id: C{100 + i}\n- name: Course {i}\n- course_code: DEMO{i:03d}\n"
        )
        written += 1
    for i in range(1, 201):
        (root / "enrollment" / f"E{i:04d}.md").write_text(
            f"# Enrollment E{i:04d}\n\n- id: E{i:04d}\n- user_id: S{(i * 7) % 120 + 1:04d}\n"
            f"- course_id: C{100 + (i * 3) % 40 + 1}\n- role: student\n- enrollment_state: active\n"
        )
        written += 1
    return written


class Command(BaseCommand):
    help = "Create and seed a fresh SQLite demo database (refuses to overwrite an existing DB)."
    # Skip system checks so nothing opens the DB connection before the guards run
    # (opening a SQLite connection would create the file we're checking for).
    requires_system_checks: list = []

    def handle(self, *args, **options):
        if settings.ONTOLOGY_DATA_STORE != "local":
            raise CommandError(
                "ONTOLOGY_DATA_STORE is not local — the demo seeds the local SQLite cache only."
            )
        db = settings.DATABASES["default"]
        engine = str(db.get("ENGINE", ""))
        if not engine.endswith("sqlite3"):
            raise CommandError(
                f"database engine is {engine!r}, not SQLite — refusing to seed."
            )

        path = Path(str(db.get("NAME", "")))
        if path.exists():
            raise CommandError(
                f"{path} already exists — refusing to overwrite. Delete it (or point "
                "ONTOLOGY_SQLITE_PATH at a new file) and re-run."
            )

        if not settings.CREDENTIAL_ENCRYPTION_KEY:
            raise CommandError(
                "ONTOLOGY_CREDENTIAL_KEY is not set (needed to encrypt the demo "
                "credentials, and to read them back at runtime). Generate one:\n"
                '  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )

        call_command("migrate", run_syncdb=True, verbosity=0)
        counts = self._seed()
        root = os.environ.get("ONTOLOGY_FILES_ROOT")
        if root:
            counts["memories"] = _write_vault(Path(root))
        self.stdout.write(
            self.style.SUCCESS(
                "Seeded %s — %s"
                % (path, ", ".join(f"{k}={v}" for k, v in counts.items()))
            )
        )

    def _seed(self) -> dict[str, int]:
        now = timezone.now()
        hours = lambda h: now - timedelta(hours=h)  # noqa: E731
        days = lambda d: now - timedelta(days=d)  # noqa: E731
        mins = lambda m: now - timedelta(minutes=m)  # noqa: E731

        services = [
            dict(
                name="peoplesoft",
                display_name="PeopleSoft (Oracle)",
                service_type="database",
                adapter="peoplesoft",
                status="active",
                host="psft-db.internal.edu",
                cfg={
                    "host": "psft-db.internal.edu",
                    "port": "1521",
                    "database": "CSPRD",
                    "user": "iblai_readonly",
                    "password": _SECRET,
                },
                llm=_analysis("peoplesoft"),
                last_discovery_at=days(2),
                last_safety_check_at=hours(20),
                safety_status="passed",
                last_sync_at=mins(45),
                sync_status="success",
                tables_synced=847,
                rows_synced=12_400_000,
            ),
            dict(
                name="canvas",
                display_name="Instructure Canvas LMS",
                service_type="api",
                adapter="canvas_api",
                status="active",
                host="canvas.instructure.com",
                cfg={
                    "base_url": "https://canvas.instructure.com",
                    "api_token": _SECRET,
                },
                llm=_analysis("canvas"),
                last_discovery_at=days(5),
                last_safety_check_at=days(5),
                safety_status="passed",
                last_sync_at=hours(2),
                sync_status="success",
                tables_synced=38,
                rows_synced=383_283,
            ),
            dict(
                name="slate",
                display_name="Technolutions Slate CRM",
                service_type="api",
                adapter="slate_api",
                status="pending",
                host="slate.alasu.edu",
                cfg={"base_url": "https://slate.alasu.edu", "api_key": _SECRET},
                llm=_analysis("slate"),
                last_discovery_at=days(1),
                last_safety_check_at=days(1),
                safety_status="passed",
                last_sync_at=None,
                sync_status="never_run",
                tables_synced=0,
                rows_synced=0,
            ),
            dict(
                name="snowflake",
                display_name="Snowflake Data Warehouse",
                service_type="database",
                adapter="snowflake",
                status="error",
                host="xy12345.us-east-1.snowflakecomputing.com",
                cfg={
                    "account": "xy12345",
                    "user": "iblai_readonly",
                    "password": _SECRET,
                    "warehouse": "ANALYTICS_WH",
                },
                llm=_analysis("snowflake"),
                last_discovery_at=days(3),
                last_safety_check_at=days(3),
                safety_status="failed",
                last_sync_at=hours(18),
                sync_status="failed",
                tables_synced=0,
                rows_synced=0,
            ),
        ]

        by_name: dict[str, Service] = {}
        for s in services:
            by_name[s["name"]] = Service.objects.create(
                name=s["name"],
                display_name=s["display_name"],
                service_type=s["service_type"],
                adapter=s["adapter"],
                status=s["status"],
                host=s["host"],
                connection_config_encrypted=encrypt_connection_config(s["cfg"]),
                llm_analysis=s["llm"],
                last_discovery_at=s["last_discovery_at"],
                last_safety_check_at=s["last_safety_check_at"],
                safety_status=s["safety_status"],
                last_sync_at=s["last_sync_at"],
                sync_status=s["sync_status"],
                tables_synced=s["tables_synced"],
                rows_synced=s["rows_synced"],
            )
            save_manifest(by_name[s["name"]], _MANIFESTS[s["name"]])

        # Safety reports — one per service, DROP TABLE fails on the unsafe one.
        for s in services:
            name = s["name"]
            passed = s["safety_status"] == "passed"
            details = [
                {
                    "test_name": tn,
                    "sql_attempted": f"-- {tn} attempt on {name}",
                    "result": "passed"
                    if passed
                    else ("failed" if tn == "DROP TABLE" else "passed"),
                    "detail": "Write correctly denied by read-only account."
                    if passed
                    else "Write succeeded - account is not read-only.",
                }
                for tn in _SAFETY_TESTS
            ]
            report = SafetyReport.objects.create(
                service_name=name,
                db_type=_MANIFESTS[name]["db_type"],
                host="psft-db.internal.edu" if name == "peoplesoft" else "db.internal",
                port=1521 if name == "peoplesoft" else 5432,
                database="CSPRD" if name == "peoplesoft" else name,
                username=f"{name}_readonly",
                status="passed" if passed else "failed",
                tests_run=7,
                tests_passed=7 if passed else 6,
                tests_failed=0 if passed else 1,
                details=details,
                error_message=None,
            )
            # created_at is auto_now_add; backdate it to match the service's last check.
            SafetyReport.objects.filter(id=report.id).update(created_at=hours(20))

        # Provisioning runs (+ 6 steps each), mirroring the mock's states.
        self._make_run(by_name, "peoplesoft", "completed", now)
        self._make_run(by_name, "canvas", "completed", now)
        self._make_run(by_name, "slate", "failed", now, fail_at=3)
        self._make_run(by_name, "snowflake", "running", now)

        runs = [
            (
                "peoplesoft-students",
                "peoplesoft",
                mins(45),
                mins(43),
                "success",
                1247,
                12,
                1235,
                None,
                95,
            ),
            (
                "peoplesoft-financial-aid",
                "peoplesoft",
                mins(50),
                mins(48),
                "success",
                89,
                3,
                86,
                None,
                42,
            ),
            (
                "canvas-activity",
                "canvas",
                hours(2),
                hours(2),
                "success",
                4521,
                1024,
                3497,
                None,
                180,
            ),
            (
                "peoplesoft-courses",
                "peoplesoft",
                hours(6),
                hours(6),
                "success",
                432,
                0,
                432,
                None,
                28,
            ),
            (
                "canvas-submissions",
                "canvas",
                hours(1),
                hours(1),
                "failed",
                0,
                0,
                0,
                "Connection timeout to canvas.instructure.com",
                30,
            ),
            (
                "peoplesoft-students",
                "peoplesoft",
                hours(3),
                hours(3),
                "success",
                1198,
                8,
                1190,
                None,
                88,
            ),
        ]
        for (
            sched,
            src,
            started,
            completed,
            status,
            proc,
            created,
            updated,
            err,
            dur,
        ) in runs:
            SyncRun.objects.create(
                schedule_name=sched,
                source_system=src,
                started_at=started,
                completed_at=completed,
                status=status,
                records_processed=proc,
                records_created=created,
                records_updated=updated,
                error_message=err,
                duration_seconds=Decimal(str(dur)),
            )

        return {
            "services": Service.objects.count(),
            "safety_reports": SafetyReport.objects.count(),
            "provisioning_runs": ProvisioningRun.objects.count(),
            "steps": ProvisioningStep.objects.count(),
            "sync_runs": SyncRun.objects.count(),
        }

    def _make_run(self, by_name, name, status, now, fail_at=None):
        hours = lambda h: now - timedelta(hours=h)  # noqa: E731
        run = ProvisioningRun.objects.create(
            service=by_name[name], status=status, config_snapshot={}
        )
        completed_at = hours(43) if status in ("completed", "failed") else None
        err = (
            f"Pipeline failed at step {_STEP_TYPES[fail_at if fail_at is not None else 0]}."
            if status == "failed"
            else None
        )
        # started_at is auto_now_add; .update() bypasses it to backdate the run.
        ProvisioningRun.objects.filter(id=run.id).update(
            started_at=now - timedelta(days=2),
            completed_at=completed_at,
            error_message=err,
        )
        for i, step in enumerate(_STEP_TYPES):
            if status == "completed":
                st = (
                    "skipped"
                    if (step == "docker_compose" and name == "peoplesoft")
                    else "completed"
                )
            elif status == "running":
                st = "completed" if i < 2 else ("running" if i == 2 else "pending")
            elif fail_at is not None and i < fail_at:
                st = "completed"
            elif i == fail_at:
                st = "failed"
            else:
                st = "pending"
            output = (
                {"ok": True}
                if st == "completed"
                else {"skipped": "database service uses shared MCP Toolbox"}
                if st == "skipped"
                else {"error": f"Failed during {step}: permission denied"}
                if st == "failed"
                else {}
            )
            ProvisioningStep.objects.create(
                run=run,
                step_type=step,
                status=st,
                order=i,
                started_at=None if st == "pending" else hours(48 - i * 2),
                completed_at=hours(47 - i * 2)
                if st in ("completed", "skipped", "failed")
                else None,
                output=output,
                error_message="Permission denied during operation."
                if st == "failed"
                else None,
            )
