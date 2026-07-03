# Changelog

All notable changes to iblai-ontology are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Generic remote **`client-postgres`** source (fully env-driven via `CLIENT_DB_*`)
  plus parameterized `list-client-tables` and `describe-client-table` tools and a
  `client-db-tools` toolset — connect to any read-only PostgreSQL.
- `docs/read-only-db-user.md`: provisioning a read-only Postgres role for a DB source.
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
- `docker-compose.yml`: `mcp-toolbox` loads the generated config via `--config`,
  fixed the duplicated `toolbox` entrypoint argument, and can join an external
  source network.
- Default `config/tools.yaml` / `config/roles.yaml` trimmed to a clean,
  deployable baseline (cache + client-postgres) so the Toolbox — which eagerly
  connects to every source at startup — starts without unreachable sample sources.

### Fixed
- `mcp-toolbox` container no longer crash-loops on the shipped compose command.
- Generated Toolbox config no longer breaks the Toolbox's whole-file environment
  expansion (no `${...}` in generated comments).

[0.2.0]: https://github.com/iblai/ontology/releases/tag/v0.2.0
