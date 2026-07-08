# Changelog

All notable changes to iblai-ontology are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.7]: https://github.com/iblai/ontology/releases/tag/v0.2.7
[0.2.6]: https://github.com/iblai/ontology/releases/tag/v0.2.6
[0.2.5]: https://github.com/iblai/ontology/releases/tag/v0.2.5
[0.2.4]: https://github.com/iblai/ontology/releases/tag/v0.2.4
[0.2.3]: https://github.com/iblai/ontology/releases/tag/v0.2.3
[0.2.2]: https://github.com/iblai/ontology/releases/tag/v0.2.2
[0.2.1]: https://github.com/iblai/ontology/releases/tag/v0.2.1
[0.2.0]: https://github.com/iblai/ontology/releases/tag/v0.2.0
