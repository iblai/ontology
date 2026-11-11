# A role dialog without text fields, write toolsets, and ibl.ai credentials on the MCP gateway

## Context

On 2026-11-12, after the roles touch test, rei asked for three changes:

1. The "Edit role" dialog is rough: no text fields where possible, defaults on its option
   fields, friendly to a CIO or a beginner.
2. Let the MCP write to the connected services, as a toolset.
3. The MCP server accepts a DM token (`Token <t>`) and a platform API key (`Api-Token <t>`),
   and detects which one it was given when the prefix is `Bearer`.

Work in `~/Projects/ibl.ai/ontology.ibl.ai/main2`, on top of the 12 uncommitted files (the
README rewrite and the touch test's fixes). Nothing is committed; rei commits.

## Decided by rei on 2026-11-12

| | Decided |
|---|---|
| What an agent may write | **Named operations**: each write is a named tool an admin defined, on a separate write account, in a toolset marked as writing. No approval queue, no free-form SQL |
| Which services | **Databases and API sources** |
| Role of a personal credential | **Platform-assigned roles**: the policies `Ontology: <role>` that list the person; the header picks one; a single role needs no header; admins name any role |
| Dialog | **Switches + row limit**: the name is the only text field; "Rows per cache query" (default 1,000) is enforced; Agents and the export limit leave the dialog |

## What the code says (read and probed today)

- The gateway never looks at a tool's kind or SQL verb. `mcp_toolsets: ["*"]` (the stock
  `Executive`) would inherit any new toolset.
- **Two paths skip the validator or the role check.** Approving a service merges generated
  tools into `tools.yaml` unvalidated (`tools_generator.apply`), and a sync schedule runs any
  Toolbox tool by name on a timer with no role (`sync/engine.py` `pull`).
- The audit row is written after a call and its failure is swallowed; a tool that failed is
  recorded as allowed. A batch of 100 calls counts as one request for the rate limit.
- `concurrency_limits` and `agents` are stored and never applied.
- A DM token and an API key have no distinguishing prefix; an ordinary key acts as its owner.
  Probed on the dev DM: a made-up token is 403 `Invalid token.` under `Token` and `Api-Token`
  alike; the policy list accepts `username` (five `Ontology:` policies without it, none for a
  user in none); the member's own token lists their platform with `is_admin: false`.
- The platform keeps a parent and a child resource side by side in one policy (only exact
  duplicates are dropped), so "all read-only toolsets" plus one named toolset can be stored.
- MCP Toolbox 1.5.0 (the pinned version) has the `http` source and tool: `method`, `path`,
  `requestBody`, `pathParams`, `queryParams`, `bodyParams`, `headerParams` (read at that tag).
- The stock tools are all `SELECT`s with no write word in them, so the rule below flags none.

## Part 1 — Write toolsets

One rule carries it: **a toolset that writes is granted by name, never by a wildcard.**

**What counts as a write** (`toolbox_compat.py`, new `writing_tools(docs)`; fails closed):
an `http` tool whose method is not GET or HEAD; a tool whose type is not `*-sql`; a `*-sql`
tool with no statement (such as `postgres-execute-sql`, where the agent writes the SQL); a
tool with `templateParameters`; a statement that does not start with SELECT, WITH, SHOW,
DESCRIBE, DESC, VALUES or TABLE, or that holds a write word anywhere (INSERT, UPDATE, DELETE,
MERGE, INTO, TRUNCATE, DROP, ALTER, CREATE, GRANT, CALL, EXEC, COPY, LOCK…); then **every tool
that shares a source with one**. The gateway's own three tools read, by name. It is a text
scan, not a parser: a write word inside a string makes a read count as a write (loud, and
fixable), and a function that writes inside a `SELECT` is invisible, which is why the read
source keeps its read-only account.

| File | Change |
|---|---|
| `backend/mcp_server/toolbox_compat.py` | `writing_tools`. `http` joins `SOURCE_TYPES`. Validator errors: a writing tool in a toolset without `write: true`; an `http` tool without `method` or `path`; two documents of one kind with one name. Secrets: a secret-looking key anywhere in a source or tool (now also `authorization`, `cookie`) must be a `${VAR}`, with an optional scheme word in front (`Bearer ${VAR}`) |
| `config/reader.py`, `api/views.py` | The same two words join the masks, or `ontology config show` would print an expanded `Authorization` header, and the console's YAML view a literal one |
| `backend/mcp_server/toolsets.py` | `scope_for`: `*` covers toolsets without `write`; a write toolset counts only when named. A toolset without `write` never lends a writing tool: this is the real guard, since a merged or hand-edited file skips the validator |
| `backend/mcp_server/handlers.py` | `tools/list`: `annotations` (`readOnlyHint`; `destructiveHint` on writing tools) and an `inputSchema` that includes an `http` tool's four parameter lists. Before a writing tool runs, the context's `before_write` hook is called. `query_cache` caps `limit` at the role's `max_records_per_query` (ignored unless a whole number) |
| `backend/mcp_server/server.py`, `identity/middleware.py` | **A write is recorded before it runs** (`mcp.tools/call.write`, with its arguments cut at 4,000 characters) and is refused if that row cannot be written. The row after the call says whether the tool failed (`isError`), for every tool |
| `backend/sync/engine.py`, `api/views.py` | A schedule cannot name a writing tool: refused when saved and when run |
| `backend/ratelimit.py` | A batch counts once per `tools/call` it carries |
| `backend/mcp_server/tester.py` | The console's Test button and `ontology mcp test` refuse a writing tool, saying why |
| `backend/identity/role_source.py` | `_resources` and `_spec` keep names beside `*` (today `*` swallows them). A grant on the root still means `*`, so no write toolset |
| `backend/identity/roles.py` | `allows_toolset` (unused, and now wrong) goes, with its two test asserts |
| `backend/api/serializers.py`, `graph/builder.py`, `commands/mcp.py` | `McpToolsetSerializer.write` (left out of the YAML when false); `write` on toolset nodes; a role's `*` drawn to read-only toolsets and its names drawn too; a "writes" mark in `ontology mcp toolsets` |
| `frontend/lib/ontology/types.ts`, `graph.ts`, `mock/graph.ts`, `mock/handlers.ts` | `McpToolset.write`; `toggleGrant`/`grantPatch` expand `*` to read-only toolsets, keep the names held beside it, and flip a write toolset by name. The demo's copy of the builder follows |
| `frontend/components/mcp/toolset-dialog.tsx`, `app/(console)/mcp/page.tsx`, `access/page.tsx`, `components/graph/node-panel.tsx` | A switch "These tools can change data" in the toolset editor; a quiet grey "changes data" beside such a toolset (no accent colour); "all toolsets" reads "all read-only toolsets" |

How an admin adds a write, all in the console's MCP page: a second source with the write
account's `${VAR}` references, a tool whose statement is the `UPDATE` (or an `http` tool with
`method: POST`), a toolset marked as writing, "Build", restart the Toolbox, then the Access
page's switch for the role. `http` tools are authored in the page's YAML editor: the tool
dialog has no method or body fields and gains none in this round.

## Part 2 — ibl.ai credentials on the gateway

| File | Change |
|---|---|
| `backend/api/auth.py` | The DM lookup becomes `platform_member(scheme, token)` → `username, email, admin, member`: `token/verify`, then the caller's own `users/platforms/`. `member` = an active membership on a platform in `ONTOLOGY_ADMIN_PLATFORMS`. It raises its own two errors (rejected, platform silent) and keeps its verdict under a key that includes the scheme, so a key verified on the gateway is not a console sign-in. `DmTokenAuthentication` uses it; the console behaves as before |
| `backend/identity/role_source.py` | `roles_of(username)`: the platform's policies with `name=Ontology:` and `username=<u>`, kept when a policy is named after its own role. Empty when roles live in the local file |
| `backend/identity/middleware.py` | New `resolve_platform_request(scheme, token, role_header)`; behind `Bearer` it tries `Token`, then `Api-Token`. In the middleware itself one line changes: a `Bearer` token goes to the Entra validator only when it has exactly two dots, so a DM token or key behind `Bearer` falls through instead of being answered 401 |
| `backend/mcp_server/server.py` | `mcp_view` calls it when the middleware resolved nobody. In the view, not the middleware: the console's own `Token` requests cannot be touched, and it runs **after** the rate limiter (the middleware answers before the limiter counts, and a bad token behind `Bearer` costs the platform two lookups). The view also refuses `Token`/`Api-Token` over cleartext, as `Bearer` already is |
| `backend/ratelimit.py` | `_subject` counts a verified personal credential by itself and an unverified one by address, as it already does for the console's tokens |

Which role, and the refusals:

- An admin's header names any **defined** role (an unknown one is 403, not `default`); no
  header is `default`.
- A member's header must name a role they hold. No header is their only role (not counting
  `default`), else `default`.
- 401 a rejected credential (the message for an API key says it may be one limited to its
  own policies, which cannot be told apart); 403 not a member of this platform, or a role not
  held; 503 the platform silent.
- Personal credentials need the backend to know its platform (`IBLAI_ORG` or
  `ONTOLOGY_ADMIN_PLATFORMS`): with neither, "any platform's admin" would reach every role, so
  they are refused. No new environment variable.
- The audit and the rate limit see `ibl:<username>`, so a member named like the service
  account cannot share its row or its bucket.

**First step of this part, before any code:** mint an API key for the throwaway admin on the
dev DM and confirm it answers `users/platforms/` with its own platform. That is read from the
DM's code and was never exercised; if it differs, stop and tell rei.

## Part 3 — The role dialog

`frontend/components/roles/role-dialog.tsx`, rewritten around one `Role` draft and the grant
helpers the Access page already uses (`toggleGrant`, `cacheTables`, `cachesDomain`):

```
New role
Name                  [ Financial aid advisors ]     the only text field
                      Technical name: FinancialAidAdvisors
Tools                 All read-only toolsets  ·  one row per toolset ("3 tools";
                      "changes data" on a write toolset)            switches
Knowledge             one row per memory domain: Read · Query data  switches
Rows per cache query  [ 1,000 ▾ ]   100 / 1,000 / 10,000 / No limit
Can manage this console                                             switch
```

- A new role starts with every switch off and 1,000 rows. An existing role without a limit
  shows "No limit"; a stored value outside the list is shown as its own option. The limits
  are always sent whole: the backend replaces them as one, so an omitted "No limit" would
  never save.
- **A domain the role reads only in part is shown as "part of it", with its switch locked.**
  A self-service role reads only its own record (`…/by-id/${USER_EMPLID}.md`); as a plain
  switch, off and on again would grant the whole domain. Its paths are kept as they are.
- The technical name is derived from the name on create and shown as a caption. When a role
  already has it, or the name has no Latin letters to derive from, it gets a number
  (`Advisor2`, `Role1`): today a second "Advisor" silently overwrites the first.
- The dialog loads the map and the toolsets itself when it opens, so the Roles page and the
  Access page pass only the role names in use.
- Agents and the export limit stay stored and are not shown.
- `frontend/messages/en.json`: the `roles` keys follow (one locale; `scripts/check-i18n.mjs`
  checks every key).

## Docs

- `README.md` (for a CIO: no commands, variables, paths or "DM"): "It never writes to your
  systems" becomes reads by default, and changes only through operations your team defined,
  on an account it chose, for the roles it granted, each recorded. "Agents cannot send
  arbitrary SQL" stays true and stays.
- `docs/architecture.md`, `authorization-model.md`, `identity.md`, `platform-integration.md`,
  `read-only-db-user.md`, `deployment.md`, `components/01-mcp-inbound.md`, `03-identity.md`,
  `04-mcp-outbound.md`, `DEV.md`, `CHANGELOG.md`: the write toolset and its example, that the
  toolsets root means the read-only ones (the platform's own RBAC reads it as all), the four
  kinds of credential and how a person is given a role (added to the policy
  `Ontology: <role>` in the platform), the enforced row limit.

## Tests: written with the code, run only on rei's word

- Backend: `tests/test_toolbox_compat.py`, `test_toolbox_config.py`, `test_repo_config.py`
  (no stock tool writes), `test_mcp_gateway.py`, `test_gateway_exposure.py` (the exact
  `tools/list` shape changes; the four credentials), `test_gateway_extras.py` (row cap),
  `test_sync.py`, `test_rate_limit.py`, `test_dm_config.py` (`*` beside a name; `roles_of`;
  `FakeDm` gains policy members and the `username` filter), `test_api.py`, `test_identity.py`,
  `test_graph.py`, `test_cli.py`.
- Console: `lib/ontology/graph.test.ts`, `mock/handlers.test.ts`, journeys `02-roles`,
  `04-mcp`, `05-access` (they fill "Name" and "Display name" today).
- What changes is formatted (`ruff format`, `oxfmt`); no suite is run. When the code is in,
  the runs are named (`python -m pytest`, `pnpm typecheck`, `lint`, `test`, `test:e2e`) and
  wait for rei.

## Touch test, on the stack that is still running

1. **Dialog**: in rei's tab on `localhost:3310`: create a role with the name only, flip rows,
   confirm the platform's policy, that the gateway returns at most the chosen rows, and (by
   measuring) that the rows start and the switches end on one line each.
2. **Writes**: two throwaway containers on 127.0.0.1, a Postgres 16 with a read account and a
   write account, and MCP Toolbox 1.5.0 (pulled if the image is absent), plus a 20-line local
   HTTP receiver for the API half. Then: a write tool in an unmarked toolset is refused at
   save; `Executive` (`*`) cannot call it; a role granted the toolset by name changes the row;
   the audit rows carry the arguments; the Test button and a schedule both refuse; the POST
   arrives with its body; `*` beside a name survives a round trip through the platform.
3. **Credentials**: the member added to `Ontology: Advisor` on the dev DM; then `Token`,
   `Api-Token` and `Bearer` of each against `/mcp`: the role each gets, the header's limits,
   the non-member's 403, and the console still signing in as before.

## Not in this round

- An approval queue for writes; free-form SQL; method and body fields in the tool dialog.
- API keys limited to their own policies; self-service roles for DM users (the identity map
  is keyed by Entra id).
- A console page for who holds a role: people are added in the platform's RBAC screens.
- Console access by role for people who sign in with ibl.ai. Today the console is for platform
  admins whatever a role says, so "Can manage this console" decides it only under Microsoft
  Entra sign-in; under ibl.ai sign-in the switch only lets the role's agents read the sync
  status. Open for rei: whether the switch should mean the same for both.
- Found and left: approving a service still merges tools unvalidated (the gateway's guard
  covers it); on the Access page, switching one cached domain off for a role that holds every
  table drops its tables that belong to no domain (`audit_log`, `sync_runs`).

## Still open from the roles touch test

The stack stays up for the touch test above. Cleanup is rei's call: five processes,
`web-live`, `axd_redis`, the platform `onto-touch`, the three migrations, the scratch
directory, and a note to the DM session.

## Hand-over

A knowledge-base entry (write toolsets, the credential lookup, what the DM answers an API
key), its index line in the two `CLAUDE.local.md` files, `CLAUDE.md` lines proposed and not
written, and a commit message when rei asks.
