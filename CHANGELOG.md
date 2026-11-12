# Changelog

All notable changes to iblai-ontology are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `docs/install.md`: the one-command install for a platform's administrator, step by step: what
  to have ready, what the script asks and prints, the console's steps before and after, every
  setting in `.env`, what runs, where things are kept, day-to-day commands and what each message
  the script stops with means. With screenshots of adding a system and connecting an agent.
- The gateway's `read-memory` answers a folder's path with its listing, so an agent can look
  around: `/ontology` shows the folders its role reaches, and a folder the first 200 names in it.
  A folder that holds nothing the role may read is refused as a file would be.

### Changed
- The Ontology Frontend carries the favicon the ibl.ai SIS and CRM use (`app/favicon.ico`).
- **Connect a backend** asks for the server's host name alone and takes the backend's address to
  be `https://<host name>`; an address that differs goes under Advanced. Where the console has no
  address for a platform, it now says "ibl.ai Ontology does not know this platform's backend
  yet". The install script ends by naming the host name to enter, not an address to paste. The
  card now fills the page's width, which leaves room for the install command. A console run in
  development also takes `localhost` (or `127.0.0.1`, `[::1]`, with a port or a local backend's
  8000) as the host name, for a backend on the same machine; a deployed one never does.
- The install script takes the platform's address to be `https://api.iblai.app/dm` and no longer
  asks for it; `--platform-url` names another. The install command the console shows, and the
  ones in the docs, carry the option only for another address.
- The docs name the hosted console's address as `ontology.ibl.ai`, available soon.

### Fixed
- A system's page said "Never synced", 0 tables and 0 rows after every sync: nothing wrote those
  onto the system. Each schedule run now does, from the newest finished run of each of the
  system's schedules.
- The Dashboard of a fresh backend called its empty memory store "Degraded", printed "1 running"
  for a sync engine that was merely up, and "Next due: - at -" when nothing was due.
- On a backend that keeps its roles in a file, the Connect an agent dialog's refusal read as if
  an agent were connected. It now says no agent can be connected yet, and why.

## [0.2.13] - 2026-11-13

### Changed
- Where browsers keep the backend's address (`ONTOLOGY_BACKEND_STORE=browser`), the hosted
  Ontology Frontend's server no longer calls the ibl.ai platform, whose edge refuses calls that
  come from a hosting network. "Create key" is asked of the platform by the browser itself, so
  the frontend's server never holds the key and `POST /api/hosted/backend/key` is gone. A named
  address is used once it answers `GET /counts` as a backend that takes the caller's sign-in;
  the platform is no longer asked about the sign-in first.
- `deploy/install.sh` tells a refusal by the platform's edge from the platform's own: a 403
  without the platform's `detail` stops it saying this server's network is not let through.

### Fixed
- The release workflow builds the image as one plain manifest (`--provenance=false`). On the
  first push of 0.2.12, ghcr.io took the attestation and refused the image beside it, which left
  that release without its image, `install.sh` and `compose.yaml`: install from 0.2.13.

## [0.2.12] - 2026-11-13

### Added
- One command installs a backend on a fresh Ubuntu server (22.04 or later, amd64):
  `deploy/install.sh`, attached to every release. It uses the Docker that is there or installs
  `docker.io` and `docker-compose-v2` from Ubuntu's own archive, asks for the platform, its
  address, the host name and, hidden, the backend's platform key. Before anything is written it
  asks the platform two things with that key: whether its administrators can grant ontology
  roles (a refused key, RBAC switched off or a platform without the custom namespace stops it,
  with the platform's words), and whether the platform keeps ontology records, which decides
  where the settings live (`ONTOLOGY_DATA_STORE=dm`, or `rbac` on this server). It writes
  `/opt/iblai-ontology/.env` (mode 600, that choice and four generated secrets) beside the
  release's `compose.yaml`, starts the stack and waits for `https://<host>/mcp` to answer 405.
  Run again it upgrades and keeps the choice; `--uninstall` removes it; `--dry-run` says what
  would happen.
- `deploy/compose.yaml`, the server stack: PostgreSQL, Redis, ChromaDB, a migration that runs
  before the gateway and the worker, the gateway, the sync worker and Caddy
  (`caddy reverse-proxy`, ports 80 and 443). Settings come from one `.env`; a missing one stops
  compose with its name. It runs no MCP Toolbox and no connector container. The image carries a
  neutral starting config (`deploy/config/`) that fills a new config volume.
- One image, `ghcr.io/iblai/ontology:<version>`, built from the root `Dockerfile` by
  `.github/workflows/release.yml` when a release is published. The workflow refuses a tag that
  is not `v` plus the version in `pyproject.toml`, and stamps the version into `install.sh` and
  `compose.yaml` before attaching them.
- **Connect a backend** on the hosted Ontology Frontend: a platform without a backend lands on
  one screen with the install command filled in, a button that makes the backend's platform key
  (shown once) and a field for the backend's address. Connect takes a public `https` address
  that answers `GET /counts` with the admin's own token, and keeps it in the platform with
  `iblai-org` set to the backend's platform, so an address that is another platform's backend is
  refused there. A **Backend** page (hosted console only) shows the address and replaces it.
  `GET /counts` gains `platform`.
- `ONTOLOGY_BACKEND_STORE=browser` on the hosted Ontology Frontend, for platforms that keep no
  ontology records yet: Connect makes the same checks and writes nothing, the administrator's
  browser keeps the address (`localStorage`, per platform) and names it on every call, and the
  frontend uses a named address once the platform knows the sign-in and the address answers
  `GET /counts` as a backend that takes it, kept a minute per sign-in and address. Each browser
  connects once; the gate says "This browser does not know this platform's backend yet".
- `ONTOLOGY_DATA_STORE=rbac`, for a platform that keeps no ontology records: the roles are the
  platform's RBAC roles as in `dm`, so a credential still carries its role and an agent is still
  connected with a key limited to one, while the registry, the schedules, a role's display name
  and limits, the example-roles mark and the agent connections stay on this host (a small table,
  `services.Record`, holds what has no model). The backend makes no call to the platform's
  ontology records in this mode. `GET /counts` names the store, and `ontology platform address`
  refuses outside `dm`.
- Connecting Twenty CRM gives the role of the system's name what the system brings: its tables,
  their memory folders and the toolset of its operations. A role of that name is made when there
  is none and added to when there is one; a role the platform refuses leaves the system
  connected and is said in the answer. Removing the system takes back what it gave, and a role
  left reaching nothing goes with it. **Connect an agent** offers first the first role that can
  change data.
- `frontend/.vercelignore` and `frontend/vercel.json`, so a deploy from a checkout uploads no
  local settings, test sessions or second build directories.
- **Add a system** is one page: a searchable list of what connects from the console (Twenty CRM
  and the nine database engines), then that system's own fields. A port takes digits only, a
  password is never autofilled, and for PostgreSQL and MySQL the database is picked from the
  list the login may open (`POST /services/databases`), with the server's own words under the
  field when it refuses. The Catalog page marks each of its 72 entries "Connects from here" or
  "No connector yet".
- Twenty CRM connects from the console with its address and an API key, on Twenty's cloud or
  self-hosted. The backend reads it itself (`backend/services/twenty.py`), so there is no
  connector container and no environment variable. Connect checks the key, approves the system
  and queues the first sync. A self-hosted Twenty's database is still a `generic-postgres`
  service; both paths share one mapping onto the house tables.
- Twenty's operations: connecting it adds the toolset `<system>-writes` (`write: true`) with ten
  tools of the new type `twenty`, create and update for people, companies, opportunities, notes
  and tasks, generated from the catalog's new `writes`. The gateway runs them itself, after the
  audit row: unknown or mistyped fields are refused, a note or a task is linked to the person,
  organization or deal it names, Twenty's refusal comes back as the tool's error, and the answer
  is the record in house column names. The changed record is handed to the worker, which
  refreshes the cache row and the memory file. No tool deletes.
- `describe-ontology-cache`: the gateway's own tool that lists the cache tables a role may
  query, each with its columns.
- **Agents** page and `GET /agents`, `GET|POST /agent-connections`,
  `DELETE /agent-connections/<name>` (roles kept in the platform: `rbac` or `dm`): pick an agent
  and a role, and the backend
  makes a platform API key limited to that role's policy (with the admin's own sign-in),
  registers the gateway as an MCP server of that agent alone with the key as its credential,
  switches the agent's MCP tool on and keeps the record `agent_connection/<name>` (never the
  key). A step that fails takes back the ones before it; removing deletes the key first.
- Twenty CRM as a source, both ways: a self-hosted Twenty is a `generic-postgres` service (one
  PostgreSQL schema per workspace, read with a role granted on the CRM tables only); a workspace
  on Twenty's cloud, or a self-hosted one over REST, is the new `twenty` catalog entry (paging
  `/rest/<plural>`, composite fields flattened to Twenty's own column names so both paths share
  one mapping).
- Catalog entries carry a vendor `mapping` (workspace table, house entity and column renames
  per synced object): API schedules are generated from it, and `ontology service map <name>
  --from <key>` applies it to a discovered database without an LLM call. The house model
  (`sql/schema.sql`) gains the platform CRM's vocabulary: `organizations`, `persons`, `deals`.
- The cache DDL maps PostgreSQL source types (`uuid`, `numeric`, `jsonb`, `timestamp with time
  zone`, enums) instead of landing every column as TEXT.
- Relationship graph: `GET /graph` turns the registry and config into one typed graph
  (services, tables, columns, entity groups, MCP sources/tools/toolsets, roles, schedules,
  memory domains; foreign keys, SQL table references, grants, memory and cache reach, sync
  flows) with dangling-reference stubs and orphan health, and `GET /graph/records` expands a
  memory domain into its records linked by foreign-key values. The console's new **Semantic map**
  page draws it Obsidian-style on a force layout, focuses a role to show what it reaches,
  and toggles toolset, memory-domain and cache-table grants in place (`*` becomes an
  explicit list on the first revoke). `seed_example_data` adds foreign keys and, when
  `ONTOLOGY_FILES_ROOT` is set, a small synthetic memory vault.
- `PATCH /services/<name>/tables` edits a discovered table's entity group and description;
  edits are recorded as `overrides` on the stored analysis and survive a rediscovery.
- Console editors with their write endpoints: roles (`PUT|DELETE /roles/<name>`, a new
  Roles page), sync schedules (`PUT|DELETE /sync/schedules/<name>`, enable/disable and
  edit from the Sync page), MCP tools, toolsets and sources (`PUT|DELETE
  /mcp/{tools,toolsets,sources}/<name>`) and a raw `tools.yaml` editor
  (`GET|PUT /mcp/config`) that validates against the Toolbox schema before writing and
  refuses literal secrets on sources (`${VAR}` references only). Every write is audited.
- `seed_example_data` stores a few columns per table and a discovery-shaped analysis, so
  a demo backend shows entity groups in the catalog and the graph.
- `auto-ontology` extra: NVIDIA's [auto-ontology](https://github.com/NVIDIA/auto-ontology)
  connectors (tracking `main`, the commit pinned in `uv.lock`) back three new database
  sources — `snowflake`, `generic-trino`, `generic-clickhouse` — through the same read-only
  safety suite, introspection and generated config as the DB-API drivers. `ontology service add
  --option KEY=VALUE` (and `options` on `POST /services`) carries engine fields such as
  `warehouse`, `schema` and `http_scheme`. Databricks and DuckDB connectors are not
  exposed: MCP Toolbox 1.5.0 has no kind to serve them.
- `ONTOLOGY_CREDENTIAL_KEY_FILE`: the registry's Fernet key can come from a file instead of
  the environment. `docker-compose.yml` mounts `secrets/ontology_credential_key` into the
  gateway as a Compose secret — the only container that decrypts the registry, and one that
  received no key at all before. `ontology doctor` reports whether a key is configured.
- Platform store: `ONTOLOGY_DATA_STORE=dm` keeps the ontology's roles, sync schedules and
  service registry in the ibl.ai platform instead of on this host; `local`, the default, is
  unchanged. Roles become the platform's own RBAC roles: a role's grants are the resources of
  its one policy, `Ontology: <role>`, under the platform's client namespace `/custom/ontology/`
  (toolsets, cache tables, memory folders and files, the console, every subject), judged by the
  `Ontology/…` verbs the role holds, and its display name, agents and limits are an ontology
  record. Sync schedules and the registry (services and their discovered tables, health checks,
  safety reports, provisioning runs and steps) become ontology records too. Sync runs, the audit
  log, the student-data cache, memory files, vector index and identity map stay on this host,
  and the platform holds connection credentials only as Fernet ciphertext.
  `roles.yaml` is never read in `dm`: a platform with no ontology role gets the four example
  roles at its first console sign-in, once, and `ontology roles import <file>` copies a named
  file's roles in; `ontology sync import` copies the schedules. A role that a resource cannot
  spell is refused with the reason. A backend process keeps the roles it read for
  `ONTOLOGY_ROLES_TTL` seconds (default 60), and answers the gateway `503`, never with the
  `default` role, when it has none and the platform does not answer. `GET /counts` gains
  `data_store`. `IBLAI_AUTH_SCHEME=Api-Token` lets the platform client use a platform API key.
- One Ontology Frontend for every platform (`ONTOLOGY_MULTI_PLATFORM=true`, as at
  `ontology.ibl.ai`): each call goes to the backend of the signed-in admin's own platform,
  whose address the platform keeps (set on **Connect a backend**, or with the new
  `ontology platform address --url …` on the server) and the frontend reads with that admin's
  token. The address must be `https` and public; a member who is not the platform's admin sees
  one notice instead of the pages.
- `GET /config`: the backend sends its own configuration files and the catalog as text, secrets
  masked on its host, so the Configuration page no longer needs the frontend to sit beside the
  backend's checkout (`ONTOLOGY_ROOT` is gone).
- The Access page creates a role (**New role**) and edits access by a click on a node as well as
  on its switch: a role's node picks it, a toolset's or memory domain's node grants or revokes
  it, a tool's node puts it in or out of the picked toolset.
- A mapping layer on discovered tables: `entity` (the cache table and memory folder a table fills,
  e.g. the hand-curated `students`), `fields` (source→target column renames) and `template` (the
  memory template), edited like `entity_group` through `PATCH /services/<name>/tables`, recorded as
  overrides, and applied by the sync writer and the cache DDL. Approve regenerates the schedules
  and DDL from the stored manifest and analysis, so console edits take effect without a rediscovery.
- `ontology service map <name>` / `POST /services/<name>/map` / **Propose mapping** on the service
  page: the configured LLM proposes the mapping from each table's columns, a few sample rows and
  the house entities in `sql/schema.sql`. LLM provider `iblai`: the DM's OpenAI-compatible
  `/v1/chat/completions` behind the platform credentials (`ontology config llm --provider iblai`;
  `llm.base_url` for another completions host, `llm.sample_rows` for the probe's sample size).
- API sources register without database discovery (console and `service add --from <catalog>`):
  the Service row plus one schedule per catalog `sync_defaults` entry, each naming a `list-<entity>`
  tool on the service's custom MCP server. The sync engine reads a `<name>-mcp` source at
  `MCP_<NAME>_URL` and creates the cache table from the first row (`output.create_table`).
  Twenty CRM is the exception: its schedules name `service` and `table` like a database's.
- The MCP gateway speaks to a standard client: `initialize`, `ping` and notifications (202),
  `tools/list` items carry `inputSchema` and include the gateway's own tools (`read-memory`,
  `describe-ontology-cache`, `query-ontology-cache`, `get-sync-status`) per role, batches are
  answered in order, GET is 405, and every `tools/call` writes an audit row. The ibl.ai platform's `streamable_http`
  connector (and OpenAI's hosted MCP tool) can now use it through a tunnel such as ngrok.
- `ONTOLOGY_SERVICE_TOKEN`: the platform calls the gateway as itself with
  `Authorization: Bearer <token>` and the role in `X-Iblai-Role` (principal `platform-service`),
  so an agent works without an Entra tenant. `ontology platform register --auth-type none --role
  <role>` registers the whole thing in one command; `connect --scope mentor --agent <id> --role`
  gives one agent its own role.
- `ONTOLOGY_GATEWAY_URL` is probed (`ping`): the console's Live badge and `ontology mcp status`
  say whether the public URL reaches the gateway instead of always "stopped".
- Tools that change data, as named operations. A toolset marked `write: true` (the console's
  switch "These tools can change data") holds tools whose fixed statement or HTTP request
  writes, on a source of their own. A role holds such a toolset only by name, alone or beside
  the wildcard (`["*", "registrar-writes"]`). The Toolbox's `http` source and tool are
  recognised, so an API system can be written to as well. `tools/list` carries MCP's
  `annotations` (`readOnlyHint`, `destructiveHint`) and an `inputSchema` that includes an `http`
  tool's `pathParams`, `queryParams`, `bodyParams` and `headerParams`.
- A write is recorded before it runs: an audit row `mcp.tools/call.write` with the arguments
  (4,000 characters), and the call is refused when that row cannot be written. Every
  `mcp.tools/call` row now says in `details` whether the tool failed (`isError`).
- An ibl.ai credential on `/mcp`: a DM token (`Authorization: Token`), a platform API key
  (`Api-Token`), or either behind `Bearer`, which the gateway tells apart. It carries its role:
  the gateway asks the platform what the credential is granted under `/custom/ontology/`
  (`GET /v1/rbac/permissions/` with the credential itself and `iblai-org`). A member gets every
  role the policies `Ontology: <role>` list them on, combined, plus `default`; a key limited to
  its own policies gets exactly those roles; an admin of the platform reads everything, and
  holds a toolset that changes data only through a role that names it and lists them; a
  credential that reaches nothing is a 403. `X-Iblai-Role` sent with one is a 400. The audit log
  and the rate limit see `ibl:<username>`, or `ibl-key:<12 hex digits of the key's hash>` for a
  key with no owner to name, with the role `platform-admin`, `platform-user` or `platform-key`.
  Needs `ONTOLOGY_DM_URL` and `IBLAI_ORG`; the answer, a refusal included, is kept for
  `ONTOLOGY_ROLES_TTL` seconds.
- `concurrency_limits.max_records_per_query` is enforced: `query-ontology-cache` returns at most
  that many rows. The console's role editor offers it as "Rows per cache query" (100, 1,000,
  10,000, No limit; a new role starts at 1,000). In the platform store it is also a resource of
  the role's policy, `/custom/ontology/limits/rows/<n>/`, so a credential's grants carry it; of
  several roles' limits the largest applies, and an admin has none. A role saved by an earlier
  version gets the resource when it is saved once more.
- The console's role editor has one text field, the name. Toolsets, memory domains (Read, Query
  data) and console access are switches; the technical name is derived from the name and
  numbered when taken; a domain a role reads only in part is shown as such and left as it is.
  A role that exists is saved with every change and closed with Done; a new one is saved by
  Create. From 768 px of width the editor is two columns and about half as tall.

### Changed
- Syncs run on the worker. "Sync now" and "Run all" in the console queue their work
  (`ONTOLOGY_CELERY_BROKER`, which has no default any more: unset, a task runs where it is asked
  for), so a long sync never holds a web request and the gateway never writes a memory file. The
  scheduler holds one entry, a tick every minute that queues each schedule whose cron has come
  due since its last run: a schedule saved in the console starts by itself, one that never ran
  starts at the next tick, and nothing is restarted. `celery[redis]` brings the Redis client.
- `query-ontology-cache` and `describe-ontology-cache` are offered to a role that may query any
  cache table. They no longer need the toolset `admin-analytics-tools`, which would hand a role
  every other tool in it, and a `tools.yaml` entry of either name is not listed.
- `mcp-servers/twenty`, its compose service and `MCP_TWENTY_URL` are gone: the backend reads
  Twenty itself. A `twenty` system registered before must be removed and added again; its old
  schedules fail saying so.
- One `Dockerfile` at the repo root replaces `gateway/Dockerfile` and `sync-engine/Dockerfile`;
  `docker-compose.yml` builds both services from it, gives the worker its command, adds Redis
  and loses `admin-dashboard`, which never existed, as does `config/Caddyfile`.
- Removing a system also removes its sync schedules and the tools and sources it merged into
  `tools.yaml`; a toolset left empty goes too, from the file and from every role that names it.
  A removal that fails now says so instead of reporting success.
- A system's name is lowercase letters, digits, `-` and `_` (at most 63, starting with a letter
  or a digit) when added through the console API, and cannot be `databases`.
- The example roles a new platform gets are written with only the toolsets the backend's
  `tools.yaml` defines: a role naming a toolset the backend lacks could not be saved again.
- On `/mcp`, `ONTOLOGY_ADMIN_PLATFORMS` no longer admits members of the platforms it lists: an
  ibl.ai credential is judged on `IBLAI_ORG` alone. A token signed in to another platform, or
  issued before tokens recorded a platform, is refused there (sign in again).
- The hosted Ontology Frontend no longer keeps "this platform has no backend" for a minute, so
  a backend that was just connected is found at once.
- `mcp_toolsets: ["*"]` means every toolset that only reads. The gateway decides what writes and
  fails closed (`toolbox_compat.writing_tools`): a tool reads only if it is an `http` `GET`/`HEAD`
  or one fixed `*-sql` statement that starts with a reading keyword and holds no `;` and no write
  word; every tool on a source one tool writes through counts as a write. A writing tool is never
  lent by an unmarked toolset, saving one in an unmarked toolset is refused, a sync schedule
  cannot name one (when saved and when run), and the console's Test button and `ontology mcp
  test` refuse one.
- `tools.yaml` validation refuses two documents of one kind with one name and an `http` tool
  without `method` or `path`. A literal secret is refused at any depth of a source or a tool,
  `Authorization` and `Cookie` headers included; a scheme word may precede the reference
  (`Bearer ${VAR}`). The same two words are masked wherever configuration is shown.
- A `Bearer` value that is not shaped like a JWT is no longer answered `401` by the Entra
  validator: on `/mcp` it is tried as a DM token and as an API key.
- A batch on `/mcp` counts against the `tools/call` limit once for each call it carries; a
  verified DM token or API key is counted by itself, not by address.
- A role's `max_records_per_query` must be a whole number above zero when saved through the
  console API.
- The sync engine reads a database source straight through the service's own connection
  (`SyncRunner.pull_table`; the generated schedule names `service` and `table`) instead of a
  Toolbox tool, so "Sync now" works without a Toolbox that knows the source. The Toolbox serves
  agent-facing tools only. The image installs the `auto-ontology` connectors and the
  compose stack hands it the registry key.
- Generated cache tables have bare names (no `cache.` schema), portable DDL
  (`DEFAULT CURRENT_TIMESTAMP`), the mapping's names, and approve applies the DDL to the cache
  database (`IF NOT EXISTS`); before, nothing created them.
- Provisioning validation samples 100 rows of the three biggest tables through the service
  connection (`LIMIT` / `FETCH FIRST` / `TOP` per dialect); an API service passes with a note.
- The custom MCP servers (`mcp-servers/*`) serve stateless streamable HTTP on port 3000; they ran
  on stdio, so the compose stack's `MCP_CANVAS_URL` never answered.
- Discovered tables are one `ServiceTable` row each (a migration moves existing manifests);
  `Service.schema_manifest` keeps per-table summaries. `ProvisioningStep.order` is stored in a
  `position` column. The unused `DiscoveredService` and `SyncSchedule` models are gone.
- A failed audit write is logged (`iblai_ontology.audit`) instead of dropped silently.
- `chromadb` is pinned `>=0.6,<0.7` to match the `chromadb/chroma:0.6.3` server image (1.x
  dropped the built-in server token auth the compose stack relies on).
- A schedule with `enabled: false` in `sync-schedules.yaml` is now skipped by the scheduler,
  `run_all_due` and manual syncs (it was read by the API only).
- Python 3.13 is the only supported version (`requires-python >=3.13,<3.14`, CI, the
  image) because auto-ontology requires 3.12–3.13. `pydantic` moved from `==2.13.3` to
  `>=2.13.5,<3`.
- uv project: `uv.lock` pins every dependency, the dev tools are a `dev` dependency group
  (pytest, pytest-cov, ruff 0.14.14), and CI and the image install with `uv sync
  --locked`. `DEV.md` replaces `dev.sh`. The image builds from the repo root, and a
  `.dockerignore` keeps `.env*`, `.venv` and `frontend/` out of it.
- The console moved to its own repository; its CI job left with it.
- Signing in to the console with an ibl.ai platform token takes that token alone: the backend
  reads the caller's own memberships from the platform with it. The `X-Edx-Jwt` header,
  `ONTOLOGY_LMS_URL` and the check that two credentials name one user are gone.
- `ONTOLOGY_ADMIN_PLATFORMS` defaults to this backend's own platform (`IBLAI_ORG`) in both store
  modes and names a platform by its key only (it also matched a platform's `org`). A `local`
  backend with `IBLAI_ORG` set took any platform's admin before; with neither variable set it
  still does.
- Console requests whose platform token the backend has verified are rate limited per token, not
  per client address: behind one frontend every user shared one count.
- The README is an overview for decision-makers: what it is, where data lives, the security
  controls and what it is built with (Google MCP Toolbox, NVIDIA auto-ontology). The gateway
  hardening variables moved to `docs/deployment.md`; the end-to-end walk-through, the catalog and
  a complete command map moved to `docs/components/07-cli.md`.


### Fixed
- PostgreSQL sources read with a read-only role: the safety suite probed `public` only (a CRM
  whose `public` is empty made every probe inconclusive), primary and foreign keys came from
  `information_schema` views that hide them from a SELECT-only role (no PRIMARY KEY in the cache
  DDL, so the upsert failed, and no edges in the semantic map), `pull_table` sent unquoted
  camelCase names, and never-analyzed tables showed -1 rows. Keys now come from `pg_catalog`,
  the probe takes any readable table (quoted, schema-qualified), identifiers are quoted and row
  counts floor at 0.
- The platform client matches the DM: connection scopes are `platform | mentor | user` (not
  `agent`), the connection key is `mentor`, and attaching an agent is `PUT mentors/<id>/settings/`
  with the `mcp` tool slug, `can_use_tools` and the merged `mcp_servers` (it sent
  `PATCH agents/…` with `tools: ["mcp-tool"]`, which the DM does not know).
- The safety suite's UPDATE probe uses `ALTER TABLE … UPDATE` on ClickHouse: before 25.7
  ClickHouse has no `UPDATE` statement, so the probe was a syntax error and the suite refused
  every ClickHouse source on those versions.
- The sync writer upserts on composite primary keys (`output.primary_key` as a list) and binds
  Decimal, datetime and nested values on SQLite; the `student`/`course` memory templates now apply
  to the plural `students`/`courses` folders.
- `ontology mcp validate` / `POST /mcp/validate` report a broken `tools.yaml` (parse error,
  non-mapping document) as compliance errors instead of raising.
- Safety suite: dropping the probe table after its `CREATE` was denied now counts as denied on
  every engine ("does not exist"), as the Oracle branch already did via ORA-00942 — before, the
  DROP test came back inconclusive on PostgreSQL, MySQL and SQL Server and failed the suite. The
  ALTER probe uses `ADD COLUMN` everywhere but Oracle (Trino and ClickHouse reject the bare form).
- `docker-compose.yml` mounts `./config` at `/app/config` on the gateway (writable, for what the
  Ontology Frontend saves) and on the sync engine (read-only). The two single-file mounts it had
  put `roles.yaml` and `sync-schedules.yaml` where neither container read them.
- `ontology sync schedule` lists a schedule that has no `tool` (a table schedule) or no `cron`
  (an event-driven one) instead of failing on it.
- A sync scheduler that cannot read its schedules at start logs the error
  (`iblai_ontology.backend.celery`); it started with none and said nothing.
- `ontology doctor` reports a service list it cannot read as a failed line of its own.
- In forwarded mode the Ontology Frontend's Configuration page shows what the backend sends
  (`GET /config`), so what the backend refuses (a missing or wrong credential) is relayed; it
  read files from its own disk and answered without asking.
- `read-memory` resolved `..` after the role check, so a path could climb from a folder a role
  may read into another domain (`/ontology/courses/by-dept/../../students/…`). The path is
  normalised before the check.
- The cache switch of a memory domain (Access page and Semantic map) granted the domain's name
  instead of the tables it is cached in, so the grant matched nothing once a table had another
  name (`financial-aid` is cached in `financial_aid`, `students` in `students` and `holds`).
  `GET /graph` names each domain's tables and the switch grants and revokes those; a domain
  cached in no table has no switch.

### Removed
- `config/services.yaml` is no longer a sample of two services nobody connected: it ships empty,
  and the Configuration page no longer shows it. The registry is the database (or the ibl.ai
  platform), not this file.
- The generated `get-<table>` "every row" Toolbox tools: the sync no longer goes through the
  Toolbox, and the agent-facing tools are the analysis's suggested ones.
- `Permissions.allows_toolset`: nothing called it, and `"*"` no longer means every toolset.
- The role editor's fields for agents and the export limit. Both are still stored and returned;
  neither was ever enforced.

## [0.2.11] - 2026-07-09

### Security
- Added JWT replay protection to the gateway (#2147). The token `jti` was
  extracted and audit-logged but never checked, so an intercepted token could be
  replayed for its full (~1 hour) validity window with no way to detect or block
  it — critical when chained with the (now-fixed) cleartext-transport and role-
  forgery findings. `jti` is now a **required, validated claim** (a token without
  one is rejected), and `OntologyIdentityMiddleware` runs a cache-backed replay
  guard (`identity/replay.py`) keyed on the `jti` with an entry TTL of the
  token's remaining lifetime (`exp - now`), so the store self-expires and never
  grows unbounded. Two modes via `ONTOLOGY_JWT_REPLAY_MODE`: `bind` (default)
  binds a `jti` to its first-seen client IP and rejects the same `jti` presented
  from a different IP — this catches a stolen-and-replayed token while preserving
  the platform's legitimate reuse of an access token across requests; `strict`
  enforces single-use; `off` disables. Backed by the Django cache, so a shared
  `ONTOLOGY_CACHE_URL` (Redis) enforces the check across worker processes (the
  per-process `LocMemCache` catches a replay only on the worker that first saw
  the token — same caveat as the rate limiter). A dedicated cache store is used
  rather than a DB uniqueness constraint on `AuditLog.entra_token_id` because the
  audit log must record every access. Short token lifetimes and sender-
  constrained tokens (DPoP / mTLS) remain the strongest defences and are
  recommended in the README. Configurable via `ONTOLOGY_JWT_REPLAY_MODE` and
  `ONTOLOGY_JWT_REPLAY_TTL_FALLBACK`.

## [0.2.10] - 2026-07-09

### Security
- Required authentication on the ChromaDB vector store (#2146). The
  `vector-store` container previously ran with no auth on `ontology-internal`, so
  any container on that network — or an attacker who gained code execution via
  another finding — could read or tamper with every embedding (which encode
  institutional content and PII) without credentials. The vector store now runs
  ChromaDB's `TokenAuthenticationServerProvider` with a static bearer token
  supplied via the new required `CHROMA_TOKEN` env var, and the shared
  `VectorSearch` client (used by both the gateway and the sync engine) presents
  that token when set. `CHROMA_TOKEN` is passed to the `vector-store`,
  `sync-engine`, and `ontology-gateway` services in `docker-compose.yml` and
  documented in `.env.root.example` and the README; the compose files fail fast
  (`${CHROMA_TOKEN:?…}`) if it is unset. The client stays auth-free when the
  token is absent, preserving local and air-gapped runs.

## [0.2.9] - 2026-07-08

### Security
- Hardened gateway transport security (#2145). Bearer tokens could traverse
  cleartext HTTP and the proxy set no protective response headers, so an on-path
  observer could capture a token (chaining with the no-replay and role-forgery
  findings for full compromise) and defence-in-depth headers were absent. A new
  `OntologySecurityMiddleware` (a) rejects requests that carry an
  `Authorization: Bearer` header over a non-HTTPS connection with HTTP 403,
  before the token is validated, and (b) emits `Strict-Transport-Security` (over
  HTTPS only), `Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy`, and `X-Frame-Options` on every response. TLS is trusted via
  `SECURE_PROXY_SSL_HEADER` (Caddy's `X-Forwarded-Proto`). All behaviour is
  configurable via `ONTOLOGY_SECURITY_HEADERS_ENABLED`, `ONTOLOGY_REQUIRE_HTTPS`,
  `ONTOLOGY_HSTS_*`, `ONTOLOGY_CSP`, `ONTOLOGY_REFERRER_POLICY`, and
  `ONTOLOGY_FRAME_OPTIONS`. Matching edge headers and the automatic HTTP->HTTPS
  redirect were added to `config/Caddyfile`, and the `ONTOLOGY_RATELIMIT_*` /
  security env vars are now documented in the README.

## [0.2.8] - 2026-07-08

### Security
- Added rate limiting to the gateway (#2144). Requests to `POST /mcp` were
  unbounded, allowing unthrottled brute force, enumeration, and data
  exfiltration. A new `OntologyRateLimitMiddleware` applies a fixed-window limit
  keyed on the authenticated subject (falling back to client IP), with a
  stricter bucket for `tools/call`, returning HTTP 429 with `Retry-After` when
  exceeded. Limits are configurable via `ONTOLOGY_RATELIMIT_*` env vars and
  backed by the Django cache (set `ONTOLOGY_CACHE_URL` to a redis:// URL to
  enforce across workers). A commented coarse per-IP `rate_limit` block was added
  to `config/Caddyfile` as edge defence-in-depth (needs the caddy-ratelimit
  plugin).

## [0.2.7] - 2026-07-08

### Security
- Fixed symlink path traversal in the `read-memory` tool (#2143). Containment was
  checked lexically (`os.path.normpath`) before symlinks were resolved, so a
  symlink under the memory root pointing outside it let `read-memory` return
  files outside the root (the `ontology-files` volume is shared with the sync
  engine, so symlink provenance is not fully controlled). `_physical_path` now
  re-checks the fully resolved real path (`os.path.realpath`) against the
  resolved root after symlink resolution and returns the canonical path;
  symlinks that stay within the root still work.

## [0.2.6] - 2026-07-08

### Security
- Fixed URL-path injection in the Canvas and Navigate MCP servers (#2142). Both
  interpolated caller-supplied identifiers (`student`, `student_sis_id`) directly
  into upstream API URL paths, so a value with `../`, extra `/segments`, or
  `?query` could reach unintended endpoints under the shared service token.
  Identifiers are now validated and URL-encoded per path segment: Navigate via
  `_safe_segment`, Canvas via a format-aware `_user_ref_path` (numeric Canvas id
  or an explicit `sis_user_id:` / `sis_login_id:` reference; anything else, or a
  value containing `/ .. ? #` or whitespace, is rejected). Both server modules
  also read their env vars lazily (at request time) instead of at import.

## [0.2.5] - 2026-07-08

### Security
- Enforced the per-role `cache_tables` ACL on cache queries (#2141). Roles carry
  a `cache_tables` allow-list (e.g. `IblaiOntologyAdmin` is limited to
  `sync_runs` / `audit_log`) and `Permissions.allows_cache_table()` existed, but
  it was never called — a restricted role could `SELECT` any table, including
  `auth_user`. `query_cache` now resolves the query's referenced relations from
  its plan (`EXPLAIN (FORMAT JSON)`, which the database expands through joins /
  CTEs / views) and denies (403) if any is not permitted by the role's ACL.
  Roles with `cache_tables: ["*"]` are unaffected (the check is skipped).

## [0.2.4] - 2026-07-08

### Security
- Enforced self-scoping for self-service roles on subject tools (#2140). A role
  marked `self_service: true` (e.g. `Student`) was bound to its own record on the
  memory layer (`${USER_EMPLID}`) but not on the data tools, so a student could
  read another student's record by passing a different `student_id`. The gateway
  now requires any subject-identifier argument to equal the caller's own id for
  self-service roles (fail-closed if the caller has no resolved id); staff /
  analytics roles keep cross-subject access, which is by design.

### Added
- `docs/authorization-model.md` documenting the role-based authorization model:
  shared per-source service credentials and cross-subject staff access are
  intentional; `self_service` is the only self-scoped role class. Clarifies that
  Shannon AUTHZ-05/06/07 were false positives for this design and that #2138 is
  the real control against unauthorized cross-subject access.

## [0.2.3] - 2026-07-08

### Security
- Fixed LDAP injection in the LDAP MCP server's `get-employee` /
  `get-org-structure` tools (#2139). Caller-supplied `email` / `department`
  values were interpolated into LDAP search filters unescaped, so a payload like
  `*)(objectClass=*` turned the filter into a wildcard that enumerated the whole
  directory. Both values are now escaped per RFC 4515
  (`ldap3.utils.conv.escape_filter_chars`) via dedicated filter builders. The
  server module also now reads its `LDAP_*` env vars lazily (at connect time)
  instead of at import.

## [0.2.2] - 2026-07-08

### Security
- Fixed a critical privilege escalation via the trusted `X-Iblai-Role` header
  (#2138). The gateway resolved permissions from the client-supplied header
  without checking it against the validated Entra JWT, so any authenticated user
  could assign themselves any role (e.g. `Executive`, `IblaiOntologyAdmin`). The
  active role is now derived from the token's `roles` claim; `X-Iblai-Role` acts
  only as a selector among the roles the token grants, and a request for any
  other role is rejected with HTTP 403.

## [0.2.1] - 2026-07-08

### Security
- Fixed a critical SQL injection / broken-access-control flaw in the MCP gateway
  `query-cache` / `query-ontology-cache` tool (#2137). The cache-query aliases
  were dispatched before the toolset-scope check, so any authenticated caller —
  including the zero-tool `default` role — could reach the handler, which then
  executed the caller's raw `sql` (a `SELECT`/`WITH` prefix check on a copy let
  CTE-wrapped DML through). The aliases now pass the same toolset-scope check as
  every other tool, and `query_cache` validates a single read-only statement and
  runs it inside a PostgreSQL `READ ONLY` transaction that rejects any hidden
  write at the engine.

## [0.2.0] - 2026-07-03

### Added
- **DSL → Google MCP Toolbox config generator** (`backend/mcp_server/toolbox_config.py`):
  translates the ontology `tools.yaml` authoring DSL (`kind: source|tool|toolset`)
  into the Toolbox-native `sources`/`tools`/`toolsets` map format written to
  `config/generated/toolbox.yaml`. Maps `type` → `kind`, renames Oracle
  `database` → `serviceName`, preserves `${VAR}` tokens (secrets stay out of the
  generated file), and reports `${...}` raw-injection tools as gateway-native
  (excluded from the Toolbox config).
- `ontology mcp build` command to generate the Toolbox config; `ontology deploy up`
  now runs it automatically before starting the stack.
- Generic, backend-neutral database connectors — connect to any read-only DB,
  local or remote, via env vars:
  - **`client-postgres`** (`CLIENT_POSTGRES_*`) with `list-postgres-tables` /
    `describe-postgres-table` and the `client-postgres-tools` toolset.
  - **`client-mysql`** (`CLIENT_MYSQL_*`) with `list-mysql-tables` /
    `describe-mysql-table` (MySQL `?` placeholders + `information_schema`) and the
    `client-mysql-tools` toolset.
- `docs/read-only-db-user.md`: provisioning a read-only Postgres/MySQL user.
- `docker-compose.override.example.yml`: how `mcp-toolbox` reaches source
  databases — Pattern A (attach to a local source container's network, connect by
  hostname) and Pattern B (egress network for a remote source, connect by
  host/IP). The real `docker-compose.override.yml` is git-ignored.
- Per-service env templates (`.env.*.example`) and expanded `.env` guidance.
- Higher-ed sample split into optional `config/tools.higher-ed.example.yaml` and
  `config/roles.higher-ed.example.yaml`.
- Tests for the Toolbox config generator.

### Changed
- Custom MCP servers (canvas, slate, navigate, ldap) migrated from the invalid
  `mcp.server.Server` + `@server.tool()` usage to `FastMCP`.
- Canvas server resolves users by Canvas user id, SIS id, or `sis_login_id:` ref
  (previously SIS-only); `get_student_submissions` now uses the real per-course
  submissions endpoint and calls `raise_for_status()`.
- Gateway `_proxy_to_toolbox` now calls the Toolbox `/mcp` JSON-RPC endpoint
  (the legacy `/api/tool/<name>` REST path is disabled in Toolbox ≥1.5).
- Source connections are host/credential-driven and work identically for local
  containers and remote databases — only the network path (set in the override)
  differs.
- `docker-compose.yml`: `mcp-toolbox` loads the generated config via `--config`
  and fixed the duplicated `toolbox` entrypoint argument. Deployment-specific
  external source networks were removed from the committed compose (so a fresh
  clone parses without pre-existing networks); that wiring now lives in the
  git-ignored override.
- Default `config/tools.yaml` / `config/roles.yaml` trimmed to a clean,
  deployable baseline (cache + client connectors) so the Toolbox — which eagerly
  connects to every source at startup — starts without unreachable sample sources.

### Fixed
- `mcp-toolbox` container no longer crash-loops on the shipped compose command.
- Generated Toolbox config no longer breaks the Toolbox's whole-file environment
  expansion (no `${...}` in generated comments).

[0.2.8]: https://github.com/iblai/ontology/releases/tag/v0.2.8
[0.2.7]: https://github.com/iblai/ontology/releases/tag/v0.2.7
[0.2.6]: https://github.com/iblai/ontology/releases/tag/v0.2.6
[0.2.5]: https://github.com/iblai/ontology/releases/tag/v0.2.5
[0.2.4]: https://github.com/iblai/ontology/releases/tag/v0.2.4
[0.2.3]: https://github.com/iblai/ontology/releases/tag/v0.2.3
[0.2.2]: https://github.com/iblai/ontology/releases/tag/v0.2.2
[0.2.1]: https://github.com/iblai/ontology/releases/tag/v0.2.1
[0.2.0]: https://github.com/iblai/ontology/releases/tag/v0.2.0
