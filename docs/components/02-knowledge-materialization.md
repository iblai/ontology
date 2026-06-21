# Component 2 — Knowledge Materialization ("iblai-ontology")

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

This is the core innovation, and the component the whole product is named after. Instead of routing every agent query to live source systems — slow, brittle, and permission-complex — iblai-ontology **materializes** knowledge into a local store optimized for consumption. Three stores work together:

1. **Text memories** — human-readable Markdown, organized by domain. Agent-native.
2. **Structured cache** — a local PostgreSQL database for aggregations, joins, and analytics.
3. **Vector index** — embeddings over the text memories (ChromaDB) for semantic search.

A scheduled **sync engine** keeps all three current by pulling from the Component 1 MCP layer.

---

## 2A — Sync Engine

The sync engine queries source systems via MCP on a schedule, transforms the results, and writes them into the local stores. It is itself an MCP client (and, conceptually, an agent): the sync logic is inspectable, auditable, and adjustable through configuration rather than code changes. In this repo it runs as a Celery-backed Django service (the `sync-engine` container); the `SyncRunner` backend class is what the CLI dispatches into.

### Three sync modes

| Mode | Cadence | Typical data |
|---|---|---|
| **Full refresh** | nightly / weekly | Degree programs, course catalogs, org charts, policy documents |
| **Delta refresh** | every 5–60 minutes | Student holds, enrollment status, financial-aid packaging, grades |
| **Event-driven** | real-time (webhooks) | Application submissions, registration changes, emergency alerts |

Event-driven sync is a Phase 4 capability; full and delta are the day-one modes.

### `sync-schedules.yaml`

Schedules are declared in `config/sync-schedules.yaml`. Each entry names a cron expression, the source and tool to call, and where the output goes (`text_memories` path and/or `structured_cache` table).

```yaml
schedules:
  # NIGHTLY FULL REFRESHES (run at 2:00 AM local time)
  - name: students-full
    cron: "0 2 * * *"
    source: peoplesoft-oracle
    tool: get-all-active-students
    output:
      text_memories: /ontology/students/
      structured_cache: students
    description: Full refresh of all active student records

  - name: financial-aid-full
    cron: "0 3 * * *"
    source: peoplesoft-oracle
    tool: get-all-aid-packages
    output:
      text_memories: /ontology/financial-aid/
      structured_cache: financial_aid
    description: Full refresh of financial aid data

  # FREQUENT DELTA REFRESHES
  - name: student-holds-delta
    cron: "*/5 * * * *"
    source: peoplesoft-oracle
    tool: get-recent-hold-changes
    output:
      text_memories: /ontology/students/by-id/
      structured_cache: holds
    description: Check for new/changed holds every 5 minutes

  - name: enrollment-changes-delta
    cron: "*/15 * * * *"
    source: peoplesoft-oracle
    tool: get-enrollment-changes
    output:
      text_memories: /ontology/enrollment/
      structured_cache: enrollment
    description: Check for enrollment changes every 15 minutes

  # CANVAS SYNC (API-based, respecting rate limits)
  - name: canvas-activity
    cron: "0 */4 * * *"
    source: canvas-mcp
    tool: get-student-activity-bulk
    output:
      text_memories: /ontology/students/by-id/
    description: Sync Canvas activity data every 4 hours

  # WEEKLY
  - name: org-chart
    cron: "0 6 * * 1"
    source: ldap-mcp
    tool: get-org-structure
    output:
      text_memories: /ontology/hr/
    description: Weekly org chart refresh from LDAP/AD
```

Inspect and operate schedules from the CLI:

```bash
ontology sync schedule          # show all configured schedules
ontology sync run               # run all due syncs now
ontology sync run peoplesoft-main --schedule student-holds-delta
ontology sync run peoplesoft-main --full     # force a full refresh
ontology sync status            # latest run per schedule
ontology sync history --limit 20
```

Every run is recorded in the `sync_runs` table (id, schedule, source, started/completed, status, records processed/created/updated, duration, error) for the audit trail.

---

## 2B — Text Memories (Markdown)

For each domain and entity, the sync engine produces human-readable, agent-queryable Markdown files under a single root (`/ontology`, mounted as the `ontology-files` volume).

### Directory layout

```
/ontology/
  _schema/
    entities.md              # Master entity definitions
    relationships.md         # How entities connect
    business-rules.md        # Institutional rules and policies
  students/
    _index.md                # Summary: total enrollment, demographics
    by-id/
      001234567.md           # Individual student profile
      ...
    cohorts/
      fall-2026-freshmen.md
      at-risk-retention.md
  courses/
    _index.md
    by-dept/CS.md
    sections/fall-2026.md
  financial-aid/
    _index.md
    packaging-rules.md
    by-student/001234567-aid.md
  enrollment/
    _index.md
    current-term.md
    registration-holds.md
  hr/
    _index.md
    org-chart.md
  facilities/
    _index.md
    buildings.md
    maintenance-queue.md
  _audit/
    sync-log.md              # Last sync timestamps, success/failure
    change-log.md            # What changed since last sync
```

Memory generation uses Jinja2 templates (e.g. `templates/student.md.j2`) so the rendered files are consistent and provisioning (Component 6) can scaffold templates for a newly discovered service.

### Example: a student memory file

`/ontology/students/by-id/001234567.md`:

```markdown
# Student: Jane Doe (001234567)

Last synced: 2026-06-20 02:00 UTC
Sources: PeopleSoft, Canvas, Navigate

## Demographics

- Full Name: Jane Doe
- EMPLID: 001234567
- Email: jdoe@alasu.edu
- Classification: Junior
- Admit Term: Fall 2023
- Expected Graduation: Spring 2027

## Academic Program

- Career: Undergraduate (UGRD)
- Program: BS Computer Science (BSCS)
- Plan: Computer Science (CS); Minor: Data Science
- Advisor: Dr. Robert Smith (rsmith@alasu.edu)

## Current Term: Fall 2026

- Enrollment Status: Enrolled (Full-time, 15 credits)
- Term GPA: 3.67 | Cumulative GPA: 3.42
- Credits Earned: 78 | Remaining for Degree: 42

### Enrolled Courses

| Course  | Section | Title             | Credits | Instructor   |
|---------|---------|-------------------|---------|--------------|
| CS301   | 001     | Data Structures   | 3       | Dr. Williams |
| CS315   | 001     | Database Systems  | 3       | Dr. Chen     |
| MATH240 | 002     | Linear Algebra    | 3       | Dr. Patel    |

## Financial Aid (AY 2026)

- Total Package: $8,450.00
- Pell Grant: $3,450.00 (Federal, accepted, $1,725.00 remaining)
- Presidential Scholarship: $5,000.00 (Institutional, accepted, $2,500.00 remaining)
- SAP Status: Good Standing | EFC: $4,200 | Outstanding Balance: $1,200.00
- Next Disbursement: 2026-08-15

## Holds

- No active holds

## Canvas Activity (last 7 days)

- Last Login: 2026-06-19 14:32 UTC
- Submissions: 4 (0 late, 0 missing)
- CS301 Current Grade: A- (91.5%) | MATH240: B+ (87.2%)
- At-risk Signals: None

## Navigate (Advising)

- Last Appointment: 2026-05-15 with Dr. Smith | Next: 2026-07-01
- Risk Score: Low | Early Alerts: None active
```

A domain `_index.md` (e.g. `/ontology/enrollment/_index.md`) summarizes the whole domain — total enrolled, breakdown by classification and college, retention metrics — so an agent can answer "how is fall enrollment looking?" by reading one file.

You can read any memory file from the CLI:

```bash
ontology data memory students/by-id/001234567
```

### Why text files?

1. **Agent-native.** LLMs read and reason over text without ORMs, query languages, or schema mapping.
2. **Inspectable.** A human opens any file and immediately sees what a consumer knows.
3. **Versionable.** Git-trackable and diff-able — you can see exactly what changed between syncs.
4. **Lightweight.** No Databricks, no Delta Lake, no Spark. Just files on disk.
5. **Permission-mappable.** Filesystem permissions and `roles.yaml` path globs directly control who reads what.
6. **Transport-agnostic.** Served via MCP, REST, a file share, or anything else.

---

## 2C — Structured Cache (PostgreSQL)

Text memories are ideal for natural-language consumption, but some questions need structure: aggregations, joins, filtering, analytics. For those, iblai-ontology maintains a local PostgreSQL cache (the `ontology-db` container).

The **full DDL lives in `sql/schema.sql`** (tables + indexes) and `sql/views.sql` (materialized views); both are mounted into the database container's init directory. The schema is summarized here.

### Core tables

| Table | Grain | Notes |
|---|---|---|
| `students` | one row per student | PK = EMPLID; name, classification, program, `cumulative_gpa`, `enrollment_status`, `has_active_holds`, `source_systems[]`, `last_synced_at`. Indexed on classification, major, status, GPA, holds, and a GIN full-text index on name. |
| `enrollment` | per student/term/course | course, section, credits, instructor, grade; unique on (student, term, course, section). |
| `term_summary` | per student/term | credits attempted/earned, term GPA, academic standing, full-time flag. |
| `holds` | per service indicator | code, description, dept, reason, effective/end dates; partial index for active holds. |
| `financial_aid` | per student/aid-year/item | fund source/type, offer/accept/disbursed/remaining amounts, status. |
| `sap_status` | per student/aid-year | overall, GPA, pace, max-timeframe statuses. |
| `isir_data` | per student/aid-year | EFC, SAI, dependency status, Pell eligibility, AGI. |
| `courses` / `course_sections` | catalog + per-term offerings | department, title, credits, prerequisites; section instructor/room/enrollment. |
| `canvas_activity` | per student/course | current grade/score, submission counts, missing/late, last login. |
| `advising` | per student | advisor, appointments, risk score, early alerts, notes. |
| `buildings` / `maintenance_requests` | facilities | building metadata; maintenance queue. |
| `employees` | per employee | self-referential `supervisor_id` for org chart. |
| `sync_runs` | per sync execution | drives `ontology sync status/history`. |
| `audit_log` | per access | user, role, action, resource, `entra_token_id` (JWT `jti`), IP — the end-to-end audit trail (see [identity.md](../identity.md)). |
| `identity_map` | per Entra user | maps `entra_oid` → `emplid` for `${USER_EMPLID}` resolution (see [identity.md](../identity.md)). |

Representative `students` columns:

```sql
CREATE TABLE students (
    id                TEXT PRIMARY KEY,        -- EMPLID from PeopleSoft
    full_name         TEXT NOT NULL,
    email             TEXT,
    classification    TEXT,                    -- Freshman, Sophomore, Junior, Senior
    acad_program      TEXT,
    major_code        TEXT,
    major_name        TEXT,
    cumulative_gpa    NUMERIC(4, 2),
    enrollment_status TEXT,                    -- Enrolled, Withdrawn, LOA, Graduated
    has_active_holds  BOOLEAN DEFAULT FALSE,
    source_systems    TEXT[],                  -- {"PeopleSoft", "Canvas", "Navigate"}
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Materialized views

`sql/views.sql` defines aggregation views the agents lean on, including:

- **`at_risk_students`** — enrolled students with GPA < 2.0, active holds, a "High" advising risk score, or > 3 missing Canvas assignments, joined across `students`, `advising`, and `canvas_activity`.
- **`aid_summary`** — recipients and offered/accepted/disbursed totals by aid year and fund source.

### Sample queries

```sql
-- "How many students are on academic probation?"
SELECT COUNT(*) FROM term_summary
WHERE term_code = 'FALL2026' AND academic_standing = 'Probation';

-- "Average accepted aid by classification (AY 2026)"
SELECT s.classification, ROUND(AVG(fa.total_aid), 2) AS avg_package
FROM students s
JOIN (
  SELECT student_id, SUM(accept_amount) AS total_aid
  FROM financial_aid WHERE aid_year = '2026' AND status = 'A'
  GROUP BY student_id
) fa ON s.id = fa.student_id
GROUP BY s.classification
ORDER BY avg_package DESC;
```

Run read-only queries from the CLI (only `SELECT` is accepted):

```bash
ontology data query "SELECT classification, COUNT(*) AS n FROM students GROUP BY classification"
ontology data stats     # files + cache size at a glance
```

---

## 2D — Vector Index

Embeddings over the text memories enable semantic search — questions that keyword search and SQL cannot express:

- "Find students who might be struggling with math this semester"
- "Which buildings have had the most maintenance requests this year?"
- "Are there financial-aid policies that affect international students?"

### Options

| Choice | Embedding model | When to use |
|---|---|---|
| **Local** | `nomic-embed-text` via Ollama | Fully air-gapped deployments; no data leaves the network |
| **Cloud** | OpenAI / Google embedding APIs | Hybrid setups where higher recall matters more than air-gap |

Storage is **ChromaDB**, running as the `vector-store` container in the stack. Search from the CLI:

```bash
ontology data search "students struggling with math" --domain students --limit 10
```

```
[0.89] /ontology/students/by-id/001234892.md
       MATH240 Current Grade: D (62.1%) | 3 missing assignments
[0.85] /ontology/students/by-id/001235011.md
       MATH101 Current Grade: F (45.8%) | At-risk: Yes
```

The embedding-model choice for air-gapped deployments is an open question — `nomic-embed-text` is less capable than cloud models and needs benchmarking at university scale (see the [architecture open questions](../architecture.md#open-design-questions)).

---

## Related

- Source tools the engine calls: [01-mcp-inbound.md](01-mcp-inbound.md)
- How this data is exposed and scoped by role: [04-mcp-outbound.md](04-mcp-outbound.md)
- How the cache schema and memory templates get generated for a new source: [06-provisioning.md](06-provisioning.md)
- CLI reference for `sync` and `data`: [07-cli.md](07-cli.md)
