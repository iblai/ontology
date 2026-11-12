# Developing iblai-ontology

A uv project: `pyproject.toml` declares it, `uv.lock` pins every dependency, and uv picks
Python 3.13 from `requires-python` (downloading one if none is installed).

## Setup

```bash
uv sync --extra django --extra auto-ontology   # what CI installs: backend, connectors, dev group
uv sync --all-extras                           # plus source drivers, BYOK LLM, ChromaDB
```

`uv sync` is exact: it removes packages the selected extras don't need. `--all-extras` builds
`chroma-hnswlib` from source on 3.13 (no wheel), so it needs a C++ compiler.

## Checks (what CI runs)

```bash
uv run ruff format --check .
uv run ruff check --select I .
uv run ruff check .
uv run pytest -q                 # arguments pass through: uv run pytest -k canvas -q
```

Fix formatting and import order:

```bash
uv run ruff format . && uv run ruff check --select I --fix .
```

## Backend

```bash
uv run python -m iblai_ontology.backend.manage migrate
uv run python -m iblai_ontology.backend.manage seed_example_data
uv run uvicorn iblai_ontology.backend.asgi:application --reload --port 8000
```

That is enough to sync: with no `ONTOLOGY_CELERY_BROKER` a sync runs where it is asked for (the
console's **Sync now**, `ontology sync run`). For schedules that start by themselves, give the
backend and a worker the same broker:

```bash
docker run -d --rm --name ontology-redis -p 127.0.0.1:6379:6379 redis:7-alpine
export ONTOLOGY_CELERY_BROKER=redis://127.0.0.1:6379/0      # in the backend's shell too
uv run --extra django celery -A iblai_ontology.backend.celery:app worker --beat --loglevel=info
```

The worker's scheduler ticks once a minute and queues every schedule that is due, so a schedule
saved while it runs needs no restart. `--extra django` matters: the Redis client comes with that
extra, and without it a queued task fails with `'NoneType' object has no attribute 'Redis'`.

## CLI

```bash
uv run ontology --help
```

## Local sync

A sync reads a database source through the service's own connection, so it needs no Toolbox.
Point the config, registry, cache and memory files at a scratch directory and run the console
against the backend:

```bash
export ONTOLOGY_CONFIG_DIR=/var/tmp/ontology-demo/config      # tools.yaml, sync-schedules.yaml, roles.yaml
export ONTOLOGY_SQLITE_PATH=/var/tmp/ontology-demo/db.sqlite3  # the registry and the cache tables
export ONTOLOGY_FILES_ROOT=/var/tmp/ontology-demo/files        # one Markdown memory per row
export ONTOLOGY_CREDENTIAL_KEY=$(uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
export ONTOLOGY_API_DEV_ALLOW_ANON=true                        # the console without ibl.ai SSO
export ONTOLOGY_CORS_ORIGINS=http://localhost:3300             # where the console runs
uv run python -m iblai_ontology.backend.manage migrate
uv run uvicorn iblai_ontology.backend.asgi:application --port 8000
```

Add the service in the console (or `ontology service add`), approve it (creates the cache tables
and merges the schedules), then **Sync now**. `MCP_TOOLBOX_URL` matters only for the agent-facing
tools; `MCP_<NAME>_URL` points a `<name>-mcp` schedule at an API source's MCP server.

## LLM through the DM

Schema analysis (`service discover`, `service add --llm-discover`) and the mapping probe
(`service map <name>`, **Propose mapping** on the service page) can use the DM's OpenAI-compatible
endpoint with the platform credentials the store already uses:

```bash
export IBLAI_BASE_URL=https://<dm-host> IBLAI_ORG=<platform-key> IBLAI_ADMIN_TOKEN=<platform API key> IBLAI_AUTH_SCHEME=Api-Token
uv run ontology config llm --provider iblai   # model iblai/iblai-pro unless --model <provider/model>
uv run ontology service map ch-campus         # proposes entity, column renames and template per table
```

`llm.base_url` (or `IBLAI_INFERENCE_URL`) names another host when the deployment serves completions
elsewhere (the hosted DM: `https://asgi.data.iblai.app`). The probe sends each table's columns and
`llm.sample_rows` sample rows (default 5) to the model; `--sample-rows 0` sends names and types only.
The key's owner must be a platform admin with credits.

## Expose the gateway to an ibl.ai agent

The MCP gateway is `POST /mcp` on the backend, a stateless streamable-HTTP MCP server. An agent
on os.ibl.ai reaches it through a public URL and authenticates with the platform service token,
sending its role as `X-Iblai-Role`.

```bash
# 1. a service token in the backend's env (32+ characters), then restart the backend
export ONTOLOGY_SERVICE_TOKEN=$(openssl rand -hex 32)
export ONTOLOGY_GATEWAY_URL=https://<name>.ngrok-free.app/mcp   # the console's Live badge probes it

# 2. the tunnel (`ngrok config add-authtoken <token>` once; the free plan includes one static domain)
ngrok http 8000 --url https://<name>.ngrok-free.app

# 3. what the platform's client will do, by hand
curl -s -X POST https://<name>.ngrok-free.app/mcp \
  -H "Authorization: Bearer $ONTOLOGY_SERVICE_TOKEN" -H 'X-Iblai-Role: Executive' \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 4. register it on the platform and attach it to an agent (a platform API key)
export IBLAI_BASE_URL=https://<dm-host> IBLAI_ORG=<platform-key> IBLAI_ADMIN_TOKEN=<platform API key> IBLAI_AUTH_SCHEME=Api-Token
uv run ontology platform register --url https://<name>.ngrok-free.app/mcp --auth-type none --role Executive
uv run ontology platform attach <agent-id> --server <id printed by register>
```

Then ask the agent on os.ibl.ai what ontology tools it has, or how many students the cache holds.
The console's audit log lists every call under `platform-service` with its role; ngrok's inspector
at `http://127.0.0.1:4040` shows the requests.

Notes. The role must exist in `roles.yaml` (`Executive` reaches every read-only toolset and every cache table); a
per-agent role is `ontology platform connect --server <id> --scope mentor --agent <agent-id> --role <role> --auth-type token`
on a server registered with `--auth-type token`. The gateway allows 30 `tools/call` a minute per
token (`ONTOLOGY_RATELIMIT_TOOLS_CALL_MAX`). The agent's model must grant the MCP tool; with OpenAI
and Azure models the call comes from OpenAI's servers as plain `Bearer`, which the gateway accepts.
ngrok forwards `X-Forwarded-Proto: https`, which the cleartext-token rule requires, and its free
plan's browser warning page does not affect API clients.

A person, or a key made for an agent, can also call it with an ibl.ai credential, with
`ONTOLOGY_DM_URL` and `IBLAI_ORG` set on the backend. No role header: the credential carries its
role, and `X-Iblai-Role` sent with one is answered `400`.

```bash
# a DM token, a platform API key, or either one behind Bearer (the gateway works out which)
curl -s -X POST https://<name>.ngrok-free.app/mcp -H "Authorization: Token $DM_TOKEN" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST https://<name>.ngrok-free.app/mcp -H "Authorization: Api-Token $PLATFORM_API_KEY" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A member reaches every role the policies `Ontology: <role>` list them on, combined, plus
`default`; a key limited to its own policies reaches exactly the roles attached to it; a platform
admin reads everything and changes nothing, unless a role that lists them names a toolset that
changes data. The audit log shows the caller as `ibl:<username>`, or `ibl-key:<12 hex digits>`
for a key with no owner to name. The console's **Agents** page makes such a key and registers the
gateway on an agent with it, which needs `ONTOLOGY_GATEWAY_URL`. Details:
[docs/identity.md](docs/identity.md#a-persons-own-iblai-credential).

## A CRM source: Twenty

[Twenty](https://twenty.com) is the worked example of an external CRM, and it connects two ways.
Its REST API is the `twenty` catalog entry, which the backend reads and changes itself with an
address and an API key: Twenty's cloud or a self-hosted one, from the console's **Add a system**.
A self-hosted Twenty's database is also a `generic-postgres` source, read-only. Both land in the
same house tables (`organizations`, `persons`, `deals`, …) through the same mapping, so an agent
sees one CRM whichever way the rows came; only the REST path lets it create and update records.

### Run Twenty locally and seed it

```bash
mkdir -p /var/tmp/twenty-demo && cd /var/tmp/twenty-demo
T=~/Projects/src/github/twentyhq/twenty      # or fetch the file from the twenty/v2.48.0 tag on GitHub
git -C $T show twenty/v2.48.0:packages/twenty-docker/docker-compose.yml > docker-compose.yml
printf 'TAG=v2.48.0\nSERVER_URL=http://localhost:3000\nSTORAGE_TYPE=local\nPG_DATABASE_PASSWORD=%s\nENCRYPTION_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -base64 32)" > .env
printf 'services:\n  db:\n    ports:\n      - "127.0.0.1:5433:5432"\n' > docker-compose.override.yml   # the database on the host
docker compose -p twenty-demo up -d
docker compose -p twenty-demo exec -T server yarn command:prod workspace:seed:dev   # Apple + YCombinator; login tim@apple.dev / tim@apple.dev
```

### A read-only role on the CRM tables

What the role can `SELECT` is what discovery sees: PostgreSQL hides the rest of the database from
`information_schema`, so the grant list is the scope.

```bash
S=workspace_1wgvd1injqtife6y4rvfbu3h5      # the Apple workspace: SELECT id, "databaseSchema" FROM core.workspace
docker compose -p twenty-demo exec -T db psql -U postgres -d default <<EOF
ANALYZE;
CREATE ROLE ontology_ro LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE "default" TO ontology_ro;
GRANT USAGE ON SCHEMA $S TO ontology_ro;
GRANT SELECT ON $S.person, $S.company, $S.opportunity, $S."workspaceMember", $S.note, $S."noteTarget", $S.task, $S."taskTarget" TO ontology_ro;
EOF
```

### The database path

```bash
uv run ontology service add --name twenty --service-type generic-postgres --host 127.0.0.1 --port 5433 \
  --database default --user ontology_ro --password '<password>' --no-llm-discover   # 7 write probes denied, 8 tables
uv run ontology service map twenty --from twenty    # the catalog's Twenty mapping; `service map twenty` asks the LLM instead
uv run ontology service approve twenty               # cache tables persons, organizations, deals, … and 8 schedules
uv run ontology service sync twenty                  # 10,154 rows, one memory per row under $ONTOLOGY_FILES_ROOT
```

### The REST path

An API key comes from Twenty's Settings → APIs (on the local instance:
`docker compose -p twenty-demo exec -T -e NODE_ENV=development server yarn command:prod workspace:generate-api-key -w <workspace id> -n ontology`).

In the console: **Add a system** → Twenty CRM → "Twenty cloud" or "Self-hosted" with its address
→ the API key → Connect. The address must be `https`, or `http` on this machine. The key is
checked on the spot (a wrong one is refused with Twenty's words), the system is approved, its
first sync is queued, and the role of the system's name is given what the system brings: its
eight tables, their memory folders and the toolset `<name>-writes`. A role of that name that is
already there gets them added; if the role cannot be written the system stays connected and the
answer says why. The **Agents** page offers that role first. Removing the system takes back
what it gave, and a role left reaching nothing goes with it. From the CLI the same registration
is two steps, and makes no role:

```bash
uv run ontology service add --name crm --from twenty --host http://localhost:3000   # asks for the key, hidden
uv run ontology service approve crm && uv run ontology service sync crm             # 8 schedules, the toolset crm-writes
```

Without `--host` it asks for the address and offers Twenty's cloud.

The backend flattens a REST record the way Twenty names its columns (`name.firstName` →
`nameFirstName`), so one `fields` dict serves both paths, and a second sync updates the rows the
first created. Through the gateway: `SELECT stage, count(*) FROM deals GROUP BY stage`, or
`SELECT o.name, count(p.id) FROM organizations o JOIN persons p ON p.organization_id = o.id GROUP BY o.name ORDER BY 2 DESC LIMIT 5`;
`describe-ontology-cache` lists the tables and columns first.

Changing records: the system's own role holds the toolset `crm-writes`; any other role is
granted it in the role dialog, or with `mcp_toolsets: ["*", "crm-writes"]`. It holds `crm-create-person`, `crm-update-person` and the
same for company, opportunity, note and task; a note or a task takes `person_id`,
`organization_id` or `deal_id` and is linked to it. Each call is written to the audit log before
it runs, Twenty's refusal comes back as the tool's error, and the answer says whether the
refresh of the cache's copy was queued.

A `twenty` system registered before the backend read Twenty itself (with `mcp-servers/twenty` and
`MCP_<NAME>_URL`) must be removed and added again: its old schedules fail saying so.

Notes. The mapping renames columns and does not transform values (`amount_micros` stays in micros,
`stage` keeps Twenty's NEW…CUSTOMER, `first_name` and `last_name` are not joined): a SQL view over the
cache is the place for that. Twenty soft-deletes (`deleted_at`): the database path carries deleted rows,
the REST path leaves them out. Where a deployment preloads `sql/schema.sql` into the cache database,
the house table already exists and an unmapped source column has nowhere to go: extend the table or
map the column before the first sync.

## Dependencies

```bash
uv add <package>                                 # --optional <extra> or --group dev
uv lock --upgrade-package auto-ontology-server   # move auto-ontology to main's head
```

auto-ontology tracks `main` in `pyproject.toml`; `uv.lock` records the commit, so CI and the
image install the same one until the lock is upgraded.

## The server install, locally

A server is installed from three files: the image (`Dockerfile`), `deploy/compose.yaml` and
`deploy/install.sh`. Publishing a GitHub release whose tag is `v` plus the version in
`pyproject.toml` builds `ghcr.io/iblai/ontology:<version>`, writes that version into the other two
and attaches them to the release (`.github/workflows/release.yml`). Before a release, the stack
runs here under the name the compose file asks for:

```bash
docker build -t ghcr.io/iblai/ontology:dev .
cat > /var/tmp/ontology-stack.env <<EOF
ONTOLOGY_HOST=ontology.localhost
IBLAI_BASE_URL=https://<dm-host>
IBLAI_ORG=<platform-key>
IBLAI_ADMIN_TOKEN=<platform API key>
ONTOLOGY_DATA_STORE=rbac                         # dm when the platform keeps ontology records
ONTOLOGY_DB_PASSWORD=$(openssl rand -hex 24)
CHROMA_TOKEN=$(openssl rand -hex 24)
ONTOLOGY_SECRET_KEY=$(openssl rand -hex 48)
ONTOLOGY_CREDENTIAL_KEY=$(uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
EOF
stack() { docker compose -p ontology-proof --env-file /var/tmp/ontology-stack.env -f deploy/compose.yaml "$@"; }
stack up -d && stack ps                                     # migrate exited 0; the gateway is healthy
curl -sk -o /dev/null -w '%{http_code}\n' https://ontology.localhost/mcp   # 405; the proxy signs *.localhost itself
stack down --volumes
```

The script is checked without a server: `bash -n deploy/install.sh`, `shellcheck deploy/install.sh`
and `bash deploy/install.sh --dry-run --platform acme --platform-url https://api.iblai.app/dm --host ontology.example.edu`
(and the same with `--uninstall`), which says each step and changes nothing. The copy in the
source tree carries no version, so a real run of it stops at once; `tests/test_deploy.py` keeps
the script's `.env`, the compose file's settings and the workflow's two stamps in step.

## Platform store (`ONTOLOGY_DATA_STORE=rbac` or `dm`)

With `dm`, the ontology's roles, sync schedules and service registry live in the ibl.ai platform
(its backend, `api.iblai.app`) instead of on this host. Nothing is kept in a platform database.
`rbac` is for a platform that keeps no ontology records yet: its RBAC holds the roles, and what
`dm` keeps as records stays on this host. `deploy/install.sh` asks the platform and writes one of
the two into the server's `.env`.

| What | `local` (the default) | `rbac` | `dm` |
|---|---|---|---|
| Roles | `config/roles.yaml` | The platform's own RBAC roles: a role's grants are the resources of its one policy under `/custom/ontology/` | The same |
| A role's display name, agents and limits; the mark that the example roles were written | `config/roles.yaml` | This backend's database, one row a record (`services.Record`) | Ontology records of kind `role` and `setup` |
| Sync schedules | `config/sync-schedules.yaml` | `config/sync-schedules.yaml` | Ontology records of kind `sync_schedule`, one per schedule, keyed by its name |
| Service registry: services, discovered tables, health checks, safety reports, provisioning runs and steps | This backend's database | This backend's database | Ontology records, one kind per model |
| Agents connected from the console's Agents page | Not available | This backend's database, one row a connection | Ontology records of kind `agent_connection` |
| Sync runs and the audit log | This backend's database | This backend's database | This backend's database |
| Student-data cache, memory files, vector index, identity map, `tools.yaml`, `ontology.yaml` | This host | This host | This host |

A connection's record names the agent, the role, the MCP server and the key's id and fingerprint,
never the key. In `rbac` the backend makes no call to the platform's ontology records at all
(`tests/test_dm_config.py` holds it to that).

`ONTOLOGY_CREDENTIAL_KEY` never leaves the backend: the platform holds a service's connection as
ciphertext only.

```bash
export ONTOLOGY_DATA_STORE=dm IBLAI_BASE_URL=https://<dm-host> IBLAI_ORG=<platform-key>   # hosted: https://api.iblai.app/dm
export IBLAI_ADMIN_TOKEN=<platform API key> IBLAI_AUTH_SCHEME=Api-Token
uv run ontology sync import                      # config/sync-schedules.yaml into records; prints each name
uv run ontology roles import config/roles.yaml   # optional: a file's roles; the file must be named
```

The sync import takes a path too. Both store a file as written (`${USER_EMPLID}` is kept, not
expanded) and can be run again: they update what is there. There is no schema to create. In `dm`
nothing that runs reads the two files: `ontology roles validate` checks the platform's roles,
`ontology config validate` and the doctor leave both files out, and the Ontology Frontend's
Configuration page does not show them. In `rbac` that holds for `roles.yaml` alone: the
schedules file is read, validated and shown as in `local`, and there is nothing to import but
the roles.

- **The key.** A platform API key in owner mode, or a platform token (`IBLAI_AUTH_SCHEME=Token`,
  which expires after 14 days), of a platform admin. A key in token-policies mode reaches the
  records but is refused by the roles API.
- **Schedules are read every minute** by the sync scheduler's one tick, as they are from the
  file: a changed cron or an enabled schedule applies by itself, and one that never ran starts at
  the next tick.
- **Before the platform is migrated** (`ibl_ai_mentor.0415_ontologyrecord`) the records answer
  `503`.
- `seed_example_data` seeds the local SQLite only and refuses to run with `dm`.

Smoke test:

```bash
uv run ontology roles list && uv run ontology sync schedule   # both name the ibl.ai platform as their source
uv run ontology service add --name <name> --service-type generic-postgres --host <host> \
  --database <db> --user <read-only user> --password <password>
uv run ontology service approve <name> && uv run ontology sync run <name> && uv run ontology sync status
uv run ontology doctor                                         # its env:<service> lines come from the platform's registry
```

### Roles in the platform

A role is one of the platform's RBAC roles that holds an `Ontology/…` verb. What it reaches is
the resources of its one policy, named `Ontology: <role>`, under the platform's namespace for a
client's own verbs:

| In the role | Policy resource | Verb the role holds |
|---|---|---|
| `mcp_toolsets: [T]`, `["*"]`, `["*", W]` | `/custom/ontology/toolsets/T/`, `/custom/ontology/toolsets/`, both | `Ontology/Toolsets/action` |
| `cache_tables: [X]`, `["*"]` | `/custom/ontology/tables/X/`, `/custom/ontology/tables/` | `Ontology/Tables/read` |
| `/ontology/a/b/**`, `/ontology/**` | `/custom/ontology/memory/a/b/`, `/custom/ontology/memory/` | `Ontology/Memory/read` |
| `/ontology/a/_index.md`, one file | `/custom/ontology/memory/a/_index*/` (the `*` stands for `.md`) | `Ontology/Memory/read` |
| `${USER_EMPLID}` in a memory path | the segment `USER_EMPLID` | |
| `admin_dashboard: true` | `/custom/ontology/console/` | `Ontology/Console/action` |
| not `self_service` | `/custom/ontology/subjects/` | `Ontology/Subjects/read` |
| `concurrency_limits.max_records_per_query: N` | `/custom/ontology/limits/rows/N/` | none: holding the resource is the limit |
| `display_name`, `agents`, `concurrency_limits` | none: the ontology record `role/<name>` (`rbac`: a row of this backend's database) | |

- **Verbs.** A role the ontology creates holds `Ontology/*`, so its policy alone says what it
  reaches. The ontology never changes a role's verbs: a role made in the platform with fewer is
  read as it stands, and a grant whose verb it lacks is refused with the reason.
- **One policy.** `Ontology: <role>` is the only policy read or written. Another policy bound to
  the role changes nothing here, and a role is not deleted while one exists (the platform would
  delete it too). A parent resource (`/custom/ontology/`, `/custom/`) grants everything beneath;
  any other shape is skipped and logged, never widened.
- **The toolsets root is the read-only ones.** `/custom/ontology/toolsets/` (and any parent of it)
  reads as `"*"`, which the gateway takes as every toolset *without* `write: true`. A toolset that
  writes is held only through its own resource, which is why a name is kept beside the root
  (`["*", "registrar-writes"]`). The platform's own RBAC reads a parent as covering its children;
  the ontology does not, for this one kind.
- **Who holds a role.** The people and groups listed on `Ontology: <role>` in the platform's RBAC
  screens, and an API key that policy is attached to. For a caller with an ibl.ai credential the
  gateway asks the platform what that credential is granted, which is why the row limit is a
  resource too: grants carry no role name
  ([docs/identity.md](docs/identity.md#a-persons-own-iblai-credential)). The console has no page
  for people; its Agents page makes a key for one role and gives it to an agent.
- **What cannot be kept is refused**, with the reason and before anything is written: a toolset
  or table name with a character outside letters, digits, `-` and `_`; a memory path that is
  neither a folder (`…/**`) nor one `.md` file; a name a platform role that is not an ontology
  role already has.
- **Example roles.** The first console request of a signed-in admin writes `default`,
  `DataAnalyst`, `Executive` and `IblaiOntologyAdmin` (the stock `config/roles.yaml`, built into
  the backend) into a platform that has no ontology role, then the record `setup/roles` (`rbac`:
  a row of this backend's database). Each is
  written with only the toolsets this backend's `tools.yaml` defines, since a role that names a
  toolset the backend lacks cannot be saved again. So it happens once a platform, and roles an
  admin deletes stay deleted. The gateway, the sync engine and the CLI never do this.
- **Who may write them.** A policy may not grant more than its writer holds, and platform admins
  hold `/custom/` through the platform's `Custom RBAC Manager` policy. On a platform created
  before that policy existed, saving a role is refused until the platform's `seed_rbac_data` is
  run again.
- **Roles are cached.** A backend process keeps the roles it read for `ONTOLOGY_ROLES_TTL` seconds
  (default 60): a role changed in the platform, or by another process, shows within that time, and
  one saved through this process shows at once. While the platform does not answer, a process
  serves its last copy and logs a warning once a TTL; a process with no copy answers the gateway
  `503`, never with the `default` role.

## One Ontology Frontend for every platform

The Ontology Frontend can run once for every platform (`ONTOLOGY_MULTI_PLATFORM=true` in its
environment, as at `ontology.iblai.me`). It then has no backend of its own: each call goes to the
backend of the signed-in admin's platform, in either store mode.

An admin of a platform with no backend lands on **Connect a backend**: one field for the server's
host name, the install command for it ([docs/deployment.md](docs/deployment.md#install-on-ubuntu)),
a button that makes the backend's platform key, and Connect. The backend's address is taken to be
`https://<host name>`; one that differs is given under Advanced. Connect checks that the address is
`https` and public, that the server answers `GET /counts` with the admin's own token and names its
platform there, then writes the record with `iblai-org: <that platform>`, so the platform itself
refuses an address that is another platform's backend. The same record from the server's side:

```bash
uv run ontology platform address --url https://ontology.<your-domain>   # this backend's public base URL
```

- **Where browsers keep the address** (`ONTOLOGY_BACKEND_STORE=browser` in the frontend's
  environment, for platforms that keep no ontology records yet). Connect makes the same checks and
  writes nothing: the browser keeps the address in `localStorage` under
  `ontology_backend:<platform>` and names it on every call (`X-Ontology-Backend`). The frontend
  uses a named address once it answers `GET /counts` as a backend that takes the caller's
  sign-in, and keeps that for a minute per sign-in and address. In this mode its server asks the
  platform nothing: the platform's edge refuses calls that come from a hosting network, so the
  backend's own answer is the judge. Each browser connects once, a cleared browser connects
  again, and anyone can have the frontend ask a public address for `/counts`; nothing is sent
  on until that address proves itself, and the backend still refuses a member who is not its
  platform's admin. `ontology platform address` refuses on such
  a platform. Remove the setting once the platform keeps the record, and connect once more.
- **The address** is the ontology record `backend/default` of the platform of `IBLAI_ORG`, which
  only an admin in person may write. The frontend reads it with the signed-in admin's own token,
  so only that platform's admins find the backend, and it sends their calls there with that token
  and nothing else (`Authorization: Token …`). The hosted console's **Backend** page shows it and
  connects another in its place.
- **The backend's key** is a platform API key that acts as the admin who pressed "Create key"
  (`POST /api/core/platform/api-tokens/` with their sign-in, no `mode`). The browser asks the
  platform for it directly, so the frontend's server never holds it; it is shown once.
- **It must be `https` and public.** The frontend refuses an address that resolves into a private
  network and follows no redirect. A backend that only the campus network reaches cannot be used
  this way: run a frontend beside it instead (`ONTOLOGY_API_URL`).
- **Who gets in.** The backend verifies the token with the platform (`ONTOLOGY_DM_URL`) and takes
  an active admin of `IBLAI_ORG`, or of a platform listed in `ONTOLOGY_ADMIN_PLATFORMS`. A member
  who is not an admin sees one notice instead of the pages.
- **Rate limit.** Console requests are counted per verified token, since they all arrive from the
  frontend's one address.
- Whoever administers a platform decides where its console users' tokens are sent: the address is
  theirs to record.
