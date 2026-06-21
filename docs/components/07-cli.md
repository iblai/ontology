# Component 7 — CLI (`ontology`)

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

A comprehensive command-line interface for every management operation: service integration, configuration, sync, permissions, health, data inspection, deployment lifecycle, and MCP administration. Built with **`typer`** (and `rich` for output), installed as a single self-documenting `ontology` command.

- **Distribution:** `iblai-ontology` · **Import package:** `iblai_ontology` · **Command:** `ontology`
- The CLI and config layer are **Django-free**, so `ontology config init`, `ontology config *`, `ontology roles *`, `ontology sync schedule`, `ontology mcp tools/toolsets`, and `ontology data memory` all work on a fresh checkout. Commands that need long-running backend services call `bootstrap()` lazily and require the Django extra.

### Installation

```bash
pip install iblai-ontology
# or, developing this repo:
pip install -e ".[dev]"
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
├── service   add · list · status · test · discover · approve · sync · remove
├── config    init · show · set · llm · validate
├── sync      run · status · history · schedule
├── roles     list · show · validate
├── health    db · mcp · sync · storage   (bare `ontology health` runs all four)
├── data      query · search · memory · stats
├── deploy    up · down · logs · restart · status
└── mcp       status · tools · toolsets · test
```

---

## `ontology service` — source-system integrations (Components 5 & 6)

| Command | What it does | Key args / options |
|---|---|---|
| `add` | Full discovery → safety → introspect → (LLM) → provision pipeline. | Prompts: `--name`, `--service-type`, `--host`, `--port`, `--database`, `--user`, `--password`. Flags: `--llm-discover/--no-llm-discover` (default on), `--skip-safety` (not recommended). |
| `list` | List all integrated services with status. | — |
| `status <name>` | Connectivity + read-only verified + latency for one service. | `name` (arg) |
| `test <name>` | Run the 7-test read-only safety suite; exits non-zero on failure. | `name` (arg) |
| `discover <name>` | Re-run schema discovery on an existing service. | `name` (arg); `--llm/--no-llm` (default on) |
| `approve <name>` | Approve generated config and provision the service. | `name` (arg) |
| `sync <name>` | Trigger a manual sync for one service. | `name` (arg) |
| `remove <name>` | Teardown — drop cache tables and remove config. | `name` (arg); `--yes` to skip the prompt |

`--service-type` accepts: `peoplesoft`, `banner`, `workday`, `canvas`, `slate`, `navigate`, `generic-oracle`, `generic-postgres`, `generic-mysql`, `generic-mssql`.

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
| `validate` | Validate all config files; exits non-zero on error. | — |

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
| `schedule` | Show configured schedules from `sync-schedules.yaml`. | — |

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
| `list` | List roles from `roles.yaml` (name, display name, toolsets, memory-path count, cache tables). | — |
| `show <role>` | Full YAML for one role; exits non-zero if not found. | `role` (arg) |
| `validate` | Validate `roles.yaml` against available toolsets and memory paths. | — |

```bash
ontology roles list
ontology roles show FinancialAidCounselor
ontology roles validate
```

See [identity.md](../identity.md) for the `roles.yaml` format.

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
| `toolsets` | List toolsets and their member tools. | — |
| `test <tool>` | Invoke a tool and print the JSON result. | `tool` (arg); `--params '<json>'` |

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
