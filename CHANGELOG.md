# Changelog

All notable changes to iblai-ontology are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.1]: https://github.com/iblai/ontology/releases/tag/v0.2.1
[0.2.0]: https://github.com/iblai/ontology/releases/tag/v0.2.0
