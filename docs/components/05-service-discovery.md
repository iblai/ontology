# Component 5 — Service Discovery Engine

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

Integrating a new source system (PeopleSoft, Banner, Canvas, …) into iblai-ontology means generating database connection configs, MCP tool definitions, sync schedules, cache schemas, and text-memory templates. Doing that by hand is error-prone and demands deep knowledge of both the source schema and the iblai-ontology config format.

The Service Discovery Engine automates it. Given credentials or API endpoints, it:

1. **Verifies the credentials are truly read-only** — a hard safety gate (critical).
2. **Introspects the schema** — tables, columns, relationships, row counts.
3. **Optionally analyzes the schema with an LLM** — plain-English descriptions, entity groupings, suggested tools, sync cadences, and a draft cache schema.
4. **Produces a reviewable configuration package** that the Provisioning Engine ([Component 6](06-provisioning.md)) executes.

The engine lives in the Django backend (`discovery/` app: `safety.py`, `introspection.py`, `llm_analyzer.py`, `config_generator.py`, and `adapters/`). The CLI entry point is `ontology service add`, which dispatches into `DiscoveryEngine`.

---

## The Read-Only Safety Verification Suite

This is the single most important safety mechanism in the product. **Before iblai-ontology reads a single row, it proves it cannot write one.**

### Why it matters

Universities hand over credentials to *production* databases — student records, financial aid, grades, HR. If those credentials had write access and our software had a bug, we could corrupt production data. So the safety suite is a hard gate: **if it does not pass, nothing else runs.**

### The seven write tests

The verifier attempts seven write operations and requires that **all seven be denied**. The terminology is deliberately inverted, and it matters:

> **PASSED = the write was correctly DENIED.** A "passed" test is a write that *failed* with a permission error. A "failed" test is a write that *succeeded* — which is dangerous.

| # | Test | SQL attempted (schematically) |
|---|---|---|
| 1 | CREATE TABLE | `CREATE TABLE __iblai_safety_test (id INTEGER)` |
| 2 | INSERT | `INSERT INTO <existing_table> (<col>) VALUES (NULL)` |
| 3 | UPDATE | `UPDATE <existing_table> SET <col> = <col> WHERE 1=0` |
| 4 | DELETE | `DELETE FROM <existing_table> WHERE 1=0` |
| 5 | DROP TABLE | `DROP TABLE __iblai_safety_test` |
| 6 | ALTER TABLE | `ALTER TABLE <existing_table> ADD __iblai_safety_col INTEGER` |
| 7 | TRUNCATE | `TRUNCATE TABLE <existing_table>` |

The destructive tests (UPDATE/DELETE) are written with `WHERE 1=0` so that *even if the credentials wrongly have write access*, no rows change; any accidental success is immediately rolled back, and a created safety table is dropped. The verifier classifies each attempt:

- **PASSED** — the database raised a permission error (e.g. Oracle `ORA-01031: insufficient privileges`, PostgreSQL "permission denied", "read-only", "access denied"). This is the desired outcome.
- **FAILED** — the write succeeded. Logged at CRITICAL; the overall result is FAILED.
- **ERROR** — a non-permission error (syntax, missing table). Inconclusive, not counted as a pass.

A successful report (`ontology service test peoplesoft`):

```
  Test 1: CREATE TABLE  -> DENIED (ORA-01031: insufficient privileges)
  Test 2: INSERT        -> DENIED (ORA-01031: insufficient privileges)
  ...
  Test 7: TRUNCATE      -> DENIED (ORA-01031: insufficient privileges)

  OVERALL: PASSED — 7/7 write operations correctly denied.
  This user is confirmed read-only. Safe to proceed with schema introspection.
```

A failing report refuses to proceed and prints the remediation SQL:

```
  Test 1: CREATE TABLE  -> SUCCEEDED — THIS USER HAS WRITE ACCESS!
  ...
  OVERALL: FAILED — 2/7 write operations SUCCEEDED.
  REFUSING TO PROCEED. iblai-ontology will NOT connect to this database.
  Please create a read-only user. SQL provided below.
```

### Remediation SQL (per database)

When verification fails, the engine emits ready-to-run SQL to create a proper read-only user for the detected database type. Summaries:

| DB | Approach |
|---|---|
| **Oracle** | `CREATE USER iblai_readonly`; `GRANT CREATE SESSION`; loop `GRANT SELECT` on every table in the owner schema (e.g. `SYSADM`); verify no privileges beyond `CREATE SESSION` and only `SELECT` table grants. |
| **PostgreSQL** | `CREATE ROLE iblai_readonly WITH LOGIN`; `GRANT CONNECT` on the DB, `GRANT USAGE` on schemas, `GRANT SELECT ON ALL TABLES`, and `ALTER DEFAULT PRIVILEGES … GRANT SELECT` for future tables. |
| **MySQL** | `CREATE USER 'iblai_readonly'@'%'`; `GRANT SELECT ON db.*`; `FLUSH PRIVILEGES`. |
| **SQL Server** | `CREATE LOGIN` + `CREATE USER`; `ALTER ROLE db_datareader ADD MEMBER iblai_readonly` (SELECT-only). |

The full statements are produced at runtime by the engine; representative Oracle remediation:

```sql
CREATE USER iblai_readonly IDENTIFIED BY "<STRONG_PASSWORD_HERE>";
GRANT CREATE SESSION TO iblai_readonly;
BEGIN
  FOR t IN (SELECT table_name FROM all_tables WHERE owner = 'SYSADM') LOOP
    EXECUTE IMMEDIATE 'GRANT SELECT ON SYSADM.' || t.table_name || ' TO iblai_readonly';
  END LOOP;
END;
/
```

> The `--skip-safety` flag exists on `ontology service add`/`discover` but is **not recommended** and is intended only for re-discovery against a source already verified read-only.

---

## Schema Introspection

Once safety passes, the introspector builds a complete **manifest** of accessible tables, columns, relationships, and statistics. It supports Oracle, PostgreSQL, MySQL, and SQL Server, using each system's catalog views (`all_tables`/`all_tab_columns`, `information_schema`, `sys.tables`/`sys.columns`). For each table it collects row count, columns (name, type, nullability, max length), primary keys, and foreign keys.

The manifest serializes to JSON and to a human-readable Markdown summary (tables sorted by row count, with a per-table column table marking PKs and FKs). Generated artifacts land under `config/manifests/`:

```
config/manifests/peoplesoft-manifest.json
config/manifests/peoplesoft-summary.md
```

---

## BYOK LLM Analysis

When an LLM API key is configured, the engine sends the manifest to the model to produce descriptions and draft configuration. **The key is bring-your-own** — iblai-ontology never ships or requires one.

### Configuration

```yaml
# config/ontology.yaml
llm:
  provider: null            # "anthropic" | "openai" | null (disabled)
  api_key: null             # set via: ontology config llm
  model: null               # see defaults below
  max_tokens: 4096
  temperature: 0.2          # low temperature for deterministic config generation
```

```bash
ontology config llm
# LLM provider (anthropic/openai): anthropic
# API key: ********
```

**Default models (as implemented in this repo):**

| Provider | Default model |
|---|---|
| `anthropic` | `claude-opus-4-8` |
| `openai` | `gpt-4o` |

You can override the model with `ontology config llm --model <name>` or `ontology config set llm.model <name>`.

### What the LLM produces

The analyzer asks the model (a higher-ed schema analyst, per its system prompt) to:

1. Describe each table in plain English (what it stores, what a row represents).
2. Group tables by entity domain (`students`, `courses`, `financial_aid`, `hr`, `facilities`, …).
3. Suggest parameterized SQL queries (MCP tools) for common use cases.
4. Suggest sync cadences by volatility — static reference data weekly/daily; slowly-changing every 6h; frequently-changing (enrollment, grades, holds) hourly or less; real-time-critical every 5m.
5. Draft a PostgreSQL cache schema for the most important entities.

The result is parsed into structured suggestions and written to `config/generated/<service>/`:

```
tools.yaml
sync-schedules.yaml
cache-schema.sql
entity-groups.yaml
table-descriptions.md
```

You review these, then either approve (`ontology service approve <service>`) or edit and re-generate (`ontology service discover <service>`).

### Rule-based fallback (no LLM)

Without a key, a rule-based analyzer handles common higher-ed patterns. It is less descriptive but fully functional — it classifies tables by known prefixes and applies size-based heuristics for sync cadence. The PeopleSoft adapter, for example, maps `PS_STDNT_*` → `students`, `PS_FIN_AID_*` → `financial_aid`, `PS_JOB`/`PS_EMPLOYMENT` → `hr`, and ships descriptions for well-known tables (e.g. `PS_STDNT_CAR_TERM` → "Student career/term records … GPA, credits, enrollment status", sync `1h`). Cadence heuristics: tables > 1M rows → `24h`, > 100k → `6h`, > 10k → `1h`, else `6h`.

---

## Adapter Table

iblai-ontology ships pre-built adapters for common higher-ed systems. Database adapters add safety + introspection + known-pattern intelligence; API adapters wrap REST endpoints.

| Adapter | Source type | Connection method | Known patterns |
|---|---|---|---|
| **PeopleSoft** | Oracle DB | JDBC / `oracledb` | `PS_*` prefixes, EMPLID keys, STRM (term) codes |
| **Ellucian Banner** | Oracle DB | JDBC / `oracledb` | `S*`/`G*`/`F*` prefixes (SPRIDEN, SGBSTDN, …) |
| **Workday** | REST API | HTTPS | Workday REST/SOAP endpoints, worker/student objects |
| **Canvas LMS** | REST API | HTTPS | `/api/v1/*` endpoints, paginated responses |
| **Slate CRM** | REST API | HTTPS | Slate query API, form submissions |
| **EAB Navigate** | REST API | HTTPS | Student-success alerts, appointments, notes |
| **Generic Oracle** | Oracle DB | JDBC / `oracledb` | Schema discovery only |
| **Generic PostgreSQL** | PostgreSQL | `psycopg2` | Schema discovery only |
| **Generic MySQL** | MySQL | `pymysql` | Schema discovery only |
| **Generic SQL Server** | SQL Server | `pyodbc` | Schema discovery only |

The CLI exposes these as the `--service-type` choices on `ontology service add`: `peoplesoft`, `banner`, `workday`, `canvas`, `slate`, `navigate`, `generic-oracle`, `generic-postgres`, `generic-mysql`, `generic-mssql`.

---

## Service Registry

Every integrated service is tracked in `config/services.yaml` and the `services` Django app's `Service` model. Connection details are **encrypted at rest with Fernet** (`services/encryption.py`) — only non-secret metadata appears in `services.yaml`; passwords live encrypted in the database. Each record carries the schema manifest, LLM analysis, last safety check + status, and last sync stats.

```yaml
# config/services.yaml (excerpt — maintained by the registry)
services:
  - name: peoplesoft
    display_name: "PeopleSoft (Oracle)"
    type: database
    adapter: peoplesoft
    status: active
    connection:
      db_type: oracle
      host: ps-db.university.edu
      port: 1521
      database: CSPRD
      username: iblai_readonly
      # password stored encrypted in the database, not here
    safety:
      last_check: "2026-06-15T10:28:00Z"
      status: passed
      tests_passed: 7
      tests_failed: 0
```

---

## Interactive `ontology service add` Flow

The full pipeline, end to end:

```
$ ontology service add

Available adapters:
  1. PeopleSoft (Oracle)   2. Ellucian Banner (Oracle)   3. Workday (API)
  4. Canvas LMS (API)      5. Slate CRM (API)            6. EAB Navigate (API)
  7-10. Generic Oracle / PostgreSQL / MySQL / SQL Server

Select adapter [1-10]: 1
Service name [peoplesoft]: peoplesoft
  Host: ps-db.university.edu
  Port [1521]: 1521
  Database/Service name: CSPRD
  Username: iblai_readonly
  Password: ********

[1/6] Connecting to Oracle @ ps-db.university.edu:1521/CSPRD ... OK (Oracle 19c)

[2/6] Running Safety Verification (7 tests)
  CREATE TABLE / INSERT / UPDATE / DELETE / DROP / ALTER / TRUNCATE — all denied
  Safety check PASSED (7/7). Credentials are read-only.

[3/6] Schema Introspection
  3 schemas, 847 tables, 12,453 columns, 1,204 foreign keys
  Manifest -> config/manifests/peoplesoft-manifest.json
  Top tables: PS_STDNT_CAR_TERM (2.3M), PS_STDNT_ENRL (1.9M), PS_CLASS_TBL (1.2M) ...

LLM analysis available (Anthropic claude-opus-4-8 configured). Run LLM analysis? [Y/n]: Y

[4/6] LLM Schema Analysis (claude-opus-4-8)
  Entity groups: students (23), courses (18), enrollment (12),
    financial_aid (15), admissions (11), hr (9), demographics (7), other (5)
  Suggested: 24 MCP tools across 6 toolsets; sync cadences 5m..weekly; 8-table cache schema
  Generated config/generated/peoplesoft/{tools.yaml, sync-schedules.yaml,
    cache-schema.sql, entity-groups.yaml, table-descriptions.md}

  Review the files, then:  ontology service approve peoplesoft
  Or edit and re-generate: ontology service discover peoplesoft
```

Steps 5 (provisioning) and 6 (validation) are the [Provisioning Engine](06-provisioning.md). When run via `service add`, the full discover → approve → provision sequence can run in one invocation; `discover` / `approve` let you insert a manual review gate.

### Related CLI commands

```bash
ontology service test <name>       # run only the 7-test safety suite
ontology service status <name>     # connectivity + read-only + latency
ontology service discover <name>   # re-introspect (optionally --no-llm)
ontology service approve <name>    # provision the generated config
ontology service list              # all services with status
ontology service remove <name>     # teardown (drops cache tables, removes config)
```

---

## Related

- What discovery feeds into: [06-provisioning.md](06-provisioning.md)
- Where tools/toolsets end up: [01-mcp-inbound.md](01-mcp-inbound.md)
- CLI reference for `service` and `config`: [07-cli.md](07-cli.md)
