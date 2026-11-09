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
uv run celery -A iblai_ontology.backend.celery:app worker --beat --loglevel=info
```

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

## Dependencies

```bash
uv add <package>                                 # --optional <extra> or --group dev
uv lock --upgrade-package auto-ontology-server   # move auto-ontology to main's head
```

auto-ontology tracks `main` in `pyproject.toml`; `uv.lock` records the commit, so CI and both
images install the same one until the lock is upgraded.

## DM store (`ONTOLOGY_DATA_STORE=dm`)

The registry and run history (services and their discovered tables, safety reports, health
checks, provisioning runs, sync runs, the audit log) can live in the ibl.ai DM's platform
database (DM PR #3103) instead of this backend's database. The student-data cache, memory files,
vector index, identity map and YAML config stay local, and `ONTOLOGY_CREDENTIAL_KEY` never leaves
the backend: the DM holds the connection ciphertext only.

```bash
export ONTOLOGY_DATA_STORE=dm IBLAI_BASE_URL=https://<dm-host> IBLAI_ORG=<platform-key>
export IBLAI_ADMIN_TOKEN=<platform API key> IBLAI_AUTH_SCHEME=Api-Token
uv run ontology platform database   # creates the "ontology" database and its tables; rerun after a model change
```

The key's owner must be a platform admin (RBAC off), or the key must hold `Ibl.Mentor/Database/*`
and `Ibl.Mentor/DatabaseAccess/*` (RBAC on). A DM `Token` works too but expires after 14 days.
PostgREST answers 503 "not ready" for a moment after new tables appear; retry.
`seed_example_data` seeds the local SQLite only and refuses to run with `dm`.

Smoke test against a DM with Supabase configured:

```bash
uv run ontology platform database   # run it twice: the second says "up to date"
uv run ontology service add --name <name> --service-type generic-postgres --host <host> \
  --database <db> --user <read-only user> --password <password>
uv run ontology service schema <name>
uv run ontology service approve <name> && uv run ontology sync run <name> && uv run ontology sync status
```
