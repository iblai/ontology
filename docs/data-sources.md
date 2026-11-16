# Where every piece of data comes from

Audit date: 2026-11-14. Scope: everything dynamic the console renders.

## The rule

This Next.js app has **no database**. Like the OS app, it keeps nothing of its own. Every value on
screen comes from one of three systems of record, and nothing else:

| Tag     | System               | Where it lives                                                                                            | How the browser reaches it                                                                                              |
| ------- | -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **IBL** | ibl.ai platform API  | ibl.ai                                                                                                    | Directly from the browser with the SSO session (`axd_token` / `dm_token` from login.ibl.ai), exactly as os.ibl.ai does. |
| **AO**  | NVIDIA auto-ontology | Its own Postgres + pgvector on the ontology host; REST on :3000/`/api` (x-api-key) and ingestion on :3002 | Through this app's route handlers on the host (see "Reaching the host").                                                |
| **TB**  | Google MCP Toolbox   | `tools.yaml` + a flags file per server on the host filesystem; the running process (`/mcp`, stdout)       | Through this app's route handlers on the host.                                                                          |

If something was not available from one of these, it was removed from the UI or replaced with the
closest ibl.ai equivalent. The removals are listed at the end.

## Screen by screen

### Shell

| Element                                                             | Source  | Detail                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo, header, sidebar                                               | static  | ibl.ai brand assets.                                                                                                                                                                          |
| Organization ("Institution") selector                               | IBL     | user's tenants; display label in `GET/PUT /api/core/orgs/{org}/metadata/` under `metadata.apps.ontology`.                                                                                     |
| User / Admin switch, avatar                                         | IBL     | session + RBAC (admin mode as in the OS).                                                                                                                                                     |
| Notifications, Invites, Management, API, Secrets, Advanced, Support | IBL     | the OS's own pages (`/api/notification/v1/…`, invites, `/api/core/platform/api-tokens/`, `/api/ai-account/orgs/{org}/integration-credential/`).                                               |
| Sidebar counts                                                      | AO / TB | systems = `GET /api/connections`; catalog = `GET /api/tables/*`; ontology = `GET /api/terms`; MCP gateway = tool count across `tools.yaml` files; agents = IBL agents with a server attached. |

### Dashboard

| Element                | Source                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Systems connected      | AO `GET /api/connections`                                                                                                          |
| Object types certified | AO `GET /api/terms` (`name_certified`, `description_certified`, `certification`)                                                   |
| Tools published        | TB count of `tools:` across server configs                                                                                         |
| Agent tool calls · 24h | IBL `GET /api/analytics/llm-usage/?resource=observations` (`tool_calls[]`) filtered to this server's tool names                    |
| Activity               | union of AO term `modified`/`modified_by`, TB config revisions (file history), IBL `mentors/audit-logs/`                           |
| MCP server cards       | IBL `GET …/mcp-servers/` (name, url, transport, auth_type, auth_scope, is_enabled) joined with TB config revision + process health |

### Systems (step 1)

| Element              | Source                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Connected databases  | AO `GET /api/connections` (database_name, engine from the URL scheme)                                                                   |
| Table / PII counts   | AO `GET /api/tables/{schema_id}`, column `tags` (the PII detector tags columns; sample values are masked)                               |
| Ingest status        | AO ingestion `GET /semantic/status` + `GET /api/semantic-compilation/status`                                                            |
| HTTP API systems     | TB `http` sources in `tools.yaml` (serve only; never dissected)                                                                         |
| Catalog of kinds     | static: the intersection of AO engines and TB source kinds                                                                              |
| Add database · test  | AO `POST /api/connections/test`, then `POST /api/connections` + ingestion `POST /ingest`                                                |
| Dissection options   | AO `PUT /api/configurations/pii-detection`, `…/distinct-value-probing`                                                                  |
| Database credentials | entered once; stored by AO (its connection store / Vault) and written as env for TB on the host. Never in the browser, never on ibl.ai. |

### Map (step 2)

| Element                                                                           | Source                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline stages + log                                                             | AO ingestion `/ingest` (202), `/semantic/compile` (202), `/semantic/status` (running, last_success_at, last_failure_at); log lines are the ingestion service log on the host |
| Tables, foreign keys, system clusters                                             | AO `GET /api/exploration/data-graph` (DataGraphNode, GraphLink)                                                                                                              |
| Terms, term↔table mapping, term↔term links                                        | AO `GET /api/exploration/semantic-graph` (SemanticGraphNode: synonyms, zones, counts)                                                                                        |
| Table detail (rows, columns, joins, terms)                                        | AO `GET /api/exploration/table/{id}/details`, `GET /api/table/{id}/columns`                                                                                                  |
| Term detail (description, synonyms, mapped tables, SQL attributes, certification) | AO `GET /api/term/{id}`, `GET /api/exploration/term/{id}/details`, `GET /api/sql-attributes?term_id=`                                                                        |
| "Same student, three systems" banner                                              | AO TermDetail.tables spanning several `database_name`s (a fact, not a match score)                                                                                           |
| Certify                                                                           | AO `PATCH /api/term/{id}` (`name_certified`, `description_certified`)                                                                                                        |

### Ontology (step 3)

| Element                             | Source                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Object types                        | AO terms                                                                                                   |
| Properties (backing column, status) | AO term → tables → columns; `ColumnAttribute`s for derived columns                                         |
| PII flag                            | AO column `tags`                                                                                           |
| Link types                          | AO relationships (`GraphLink.relationship_types`, `semantic-link-path`)                                    |
| Metrics                             | AO `GET /api/sql-attributes` (`expression`, `certified`)                                                   |
| Tags                                | AO `GET /api/tags` + `/api/tags/{id}/targets`                                                              |
| Actions (write tools)               | TB: tools in `tools.yaml` that write (`postgres-execute-sql`, `http` POST), placed in a write-only toolset |

### MCP Gateway · new server (step 4)

| Element                      | Source                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Server name, endpoint        | TB directory `servers/{slug}/`; IBL `POST …/mcp-servers/` on deploy                                                           |
| Toolsets and tools           | TB `tools.yaml` (`tools:`, `toolsets:`) generated from certified AO terms + SQL attributes                                    |
| ibl.ai platform tokens       | IBL `POST /api/core/platform/api-tokens/` (name, policies, groups; secret shown once). Verified by the gateway on every call. |
| Entra / Google / custom OIDC | TB `authServices:` in `tools.yaml`, verified natively by the runtime; claim binding via `parameters[].authServices`           |
| Allowed origins / hosts      | TB `--allowed-origins`, `--allowed-hosts` in the server's flags file                                                          |
| Generated config preview     | TB the file itself                                                                                                            |

### MCP Gateway · server (step 5)

| Element                                  | Source                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Enabled / revision                       | IBL MCPServer `is_enabled`; TB config revision                                                               |
| Agent tool calls · 24h, most called tool | IBL analytics `tool_calls`                                                                                   |
| Agents attached                          | IBL agents whose `settings` include this server + `…/mcp-server-connections/`                                |
| Connect: attach to agent                 | IBL `PUT …/mentors/{mentor}/settings/` and `POST …/mcp-server-connections/`                                  |
| Playground                               | this app's gateway → TB `/mcp` (and AO `ask_question` for natural language) with the caller's ibl.ai session |
| Activity: agent tool calls               | IBL analytics observations                                                                                   |
| Activity: runtime log                    | TB process stdout on the host                                                                                |
| Tokens                                   | IBL api-tokens list (name, policies, groups, created, expires)                                               |

### Agents, Roles, Access, Config, Compilation

| Screen                   | Source                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Agents                   | IBL agents + MCP server connections (`auth_type`, `scope`), analytics for call counts     |
| Roles                    | IBL RBAC `GET /api/core/rbac/policies/` — policy name ↔ toolset name is the whole mapping |
| Access                   | IBL RBAC groups/users per policy + MCP server connections                                 |
| Config                   | TB files on the host; AO `GET /api/model/export`                                          |
| Compilation (was "Sync") | AO `/api/semantic-compilation/status`, `/api/configurations/*`; TB config reload          |

## Reaching the host from the browser

The browser talks to two places:

1. **ibl.ai**, directly, with the SSO session. Same as the OS app. Nothing new.
2. **The ontology host**, through this app's own route handlers (`app/api/host/*`), deployed on
   that host next to auto-ontology and the Toolbox processes, behind the same TLS proxy.

The route handlers are a **stateless window**, not a backend:

- Every request carries the ibl.ai session token (`Authorization: Token <dm_token>`, the same
  header the OS sends to `…/dm/api/…`). The handler verifies it with ibl.ai and checks the admin
  role. No session store of its own. Details in [auth.md](auth.md).
- `/api/host/ao/*` forwards to auto-ontology on the private network with the host's service
  `x-api-key`. auto-ontology keeps the data.
- `/api/host/servers/*` reads and writes `servers/{slug}/tools.yaml` and `servers/{slug}/flags`,
  and starts, stops or restarts the Toolbox process for that slug. Toolbox reloads `tools.yaml`
  on its own; origin and host flags need a restart. The filesystem keeps the data.
- `/api/host/servers/{slug}/log` tails the process stdout.

Agent traffic uses a second, equally thin path:

- `https://<host>/<slug>/mcp` is the same route-handler layer acting as the **gateway**. It checks
  `Origin` against the server's flags, verifies the `Api-Token` (platform token) or `Token`
  (session) with ibl.ai, maps the caller's RBAC policy to a toolset, and forwards to Toolbox at
  `127.0.0.1:<port>/mcp/<toolset>`. It writes nothing.
- OIDC clients (Entra, Google) can reach Toolbox through the TLS proxy without the gateway, since
  Toolbox verifies those tokens itself.
- When an ibl.ai agent calls the server, ibl.ai attaches the credentials from its
  `MCPServerConnection`; the gateway sees an ordinary platform token.

A smaller variant is possible later: auto-ontology supports OIDC SSO providers and per-connection
SSO federation, so if ibl.ai is registered as its SSO provider the browser could call auto-ontology
directly and the host layer shrinks to the server files and the gateway.

## Removed or replaced in this pass

| Was                                                             | Problem                                                     | Now                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Multiple "ontologies" (Institution, LMS Analytics, Advancement) | no system of record; AO is one semantic layer per host      | one ontology per ibl.ai organization; AO zones can subdivide later            |
| DuckDB snapshot of HTTP APIs so they could be dissected         | neither AO nor TB does this                                 | APIs are served only (TB `http`); the CRM example is now a Postgres database  |
| "7 write operations must fail" read-only proof                  | an iblai/ontology backend feature, not AO/TB/IBL            | AO connection test; hint to use a read-only login                             |
| 97.8% cross-system match score, "accept merge"                  | fabricated; AO maps terms to tables, it does not score      | the fact of a term spanning N databases; certify the term                     |
| Interfaces (Person, Billable)                                   | not in AO                                                   | AO tags                                                                       |
| Request log with origin, latency, status per call               | TB keeps no request store                                   | IBL analytics `tool_calls` for agent traffic + TB stdout tail for the runtime |
| p50 latency, authorized %                                       | TB telemetry only, no store                                 | removed                                                                       |
| Key prefix, last used, calls per key                            | not in IBL api-tokens                                       | name, policies, groups, created, expires                                      |
| Rate limit per key                                              | not in TB or IBL for MCP                                    | removed (ibl.ai spend caps apply to agents)                                   |
| "Claude Desktop · OIDC" row under Agents                        | not an IBL agent                                            | removed; external clients show only in the runtime log                        |
| roles.yaml, sync-schedules.yaml                                 | iblai/ontology artifacts                                    | IBL RBAC policies; AO compilation settings                                    |
| Masked emails in playground rows                                | masking was attributed to a role policy that does not exist | rows as returned by the tool                                                  |
