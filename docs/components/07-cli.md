# Component 7 — CLI (`ontology`)

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

A comprehensive command-line interface for every management operation: service integration, configuration, sync, permissions, health, data inspection, deployment lifecycle, and MCP administration. Built with **`typer`** (and `rich` for output), installed as a single self-documenting `ontology` command.

- **Distribution:** `iblai-ontology` · **Import package:** `iblai_ontology` · **Command:** `ontology`
- The CLI and config layer are **Django-free**, so `ontology config init`, `ontology config *`, `ontology roles *`, `ontology sync schedule`, `ontology mcp tools/toolsets`, and `ontology data memory` all work on a fresh checkout. Commands that need long-running backend services call `bootstrap()` lazily and require the Django extra.

### Installation

```bash
pip install iblai-ontology
# or, developing this repo (see DEV.md):
uv sync
# inside the container:
docker compose exec ontology-gateway ontology --help
```

### Global options

```bash
ontology --help
ontology --version    # or -v
```

The CLI uses `no_args_is_help`, so any group invoked without a subcommand prints its help.

---

## Command Map

```
ontology
├── service   add · list · status · test · schema · connection · discover · approve · sync · map · remove
├── skill     list · import
├── catalog   list · show
├── config    init · show · set · llm · validate
├── sync      run · status · history · schedule · import
├── roles     list · show · validate · import
├── health    db · mcp · sync · storage   (bare `ontology health` runs all four)
├── doctor    (config, environment, drivers and connectivity in one report)
├── data      query · search · memory · stats
├── deploy    up · down · logs · restart · status
├── mcp       status · tools · toolsets · validate · build · test
└── platform  register · connect · attach · address
```

---

## End to end

### 1 · Discover a service — two ways

**A. Live database** — connect, verify read-only, introspect, analyze, provision:

```bash
ontology service add --from peoplesoft \
  --host psft-db.internal.edu --database CSPRD --user iblai_readonly
```

`--from <catalog-key>` prefills the connection shape (driver, port, env) from the [built-in catalog](#built-in-service-catalog). The pipeline runs a **read-only safety suite first** — seven write attempts that must all be denied — then introspects the schema and generates config.

**B. From a SKILL.md** — seed an API source with no live connection:

```bash
ontology service add --skill canvas      # register the API source from its SKILL.md
ontology skill import canvas             # only show what the skill declares
ontology skill list                      # every vendored skill
```

`service add --skill` registers the service and prints the skill's connection variables and read-only operations (suggested MCP tools). Its data is then read through a custom MCP server (`mcp-servers/`) that you point `MCP_<NAME>_URL` at.

### 2 · Interpret the schema & see the connection

```bash
ontology service schema peoplesoft        # discovered tables, by row count
ontology service connection peoplesoft     # stored connection (secrets redacted)
```

```text
$ ontology service schema peoplesoft
peoplesoft — oracle | 847 tables, 12,400,000 rows
            Top 20 tables
┏━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━┳━━━━━━━━━┓
┃ Schema ┃ Table              ┃ Rows      ┃ Columns ┃
┡━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━╇━━━━━━━━━┩
│ SYSADM │ PS_STDNT_CAR_TERM  │ 2,345,678 │ 24      │
│ SYSADM │ PS_STDNT_ENRL      │ 1,876,543 │ 31      │
└────────┴────────────────────┴───────────┴─────────┘
```

### 3 · Test it

```bash
ontology service test peoplesoft           # 7-test read-only safety suite
ontology mcp validate                       # tools.yaml is MCP Toolbox compliant
ontology mcp test get-student-enrollment --params '{"student_id":"001234567"}'
```

```text
$ ontology service test peoplesoft
  [PASS] CREATE TABLE blocked   [PASS] INSERT blocked   [PASS] UPDATE blocked
  [PASS] DELETE blocked   [PASS] DROP TABLE blocked   [PASS] ALTER blocked
  [PASS] TRUNCATE blocked
  All safety checks passed.   # credentials confirmed read-only
```

### 4 · Provision, sync, serve

```bash
ontology service approve peoplesoft         # cache schema, tools, sync schedules
ontology sync run peoplesoft                # pull → cache + text memories + vectors
ontology deploy up                          # bring up the stack (compose)
```

Then register iblai/ontology as an MCP server in your agent platform (see [platform-integration.md](../platform-integration.md)):

```bash
ontology platform register --url https://ontology.your-org.edu/mcp --auth-type none --role Executive  # the platform service token
ontology platform register --url https://ontology.your-org.edu/mcp                                   # per-user Entra ID OAuth
ontology platform connect  --server 14 --scope user --role FinancialAidCounselor --auth-type oauth2
ontology platform attach   <agent-id> --server 14
```

---

## Built-in service catalog

`ontology catalog list` shows the built-in defaults: for each system its connection shape, adapter, default toolset, sync cadences and the SKILL.md it comes from. Seed one with `ontology service add --from <key>`.

| Segment (`--domain`) | Examples | Skills from |
|---|---|---|
| `higher-ed` | PeopleSoft, Ellucian Banner, Canvas LMS, Slate CRM, Workday | [iblai/higher-education-agents](https://github.com/iblai/higher-education-agents) |
| `enterprise` | Snowflake, Salesforce, HubSpot, Twenty CRM, Jira | [iblai/enterprise-agents](https://github.com/iblai/enterprise-agents) |
| `k-12` | PowerSchool SIS, Google Classroom, Khan Academy | [iblai/k-12-agents](https://github.com/iblai/k-12-agents) |
| `government` | SAM.gov, USAspending.gov, Federal Register | [iblai/government-agents](https://github.com/iblai/government-agents) |
| `legal` | Clio, Westlaw Edge, PACER | [iblai/legal-agents](https://github.com/iblai/legal-agents) |
| `financial-services` | Bloomberg Terminal, FactSet, Workiva | [iblai/financial-services-agents](https://github.com/iblai/financial-services-agents) |
| `medical-healthcare` | Epic (FHIR), Oracle Cerner (FHIR), PubMed | [iblai/medical-healthcare-agents](https://github.com/iblai/medical-healthcare-agents) |

Two entries are databases (`peoplesoft`, `snowflake`); the rest are API systems, each seeded from a SKILL.md vendored under `src/iblai_ontology/catalog/skills/`. An API system is synced through a custom MCP server, and `mcp-servers/` ships five: Canvas, Slate, Navigate, LDAP and Twenty. Twenty's cloud is the `twenty` entry; a self-hosted one is a `generic-postgres` database ([DEV.md](../../DEV.md#a-crm-source-twenty)).

```bash
ontology catalog show snowflake     # connection shape, env, default toolset, cadences, skill
```

---

## Utilities

```bash
ontology doctor          # diagnostics: config validity, drivers, per-service env, Entra
ontology health          # PostgreSQL cache, MCP servers, sync engine, text-memory storage
ontology catalog list    # built-in service defaults (--domain <segment>)
ontology mcp validate    # tools.yaml: every type, source and toolset member resolves
```

---

## `ontology service` — source-system integrations (Components 5 & 6)

| Command | What it does | Key args / options |
|---|---|---|
| `add` | Full discovery → safety → introspect → (LLM) → provision pipeline. | Prompts: `--name`, `--service-type`, `--host`, `--port`, `--database`, `--user`, `--password`. Flags: `--llm-discover/--no-llm-discover` (default on), `--skip-safety` (not recommended), `--option KEY=VALUE` (repeatable; engine fields such as `warehouse`, `schema`, `http_scheme` for the auto-ontology connectors). |
| `list` | List all integrated services with status. | — |
| `status <name>` | Connectivity + read-only verified + latency for one service. | `name` (arg) |
| `test <name>` | Run the 7-test read-only safety suite; exits non-zero on failure. | `name` (arg) |
| `discover <name>` | Re-run schema discovery on an existing service. | `name` (arg); `--llm/--no-llm` (default on) |
| `approve <name>` | Approve generated config and provision the service. | `name` (arg) |
| `sync <name>` | Trigger a manual sync for one service. | `name` (arg) |
| `remove <name>` | Teardown — drop cache tables and remove config. | `name` (arg); `--yes` to skip the prompt |

`--service-type` accepts: `peoplesoft`, `banner`, `workday`, `canvas`, `slate`, `navigate`, `generic-oracle`, `generic-postgres`, `generic-mysql`, `generic-mssql`, `snowflake`, `generic-trino`, `generic-clickhouse` (the last three need the `auto-ontology` extra).

```bash
ontology service add        # interactive: prompts for everything
ontology service add --name peoplesoft-main --service-type peoplesoft \
  --host psft-db.internal.alasu.edu --port 1521 --database CSPRD --user iblai_readonly
ontology service test peoplesoft-main
ontology service discover peoplesoft-main --no-llm
ontology service approve peoplesoft-main
ontology service list
ontology service remove peoplesoft-main --yes
```

See [Component 5](05-service-discovery.md) and [Component 6](06-provisioning.md) for the full flow.

---

## `ontology config` — configuration management

| Command | What it does | Key args / options |
|---|---|---|
| `init [dir]` | Initialize a deployment: dirs, default config files, compose. | `directory` (arg, default `.`); `--with-samples/--no-with-samples` (default on) |
| `show [section]` | Display current config, redacting secrets. | `section` (optional arg) |
| `set <key> <value>` | Set a config value via dot-notation. | `key`, `value` (args) |
| `llm` | Configure the BYOK LLM provider + key. | Prompts: `--provider` (`anthropic`/`openai`), `--api-key`; `--model` optional override |
| `validate` | Validate all config files; exits non-zero on error. With `ONTOLOGY_DATA_STORE=dm` it leaves `roles.yaml` and `sync-schedules.yaml` out: both are kept in the ibl.ai platform, and `ontology roles validate` checks the roles there. | — |

```bash
ontology config init /opt/iblai-ontology
ontology config show llm
ontology config set llm.provider anthropic
ontology config set llm.model claude-opus-4-8
ontology config llm                       # prompts for provider + key
ontology config validate
```

Default LLM models (BYOK): `anthropic` → `claude-opus-4-8`, `openai` → `gpt-4o`. Example `validate` output:

```
[OK]  config/tools.yaml: 24 tools, 4 toolsets
[OK]  config/sync-schedules.yaml: 8 schedules
[OK]  config/roles.yaml: 7 roles defined
[ERR] config/roles.yaml: role 'Registrar' references toolset 'course-tools' which does not exist
```

---

## `ontology sync` — sync operations (Component 2)

| Command | What it does | Key args / options |
|---|---|---|
| `run [service]` | Run syncs now. Omit `service` to run all *due* syncs. | `service` (optional arg); `--schedule <name>`; `--full` (force full refresh) |
| `status` | Latest run per schedule (schedule, service, status, last run, duration, records). | — |
| `history [service]` | Sync run history. | `service` (optional arg); `--limit` (default 20) |
| `schedule` | Show configured schedules from `sync-schedules.yaml`, or from the ibl.ai platform with `ONTOLOGY_DATA_STORE=dm`. | — |
| `import [path]` | Copy a `sync-schedules.yaml` into the ibl.ai platform, as written; prints each name. `dm` only. | `path` (optional arg; default: the config directory's file) |

```bash
ontology sync run
ontology sync run peoplesoft-main --schedule student-holds-delta
ontology sync run peoplesoft-main --full
ontology sync status
ontology sync history peoplesoft-main --limit 50
ontology sync schedule
```

---

## `ontology roles` — role & permission management (Component 3)

| Command | What it does | Key args / options |
|---|---|---|
| `list` | List roles from `roles.yaml`, or from the ibl.ai platform with `ONTOLOGY_DATA_STORE=dm` (name, display name, toolsets, memory-path count, cache tables). | — |
| `show <role>` | Full YAML for one role; exits non-zero if not found. | `role` (arg) |
| `validate` | Check that each role's toolsets exist in `tools.yaml`: the roles of `roles.yaml`, or the ibl.ai platform's with `ONTOLOGY_DATA_STORE=dm`. | — |
| `import <path>` | Copy a `roles.yaml` into the ibl.ai platform's roles; prints each name, and a role the platform cannot keep with the reason (then exits non-zero). `dm` only. | `path` (arg, required: no file is read by default) |

```bash
ontology roles list
ontology roles show FinancialAidCounselor
ontology roles validate
```

See [identity.md](../identity.md) for the `roles.yaml` format, and
[DEV.md](../../DEV.md#roles-in-the-platform) for how a role is kept in the ibl.ai platform.

---

## `ontology health` — health checks & diagnostics

Running `ontology health` with no subcommand runs **all four** checks (`db`, `mcp`, `sync`, `storage`).

| Command | What it reports |
|---|---|
| `health` (bare) | Runs db + mcp + sync + storage in sequence. |
| `db` | PostgreSQL cache: healthy?, table count, total rows, size, active connections. |
| `mcp` | Each MCP server: reachable?, latency, tool count. |
| `sync` | Sync engine running?, total schedules, failures in last 24h, next due. |
| `storage` | Text-memory disk usage: total files/size, then per-domain breakdown. |

```bash
ontology health          # everything
ontology health db
ontology health sync
```

```
$ ontology health
PostgreSQL: OK
  Tables: 18 | Rows: 42,531
  Size: 128.4 MB | Connections: 3
  mcp-toolbox: OK (12ms, 24 tools)
  mcp-canvas: OK (45ms, 6 tools)
Sync engine: RUNNING
  Schedules: 8 | Failed (last 24h): 1
  Next due: student-holds-delta at 2026-06-20 09:35:00
Text memories: 5,142 files, 234.7 MB
  /ontology/students/: 4,287 files, 189.2 MB
```

---

## `ontology data` — query, search, inspect

| Command | What it does | Key args / options |
|---|---|---|
| `query <sql>` | Run a **read-only** query against the cache (only `SELECT` accepted). | `sql` (arg); `--format` (`table`/`json`/`csv`, default `table`); `--limit` (default 100) |
| `search <term>` | Semantic search across text memories (vector index). | `term` (arg); `--domain`; `--limit` (default 10) |
| `memory <path>` | Print a text memory file (`.md` appended if omitted). Honors `ONTOLOGY_FILES_ROOT` (default `/ontology`). | `path` (arg) |
| `stats` | Memory store + cache size at a glance. | — |

```bash
ontology data query "SELECT classification, COUNT(*) AS n FROM students GROUP BY classification"
ontology data query "SELECT * FROM at_risk_students" --format json --limit 50
ontology data search "students struggling with math" --domain students
ontology data memory students/by-id/001234567
ontology data stats
```

---

## `ontology deploy` — Docker Compose lifecycle

| Command | What it does | Key args / options |
|---|---|---|
| `up` | `docker compose up`. | `-d/--no-detach` (detach default on); `--build` |
| `down` | `docker compose down`. | `--volumes` to remove volumes |
| `logs [service]` | View logs. | `service` (optional arg); `-f` follow; `--tail` (default 100) |
| `restart [service]` | Restart all or one service. | `service` (optional arg) |
| `status` | Container status (`docker compose ps`). | — |

```bash
ontology deploy up --build
ontology deploy status
ontology deploy logs sync-engine -f --tail 20
ontology deploy down --volumes
```

See [deployment.md](../deployment.md) for the stack itself.

---

## `ontology mcp` — MCP server administration (Component 4)

| Command | What it does | Key args / options |
|---|---|---|
| `status` | Outbound gateway: running?, URL, tool/toolset counts, active sessions. | — |
| `tools` | List all exposed MCP tools (name, type, source, description). | — |
| `toolsets` | List toolsets and their member tools; one whose tools change data is marked `(writes)`. | — |
| `test <tool>` | Invoke a tool and print the JSON result. A tool that changes data is refused: it runs only through the gateway, which records the call. | `tool` (arg); `--params '<json>'` |

```bash
ontology mcp status
ontology mcp tools
ontology mcp toolsets
ontology mcp test get-student-enrollment --params '{"student_id": "001234567"}'
```

---

## Notes on Implementation

- **Lazy backend import.** Commands that touch live services import `iblai_ontology.backend` and call `bootstrap()` only when invoked, keeping the base install light and the config-only commands fast and dependency-free.
- **Read-only at the client layer too.** `ontology data query` rejects any statement that is not a `SELECT` before it ever reaches the database — defense in depth on top of the read-only DB user.
- **Self-documenting.** Every command and option carries help text; `ontology <group> --help` and `ontology <group> <cmd> --help` are authoritative.

---

## Related

- Every other component is operated through this CLI — start at the [architecture overview](../architecture.md).
