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
