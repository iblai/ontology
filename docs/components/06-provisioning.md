# Component 6 — Provisioning Engine

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

The Provisioning Engine takes the output of service discovery ([Component 5](05-service-discovery.md)) — the schema manifest, the LLM analysis, and the generated configuration files — and executes everything needed to make an integration *operational*. It is the bridge between "we know what this database looks like" and "it's syncing, cached, and queryable via MCP."

It lives in the Django backend (`provisioning/` app); the CLI dispatches into `ProvisioningEngine` via `ontology service approve <name>` (provision) and `ontology service remove <name>` (teardown).

---

## The Pipeline

The pipeline runs in a strict order with validation gates between steps:

```
Discovery Output
  -> [1] Cache Schema      (PostgreSQL CREATE TABLEs + indexes + views)
  -> [2] Text Templates    (Jinja2 memory templates per entity)
  -> [3] MCP Tools         (tools.yaml entries: sources, tools, toolsets)
  -> [4] Sync Schedules    (sync-schedules.yaml entries)
  -> [5] Docker Compose    (new MCP-server containers / env wiring)
  -> [6] Validation        (end-to-end test sync per service)
[Components 1-4 are now configured and running]
```

Each step can run independently or as part of the full pipeline, and **every step is idempotent** — running it twice produces the same result with no side effects (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, upserts into the YAML config, etc.).

A run is tracked by `ProvisioningRun` (status: pending / running / completed / failed / rolled_back) with one `ProvisioningStep` per pipeline step, each carrying its own status, output artifacts, and any error — so a partial failure shows exactly which step stopped.

---

## Step 1 — Cache Schema Generation

Generates PostgreSQL `CREATE TABLE` statements for the local cache from the discovered manifest. The cache is a **denormalized projection** of the source, optimized for the queries the MCP tools will run — not a faithful clone of the source schema.

Highlights of the generator:

- **Type mapping.** Source types are mapped to PostgreSQL: Oracle `VARCHAR2`/`CLOB`→`TEXT`, `NUMBER`→`NUMERIC`, `DATE`→`TIMESTAMP`, `TIMESTAMP(6) WITH TIME ZONE`→`TIMESTAMPTZ`; SQL Server `uniqueidentifier`→`UUID`, `bit`→`BOOLEAN`, `money`→`NUMERIC(19,4)`; MySQL `int`→`INTEGER`, `datetime`→`TIMESTAMP`, etc. Unknown types fall back to `TEXT`.
- **Table selection.** If you pass explicit tables, those are used; otherwise the LLM's entity groups drive selection; otherwise all tables under ~1M rows are cached.
- **Cache-friendly names.** Source prefixes are stripped (`PS_`, `SPRIDEN_`, `SGBSTDN_`) and tables land in a dedicated `cache` schema (`cache.<name>`).
- **Metadata columns.** Every cache table gets `_synced_at TIMESTAMPTZ`, `_source_schema`, and `_source_table`.
- **Indexes.** An index on `_synced_at` (freshness queries) plus one per foreign-key column.
- **Materialized views.** Stubs for entity-level aggregations (e.g. a student summary) are scaffolded as comments to be customized after generation.

Output is written to `config/generated/<service>/cache-schema.sql`. The canonical, hand-curated cache schema for the core domains lives in `sql/schema.sql` and `sql/views.sql`; see [Component 2](02-knowledge-materialization.md).

---

## Step 2 — Text Memory Templates

Generates Jinja2 templates (`templates/<entity>.md.j2`) so the sync engine can render consistent Markdown memory files for the new entities, and scaffolds the corresponding directories under `/ontology/<domain>/`. See the text-memory layout in [Component 2](02-knowledge-materialization.md#2b--text-memories-markdown).

---

## Step 3 — MCP Tools Configuration

Merges the generated `tools.yaml` entries (sources, tools, toolsets) into the canonical `config/tools.yaml` consumed by the MCP Toolbox ([Component 1](01-mcp-inbound.md)). Existing entries are updated in place rather than duplicated.

---

## Step 4 — Sync Schedules

Merges the generated schedule entries into `config/sync-schedules.yaml` ([Component 2](02-knowledge-materialization.md#sync-schedulesyaml)), with cadences suggested by the LLM (or the rule-based heuristics). After this step, `ontology sync schedule` shows the new schedules.

---

## Step 5 — Docker Compose Update

For API-based sources, generates and wires the new custom MCP-server container (e.g. `mcp-canvas`) into the Compose stack — image/build context, env file, and placement on the internal-only network. Database sources reuse the existing `mcp-toolbox` container (no new service needed).

---

## Step 6 — End-to-End Validation

Runs a **test sync** for a handful of high-priority tables and confirms records flow all the way through to the cache and the memory files. Example:

```
[6/6] Validation
  Running test sync for 3 high-priority tables...
  PS_STDNT_CAR_TERM: 4,287 records synced OK
  PS_SRVC_IND_DATA:    342 records synced OK
  PS_STDNT_AWARDS:   8,934 records synced OK
  Service 'peoplesoft-main' is ready.
```

If validation fails, the run is marked `failed` and you can inspect which step stopped via the `ProvisioningStep` records.

---

## Rollback and Teardown

- **Rollback.** Each `ProvisioningRun` stores `rollback_data` (what was created), so a failed run can be reversed cleanly. A reversed run is marked `rolled_back`.
- **Teardown.** `ontology service remove <name>` calls `ProvisioningEngine().teardown(name)`, which drops the service's cache tables and removes its generated configuration. The CLI confirms first unless you pass `--yes`:

```bash
ontology service remove peoplesoft-main          # prompts for confirmation
ontology service remove peoplesoft-main --yes    # non-interactive
```

Because every step is idempotent and tracked, you can re-run provisioning after fixing a problem without fear of duplicate tables or config drift.

---

## Related

- Where the inputs come from: [05-service-discovery.md](05-service-discovery.md)
- What the outputs configure: [01-mcp-inbound.md](01-mcp-inbound.md), [02-knowledge-materialization.md](02-knowledge-materialization.md)
- CLI reference for `service`: [07-cli.md](07-cli.md)
