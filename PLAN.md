# Ontology console revamp: make it work

## Context

`ontology.ibl.ai/revamp` (branch `revamp`, HEAD `e1f8130`, both commits by Miguel Amigot,
2026-11-16) is a Next.js 16 console. SSO and the shell menus are real; every ontology page still
renders `frontend/lib/mock.ts` or literals, and most page controls are dead or fake. `docs/plan.md`
step 1 (auth) is done; steps 2–5 are not.

rei's request: make the buttons work (the main point is that it works); follow `docs/plan.md`
roughly; add nothing to the data layer and no Python backend; keep the NVIDIA auto-ontology docker
stack; use TypeScript / npm where the old version used Python packages; lean on the knowledge
base; move `frontend/` to the repo root; add the ox tools; **use parallel subagents as much as
possible, without losing quality**.

## Decisions (rei, 2026-11-16)

| Fork         | Chosen                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain    | full house toolchain: oxlint + oxfmt + TypeScript 7 + vitest, pnpm 12, Node 26                                                                                                                                                         |
| i18n         | deferred: inline English stays, new strings inline too                                                                                                                                                                                 |
| Checks       | static only, once, after everything is written. No containers, dev server or browser                                                                                                                                                   |
| Commit point | pause after the move + toolchain + one-time reformat; continue on rei's word                                                                                                                                                           |
| Execution    | parallel subagents wherever files are independent; quality kept by contracts first, independent reviewers, then the static checks                                                                                                      |
| Look         | the mocked pages are the target: live data fills the shapes `lib/mock.ts` gives the pages, every section the mock shows stays, generated names read like the mock's, and a value with no real source shows “—”, never a made-up number |

KB rule for this product (three sessions): write the thing asked for and every step after it, run
nothing in between, then say what is unverified. Only `pnpm install` and `oxfmt` run before the
static checks, because they produce the lockfile and the formatted files. Subagents run nothing.

## Shape

```
browser ── Token <dm_token> ──► ibl.ai DM        SDK hooks (MCP servers, RBAC, API keys, agents)
browser ── Token <dm_token> ──► /api/host/*      stateless Next route handlers, Node runtime
                                  ├ ao/[...path] → auto-ontology /api/* with x-api-key
                                  ├ systems,apis → engine connection / apis.yaml + secrets in env
                                  ├ toolsets     → generated from certified terms
                                  └ servers/*    → $ONTOLOGY_HOME/servers/<slug>/ + one Toolbox process
agents ── Api-Token | Token | Bearer ──► /<slug>/mcp   gateway: https → origin → grants → scope → Toolbox
```

No database and no ibl.ai secret on the host. Disk holds only what Toolbox needs, under
`$ONTOLOGY_HOME` (default `.ontology`, git-ignored): `env` (0600), `apis.yaml`,
`servers/<slug>/{tools.yaml, flags.json, revisions/, pid, toolbox.log, gateway.log}`.

### Where each thing is saved

| Thing                                                            | Saved in                                                                                             | Notes                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connected database systems                                       | auto-ontology's own Postgres (the `postgres` service of its compose stack, database `auto_ontology`) | the whole connection, password included, as unencrypted JSON on the catalog row; with its four `VAULT_*` variables set, credentials go to Vault instead (`auto-ontology/docs/connections.md:28-34`) |
| The same database password, for serving                          | `$ONTOLOGY_HOME/env` on the host, mode 0600                                                          | Toolbox needs it to run tools, and auto-ontology never gives a password back                                                                                                                        |
| Custom HTTP APIs                                                 | `$ONTOLOGY_HOME/apis.yaml`; the key in `env`                                                         | a file, as Toolbox reads it; auto-ontology does not take APIs                                                                                                                                       |
| Terms, tables, joins, tags, certification                        | auto-ontology's Postgres + pgvector                                                                  | its semantic layer                                                                                                                                                                                  |
| MCP servers (config, flags, revisions)                           | `$ONTOLOGY_HOME/servers/<slug>/`                                                                     | files; the process list is the pid files                                                                                                                                                            |
| Tool calls and refusals the gateway saw                          | `$ONTOLOGY_HOME/servers/<slug>/gateway.log`                                                          | a log beside Toolbox's own; the Runtime Log, the call counters and the Activity table read it                                                                                                       |
| Roles and policies, API keys, the server registered for an agent | ibl.ai (the DM's database)                                                                           | written from the browser with the admin's own session                                                                                                                                               |

### Verified logic to port (`ontology.ibl.ai/main2`, Python → TypeScript)

| What                                                                                                                                                                                                                                                                       | Source in `main2/src/iblai_ontology/backend/`                      | Goes to                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Caller's grants: `GET {dm}/v1/rbac/permissions/?resource_paths=/custom/ontology/&recursive=true`, headers `Authorization: <scheme> <cred>` + `iblai-org: <platform>`. 5xx / 429 = silent (503, never cached); other non-200 = refused with the platform's words; kept 60 s | `api/auth.py:172-214`, `settings.py:275`                           | `lib/host/dm.ts`                             |
| `Bearer` tried as `Token`, then `Api-Token`                                                                                                                                                                                                                                | `identity/middleware.py:172-191`                                   | `lib/host/dm.ts`                             |
| Resources `/custom/ontology/{toolsets,tools,console}/…`, counted only with the kind's verb; the root covers all                                                                                                                                                            | `identity/role_source.py:26-36,129-135,212-235`                    | `lib/host/grants.ts`                         |
| Role = platform role holding `Ontology/*` + one policy `Ontology: <role>`                                                                                                                                                                                                  | `identity/role_source.py:339-420`                                  | `lib/ibl-flows.ts`                           |
| Scope: `*` lends every read toolset; a write toolset only by name                                                                                                                                                                                                          | `mcp_server/toolsets.py:50-81`                                     | `lib/host/mcp.ts`                            |
| JSON-RPC: `initialize` echoes the client's version (default `2025-03-26`), `ping`, `tools/list`, `tools/call`; notifications → 202; unknown method `-32601`; out of scope `-32003`; Toolbox error `-32000`; any other failure → `isError` result                           | `mcp_server/handlers.py:577-623`, `server.py:68-145`               | `lib/host/mcp.ts`, `app/[slug]/mcp/route.ts` |
| “Does it write?”: both regexes, `http` reads only on GET/HEAD, `-execute-sql` and `templateParameters` write, a source shared with a writer writes; a read toolset may hold no writer                                                                                      | `mcp_server/toolbox_compat.py:61-132,161-269`                      | `lib/host/toolbox-config.ts`                 |
| Literal secrets refused (`_SECRET_KEY_RE`, `_ENV_REF_RE`)                                                                                                                                                                                                                  | `toolbox_compat.py:273-292`, `config/reader.py:15-18`              | `lib/host/toolbox-config.ts`                 |
| Proof a config is live: an empty toolset `loaded-<sha12>` that Toolbox answers for only after loading that file                                                                                                                                                            | `mcp_server/toolbox_config.py:139-164`, `toolbox_client.py:96-122` | `lib/host/toolbox.ts` (also the revision id) |
| Custom HTTP API: address rules, `-reads` / `-writes` sources and toolsets, endpoint rules, tool document                                                                                                                                                                   | `services/http_api.py:21-28,53-104,141-157,247-357`                | `lib/host/apis.ts`                           |
| Engine reads and error wording                                                                                                                                                                                                                                             | `services/auto_ontology.py:63-105,120-187`                         | `lib/host/ao.ts`                             |
| Agent connection: policy-limited API key → MCP server `auth_type:"none"`, `credentials:"Api-Token <key>"`, `mentor` → `PUT mentors/<id>/settings/` with `tool_slugs ∪ {"mcp"}`, `mcp_servers ∪ {id}`; undo in reverse                                                      | `platform/agents.py:73-158`, `platform/client.py:129-246`          | `lib/ibl-flows.ts`                           |
| Rate limit: 120 requests / 60 s, 30 `tools/call` / 60 s per caller                                                                                                                                                                                                         | `ratelimit.py`, `settings.py:186-193`                              | `lib/host/mcp.ts` (per process)              |

TypeScript already written in the old console, reused where it fits:
`main2/frontend/lib/ontology/server/backend.ts` (`isPublicAddress`),
`main2/frontend/app/api/ontology/[...path]/route.ts` (forward, relay, 502 on no answer).

### Engines (unchanged, external)

- **auto-ontology**: its compose stack, reached only through its Next API with a service key
  (`auto_ontology_…`, minted once in its UI under API Tokens by an admin). Creating a connection
  starts ingest; `PUT /api/configurations/semantic-compilation {enabled:true}` starts compile;
  status is `GET /api/semantic-compilation/status`. Ports 3001 / 3002 are never called.
  `deploy/auto-ontology.override.yml` moves its web port to `127.0.0.1:3100` (it is hard-coded to
  3000, the console's) and binds the rest to loopback.
- **Toolbox**: `@toolbox-sdk/server@1.16.0` from npm (bundled binary; `TOOLBOX_BIN` overrides),
  started with `--config`, `--address 127.0.0.1`, `--port`, `--allowed-origins`, `--allowed-hosts`,
  `--disable-version-check`; ready when `GET /healthz` answers. It does not reject a foreign
  `Origin`, so the gateway does.

## Phase 1 — move to the root, house toolchain, then pause (me, alone)

1. `git mv` every tracked file in `frontend/` to the root (stages renames only, no commit). Untracked
   files there (an `.env.local`, if any) are moved unread; `node_modules` and `.next` are removed
   and rebuilt. Merge the two `README.md` and `.gitignore` files (`frontend/.gitignore` is the
   superset; add `.ontology/`).
2. Fix the hard-coded paths: `README.md`, `docs/plan.md:3,53`, `docs/network.md:76`,
   `docs/console.md:46`, `docs/auth.md:106-113`, `.claude/launch.json:7`, `scripts/screenshots.mjs:8`.
3. Copy the old console's toolchain files unchanged from `ontology.ibl.ai/main2/frontend/`:
   `.oxlintrc.json`, `.oxfmtrc.json`, `.tool-versions`, `pnpm-workspace.yaml`, `tsconfig.json`,
   `vitest.config.ts`.
4. `package.json`: name `ontology-console`; scripts `typecheck` (`tsc --noEmit`), `lint`
   (`oxlint --max-warnings 0`), `format`, `format:check`, `test` (`vitest run`);
   `packageManager: pnpm@12.18.0`; add `oxlint ^1.92.0`, `oxfmt ^0.77.0`, `typescript ^7.0.2`,
   `vitest 5.1.0`, `@types/node ^26`; remove `eslint`, `eslint-config-next`, `eslint.config.mjs`.
5. `next.config.ts`: drop the `webpack` function and its dedupe alias (KB: it fails `next build`
   under Turbopack; `dedupePeerDependents` + `publicHoistPattern` replace it). Nothing else changes.
6. `pnpm install` with the pinned pnpm 12 binary (KB: a pnpm-10 shell writes an incomplete
   lockfile), then `oxfmt` twice (KB: not idempotent in one pass).

**Pause.** Report what moved. Suggested message:
`chore: move the console to the repo root and adopt the oxlint/oxfmt toolchain`.
Lint is not expected to be green yet: `react/no-danger` fires on the Map's scripted log, which the
build removes.

## Phase 2 — contracts (me, alone)

The parallel build is only as good as the seams between agents, so the seams are written first,
as code rather than prose:

- `lib/host/types.ts`: every payload that crosses `/api/host/*` (systems, APIs, toolsets, server
  summary and detail, flags, process status, log tail).
- A typed skeleton of every module below — the exported names and signatures, bodies not yet
  written — for `lib/host/*`, `lib/host-api.ts`, `lib/data.ts` and `lib/ibl-flows.ts`. The view
  shapes are the ones the pages already render from `lib/mock.ts`, plus the few fields real data adds.
- Add the two runtime dependencies (`yaml`, `@toolbox-sdk/server@1.16.0`) and install once, so no
  agent touches `package.json` or the lockfile.
- `.gitignore`: `.ontology/`.

## Phase 3 — build, in parallel

Fourteen `general-purpose` agents in the same working tree, launched together. Each owns a
disjoint set of files and codes against the Phase 2 skeletons.

| Agent           | Owns                                                                                                                  | Ports / builds                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| H1 host core    | `lib/host/{env,dm,grants,guard,files,address}.ts` + tests                                                             | verification, grants, platform binding, slug and path safety, address rule                                          |
| H2 toolbox      | `lib/host/{toolbox-config,toolbox,apis}.ts` + tests                                                                   | config generation and mark, write detection, secret refusal, API endpoint rules, process supervision                |
| H3 gateway      | `lib/host/{mcp,semantic}.ts`, `app/[slug]/mcp/route.ts` + tests                                                       | JSON-RPC, scope, rate limit, secret masking, cleartext and origin checks, the three engine-backed tools             |
| H4 routes       | `lib/host/ao.ts`, `app/api/host/**` + tests                                                                           | engine proxy with allow-list; systems, apis, toolsets, servers (preview, process, log, rollback)                    |
| C1 data layer   | `lib/host-api.ts`, `lib/data.ts`, `lib/view/*`, `store/iblai-store.ts`, `lib/mock.ts` (palette type only) + tests     | RTK Query for the host, one hook per view, adapters, demo fixtures, stage derivation                                |
| C2 ibl.ai flows | `lib/ibl-flows.ts` + tests                                                                                            | ensure role + policy per toolset, issue and revoke keys, attach and detach an agent with undo, list attached agents |
| P1              | `app/(app)/systems/page.tsx`                                                                                          | Systems                                                                                                             |
| P2              | `app/(app)/map/page.tsx`, `components/graph/ontology-graph.tsx`                                                       | Map and graph                                                                                                       |
| P3              | `app/(app)/ontology/page.tsx`                                                                                         | Ontology                                                                                                            |
| P4              | `app/(app)/mcp/new/page.tsx`                                                                                          | server builder                                                                                                      |
| P5              | `app/(app)/mcp/[slug]/page.tsx`, `components/attach-dialog.tsx`                                                       | server page, attach dialog                                                                                          |
| P6              | `app/(app)/{dashboard,mcp,agents}/page.tsx`, `components/shell/sidebar.tsx` (counts only)                             | lists and counters                                                                                                  |
| P7              | `app/(app)/{roles,access,catalog,sync,config}/page.tsx`                                                               | the five list pages                                                                                                 |
| D1              | `docs/**`, `README.md`, `.env.example`, `deploy/auto-ontology.override.yml`, `lib/iblai/config.ts` (`apiKey` removal) | docs corrections and local-stack notes                                                                              |

Rules given to every build agent:

- edit only the files it owns; code against the skeletons and report a seam that does not fit
  instead of changing it
- port from the cited `path:line`, and say where it had to guess
- run nothing: no install, typecheck, test, formatter, dev server, container or git command
- house rules: one-line comments, “platform” never “tenant” in anything a user reads, typographic
  `’` and `…`, match the surrounding page's visual language, no new dependency, loud failure over
  silent fallback, never print or read a secret
- re-read its own files against the brief before reporting; return files written, decisions,
  guesses and open questions

### What the host agents build

| File                         | Responsibility                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/host/env.ts`            | `ONTOLOGY_HOME`, `AO_URL`, `AO_API_KEY`, `TOOLBOX_BIN`; platform = `NEXT_PUBLIC_MAIN_TENANT_KEY`. A missing value answers 503 naming it                                                 |
| `lib/host/dm.ts`             | `grantsFor(scheme, credential)`, `resolveCaller(authorization)`; cache keyed by sha256 of the credential                                                                                |
| `lib/host/grants.ts`         | pure: grants map → `{ allToolsets, toolsets, tools, console }`                                                                                                                          |
| `lib/host/guard.ts`          | `requireConsole(request)`, first line of every `/api/host/*` handler: `Token` only, needs the console grant; the platform is bound by `iblai-org`, so another platform's admin gets 403 |
| `lib/host/files.ts`          | slug rule (and reserved names), safe join under `ONTOLOGY_HOME`, atomic write, `env` read / write at 0600                                                                               |
| `lib/host/address.ts`        | `isPublicAddress` (reused) + the old API address rule                                                                                                                                   |
| `lib/host/ao.ts`             | `aoFetch()` with the service key; method + path allow-list; the engine's errors in its own words                                                                                        |
| `lib/host/apis.ts`           | pure: custom API → sources, toolsets, tool documents; endpoint validation                                                                                                               |
| `lib/host/toolbox-config.ts` | pure: sources / tools / toolsets → `tools.yaml` text + `loaded-` mark; write detection; validation; refuses literal secrets                                                             |
| `lib/host/toolbox.ts`        | start / stop / status / `ensureRunning` / `confirmLoaded` / log tail; pid, port and log on disk, so a `next dev` reload or a restart re-adopts a running process                        |
| `lib/host/mcp.ts`            | JSON-RPC handling, scope, rate limit, masking of any `env` secret in a result                                                                                                           |
| `lib/host/semantic.ts`       | `search_terms`, `describe_table`, `ask_question`, served from the engine's REST (its own MCP server takes only OAuth tokens it issued)                                                  |

Gateway `app/[slug]/mcp/route.ts`: POST; OPTIONS for preflight; 405 otherwise; a credential over
cleartext is refused unless loopback or `X-Forwarded-Proto: https`.

Tool generation (new: the old product took tools from an LLM, so there is no generator to port):

- one Toolbox source per engine connection both sides support (postgres, mysql, clickhouse,
  snowflake), password as `${<NAME>_DB_PASSWORD}` from `env`; other engines are refused by name
- one tool per **certified** SQL attribute, running its certified SQL (read-only or refused), and
  one `list_<term>` per certified term over its backing table with a row limit
- a custom API's key is referenced as `${<NAME>_API_KEY}` in its source's `headers` and read by
  Toolbox from `env`, like a database password (the old gateway added it per call from its own
  database, which this host does not have)
- toolsets: one per system, one per engine tag, `<system>-raw` (execute-sql: a write by the ported
  rule, so granted by name only), `<api>-reads` / `<api>-writes`, `semantic`; a hand-written
  `actions.yaml` is merged when present

Request bodies are validated by the ported regex rules, so no schema library.

### What the client agents build

- `lib/host-api.ts`: one RTK Query `createApi` for `/api/host/*` (`Authorization: Token <dm_token>`
  in `prepareHeaders`), mounted in the store; polling for compile status.
- `lib/data.ts`: one hook per view returning the shapes the pages already render, through small
  pure adapters. Demo mode (`NEXT_PUBLIC_DEMO=1`) returns the existing `lib/mock.ts` fixtures, so
  `scripts/screenshots.mjs` and `scripts/audit-layout.mjs` keep working; live mode never reads
  them, and a demo-mode write shows a notice.
- `lib/ibl-flows.ts`: the ibl.ai writes, through the SDK's own endpoints (`mcpApiSlice`,
  `coreApiSlice` and the RBAC and API-key endpoints already in `@iblai/iblai-js`); any slice they
  need is mounted in the store.
- Loading uses the existing `components/loading-screen.tsx`; a failed query shows the server's own
  message and a Retry.

### What the page agents build

| Route                  | Becomes                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| systems                | list from engine connections; filter and catalog as today. Database form submits for real (name, URL, schema scope chips, PII and probing switches): **Test Connection** → engine test; **Connect & Dissect** → password to `env`, create the connection, open the Map. HTTP API tab: base URL, OpenAPI document with **Fetch Spec**, auth header, endpoints ticked or named by hand, **Add & Expose**. Prebuilt tab: the ticked raw toolsets open the builder already ticked |
| map                    | graph and inspector from the engine's two graphs; the six stages derived from engine state (tables, columns, terms, links, compile finished; publishing runs nothing, so it ends with the compile); the log lists status changes actually observed; **Re-run** triggers compile; **Certify** patches the term; **Open Term** opens that term                                                                                                                                  |
| ontology               | tree items select; detail from the term, its column and SQL attributes, links and tags; **Edit** saves name and description; certify toggles; real counts; “+ N more” expands                                                                                                                                                                                                                                                                                                 |
| mcp/new                | toolsets from `/api/host/toolsets`; live `tools.yaml` preview and **Copy**; origins and hosts saved; OIDC options write auth services; **Save Draft** writes without starting; **Deploy** writes, starts, confirms the mark, opens the new server; **Issue Token** ensures a role + policy per chosen toolset and creates a key limited to them, shown once with Copy. `?slug=` loads a server for **Edit Server**                                                            |
| mcp/[slug]             | the real server, or a 404 instead of the first mock; **Roll Back** restores the previous revision; **Attach** (agent + toolsets dialog); Playground lists the caller's tools and **Run** calls the gateway with the session; runtime log tail; tokens with **Revoke**                                                                                                                                                                                                         |
| mcp, dashboard, agents | real lists and counters; **Attach a Server to an Agent** opens the same dialog                                                                                                                                                                                                                                                                                                                                                                                                |
| roles, access          | read-only views of the `Ontology:` policies, their toolsets, holders and connected agents                                                                                                                                                                                                                                                                                                                                                                                     |
| catalog                | databases → schemas → tables → columns, with tags and terms                                                                                                                                                                                                                                                                                                                                                                                                                   |
| sync (Compilation)     | status, the three engine switches, **Run now**                                                                                                                                                                                                                                                                                                                                                                                                                                |
| config                 | each server's files and revisions; **Export model** download                                                                                                                                                                                                                                                                                                                                                                                                                  |
| sidebar                | real counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The mock is the target look, so its controls stay and are made real:

- **Fetch Spec** and the OpenAPI field: the host fetches the document under the same address rule
  as the API's base URL (no redirects, size and time capped) and lists its operations as endpoints
  to tick
- the Prebuilt tab's checkboxes: the ticked raw toolsets open the builder already ticked
- call counters, sparklines, the Activity table and the Runtime Log read the gateway's own log,
  written in the mock's line format; a value with no source at all shows “—”

One control goes: synonym “+ add”. The engine's `PATCH /terms/{id}` writes name, description,
certification and owner only (auto-ontology@22e22c89, `update_term` in `server/terms/router.py`);
the synonyms themselves still render.

### What the docs agent writes

- Corrections for what cannot work as written: engine endpoint names and the `POST`, admin-only
  export (`plan.md:17`, `data-sources.md`); policy ↔ toolset (`guides/permissions.md` §1, now grants
  under `/custom/ontology/toolsets/<name>/`); the host secret and `Bearer` (`auth.md` §6,
  `network.md`); ports; `plan.md:19`; **Deploy** no longer registers on ibl.ai (attaching an agent
  does, per agent, as verified on production); the Map log and the three removed controls in
  `console.md`.
- `.env.example`: add `AO_URL`, `AO_API_KEY`, `ONTOLOGY_HOME`, `TOOLBOX_BIN`, `NEXT_PUBLIC_APP_URL`;
  remove `IBLAI_API_KEY` and the unused `config.apiKey()` (apps on the SDK hold no platform secret).
- README: root layout; running the engines locally (override file, minting the engine key).

## Phase 4 — review, in parallel, then fix

Four read-only reviewers with fresh context, launched together. Each is given the code and the
sources, not my conclusions, and returns findings with `file:line` and a concrete failure case.

| Reviewer         | Reads                                                                                         | Looks for                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 security      | `lib/host/**`, `app/api/host/**`, `app/[slug]/mcp/route.ts`                                   | a handler without the guard, platform not bound, path traversal, open proxy, a secret in a response or log, origin or cleartext gaps, a write toolset reachable without its name |
| R2 port fidelity | the same files beside the cited Python                                                        | any rule that drifted from the verified logic (regexes, status handling, cache, scope, error shapes)                                                                             |
| R3 seams         | `lib/host/types.ts`, routes, `lib/host-api.ts`, `lib/data.ts`, `lib/ibl-flows.ts`, every page | a shape, name or status that one side sends and the other does not expect; a hook used wrongly                                                                                   |
| R4 controls      | every page and shell file                                                                     | the control inventory again: any control still dead or pretending, any mock read in live mode, “tenant” in user-visible text, long comments                                      |

I fix what they find, or hand a finding back to a fix agent scoped to the owning files when
several are independent. Findings I reject are listed with the reason.

## Phase 5 — static checks (me, alone)

Run once, after the fixes: `tsc --noEmit`, `node_modules/.bin/oxlint --max-warnings 0 .` (the
binary: the shell hook rewrites `pnpm lint` and hides findings), `oxfmt --check`, `vitest run`,
`next build`, then `pnpm format` again (the build rewrites `tsconfig.json`). Fix what they find and
report their output as it is.

## Phase 6 — hand over

Say plainly what is **unverified**, which is every live path: ibl.ai reads and writes through the
SDK, the engine's API shapes (read from source, never called), Toolbox start / reload / the mark,
the gateway with a real agent, the compose override. No e2e is written or run in this pass, so by
the workspace rule the feature is not “done” until rei's touch test.

Write the KB entry under `ontology.ibl.ai/<timestamp>-revamp-host-layer/` (after reading
`$KB/README.md`) and add its one line to `CLAUDE.local.md`; propose any `CLAUDE.md` line instead
of writing it. No commit.

## Not in this pass

- i18n (deferred by decision), e2e journeys, a CI workflow
- replacing Miguel's hand-rolled shell with the SDK sidebar (a standing requirement, outside this ask)
- authoring write tools in the UI (a hand-written `actions.yaml` is honoured)
- ibl.ai-side call analytics (the user and session behind a call): no verified endpoint in the KB;
  the gateway's log gives tool, agent, time and result, and those two columns show “—”

## Build brief (every Phase 3 agent reads this; it overrides the Phase 3 text above)

You are one of sixteen agents building this console in parallel, in one working tree. Each owns a
disjoint set of files. The seams between you are already written as typed code, and nobody will
run anything until all of you are done, so your work is judged by whether it fits those seams
exactly and is correct as written.

### Where things are

- Repo root: `/home/rei/Projects/work/ibl.ai/ontology.ibl.ai/revamp`. Use absolute paths; your
  shell may start in another directory.
- This Next.js (16.4.6) has breaking changes. Before writing a route handler or a page, read the
  relevant guide under `node_modules/next/dist/docs/` (see `AGENTS.md`).
- Contracts, which you code against and never edit: `lib/host/types.ts` (every payload of
  `/api/host/*`), `lib/ao-types.ts` (the engine's API shapes), `lib/view/types.ts` (what pages
  render), `lib/ontology-rbac.ts`, `lib/host/errors.ts`, and the files marked `SKELETON`
  (`lib/host/*.ts`, `lib/data.ts`, `lib/ibl-flows.ts`): their exported names, signatures and doc
  comments are the contract; the owner replaces the bodies and deletes the `SKELETON` line.
- The old product to port from (Python, proven in production, read-only):
  `/home/rei/Projects/work/ibl.ai/ontology.ibl.ai/main2/src/iblai_ontology/backend/`.
- The engine's source (read-only): `/home/rei/Projects/src/github/NVIDIA/auto-ontology` at
  `22e22c89`. The runtime: `node_modules/@toolbox-sdk/server` 1.16.0 and its platform package.

### Decisions made while writing the contracts

- A system's name is its database's name: the engine keys a connection by `connection.database`.
- The engine gives no row counts, no primary keys and no ingest status over HTTP. Rows show “—”,
  a key column is the one other tables' foreign keys point at, and a system is “ingesting” until
  its tables appear.
- The host reads the engine once per page load (`lib/host/reading.ts`, kept a few seconds) and
  serves `/api/host/systems`, `/api/host/graph` and `/api/host/toolsets` from that reading. The
  browser reaches the engine directly (through `/api/host/ao`) only for one term's detail, one
  table's columns, the switches, the status and the writes.
- A compile starts with `PUT /api/configurations/semantic-compilation {enabled:true}`; an ingest
  never starts one.
- The semantic toolset (`ask_question`, `search_terms`, `describe_table`) is served by the gateway
  itself and has no document in `tools.yaml`.
- Roles on ibl.ai: one platform role per toolset (named after it, holding `Ontology/*`) with one
  policy `Ontology: <toolset>` granting `/custom/ontology/toolsets/<toolset>/`. A key or an agent
  limited to several toolsets carries several policies.
- A toolset that holds a tool that writes is reached only by name; `allToolsets` and a platform
  admin reach every toolset that only reads. The raw toolsets count as writing.

### Who owns what

| Agent             | Owns                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| H1 host core      | `lib/host/{env,dm,grants,guard,files,address}.ts`                                                                      |
| H2 runtime config | `lib/host/{toolbox-config,apis}.ts`                                                                                    |
| H3 gateway        | `lib/host/{mcp,semantic,log}.ts`, `app/[slug]/mcp/route.ts`                                                            |
| H4 routes         | `lib/host/ao.ts`, everything under `app/api/host/`                                                                     |
| H5 generator      | `lib/host/{reading,toolsets}.ts`                                                                                       |
| H6 process        | `lib/host/{toolbox,servers}.ts`                                                                                        |
| C1 data           | `lib/host-api.ts`, `lib/data.ts`, `lib/view/*` except `types.ts`, `store/iblai-store.ts`, `lib/mock.ts`                |
| C2 ibl.ai flows   | `lib/ibl-flows.ts`                                                                                                     |
| P1                | `app/(app)/systems/page.tsx`                                                                                           |
| P2                | `app/(app)/map/page.tsx`, `components/graph/ontology-graph.tsx`                                                        |
| P3                | `app/(app)/ontology/page.tsx`                                                                                          |
| P4                | `app/(app)/mcp/new/page.tsx`                                                                                           |
| P5                | `app/(app)/mcp/[slug]/page.tsx`, `components/attach-dialog.tsx`                                                        |
| P6                | `app/(app)/{dashboard,mcp,agents}/page.tsx`, `components/shell/sidebar.tsx` (the badges only)                          |
| P7                | `app/(app)/{roles,access,catalog,sync,config}/page.tsx`, `components/shell/stub-page.tsx`                              |
| D1                | `docs/**`, `README.md`, `.env.example`, `deploy/auto-ontology.override.yml`, `lib/iblai/config.ts` (removing `apiKey`) |

Tests sit beside what they test as `lib/**/<name>.test.ts` and belong to that file's owner.

### Rules

1. Edit only the files you own. If a seam does not fit, do not change it: build against it as
   best you can and report the misfit.
2. Run nothing: no install, typecheck, lint, test, formatter, build, dev server, container,
   browser, or git command that changes anything. Reading is fine (`rg`, `ls`, files,
   `git show HEAD:<path>` for a file as committed).
3. The Read tool here can replace function bodies with an “elided” comment. For exact text use
   Bash: `rtk read -n <file>`, with `| sed -n 'A,Bp'` for a range. A Bash hook rewrites `rg`, `ls`
   and `cat` to `rtk …`; if a call bounces with “a hook changed this call's input”, re-issue
   exactly the command it quotes. Use `rg`, never `grep -r`; `rg` skips `node_modules` unless
   given `--no-ignore`.
4. Never open `.env`, `.env.local` or anything under `.ontology/`. Never print, log or return a
   secret. `.env.example` is fine.
5. Style: strict TypeScript, 2-space indent, double quotes, trailing commas, lines up to 100
   columns. Comments are one line and say why. No new dependency. No `any` unless the SDK forces
   it. The linter treats `dangerouslySetInnerHTML` as an error.
6. Words a user reads: “platform”, never “tenant” (SDK identifiers keep their names); typographic
   `’` and `…`; the page's existing tone and case.
7. Fail loudly: a blocked or failed operation shows or returns the real reason, in the other
   system's own words. Never fake success and never fall back silently.
8. The mocked pages are the target look. Keep every section, component and class name a page has
   today; only the data source and the dead controls change. Nothing new may compete for
   attention: no new accent colours, no banners that were not there. In demo mode
   (`NEXT_PUBLIC_DEMO=1`) every page must render exactly what the mocked build rendered.
9. Tests: vitest, node environment, pure logic only. No test may need a network, a process, the
   engine or the runtime.
10. Before reporting, re-read every file you wrote against your brief and the contracts.

### What to report

Your final message, at most 60 lines: the files you wrote; decisions another agent might trip
on; every place you guessed, with what would prove it; seams that did not fit; anything left
undone. No tour of the code.

## Several platforms on one host (2026-11-17)

One host now serves several ibl.ai platforms. Where earlier text differs, this section wins: the
Shape diagram's `/<slug>/mcp`, the disk layout under `$ONTOLOGY_HOME`, and
“platform = `NEXT_PUBLIC_MAIN_TENANT_KEY`” in `lib/host/env.ts`. None of it has been run yet.

1. **No platform is pinned.** `NEXT_PUBLIC_MAIN_TENANT_KEY` is gone from the env and the console
   keeps no `app_tenant`. The platform is the one the ibl.ai sign-in is for (`current_tenant`, an
   object, and `tenant`, its key, in localStorage). Sign-in without a platform lets ibl.ai pick the
   user's own; the header's platform menu lists the user's platforms and switches with the SDK's
   own platform switch.
2. **Every call to `/api/host/*` names its platform**: the user's ibl.ai token plus
   `x-ontology-platform: <platform key>`. The host asks ibl.ai for the caller's grants with
   `iblai-org: <that platform>`; ibl.ai refuses unless the token belongs to it. The console stays
   open to that platform's admins and holders of the console grant.
3. **Everything on disk is per platform**:
   ```
   $ONTOLOGY_HOME/
     engine-platform                 the platform the host's own engine serves
     platforms/<platform>/
       engine.json                   optional: this platform's own engine, {"url": "...", "key": "..."}
       env                           mode 0600: database passwords and API keys the runtime reads
       apis.yaml, actions.yaml
       servers/<slug>/               tools.yaml, flags.json, revisions/, pid, toolbox.log, gateway.log
   ```
   The folder is the platform's key, with a character outside `a-z 0-9 - _` written as `~<hex>~`.
   Two platforms can each have a server named `advising`.
4. **Agents call `https://<host>/<platform>/<slug>/mcp`.** Their credential (an ibl.ai API key or
   token) must belong to that platform; ibl.ai confirms it on every call, as before.
5. **One engine per platform**, because the engine has no notion of platforms. A platform's engine
   is `platforms/<platform>/engine.json` when the operator wrote one; otherwise the host's own
   (`AO_URL`, `AO_API_KEY`), which serves only the first platform whose console admin uses the
   host, recorded in `$ONTOLOGY_HOME/engine-platform`. Any other platform gets a `503` saying the
   host's engine serves another platform and that the operator connects one by writing its
   `engine.json`. A host for one platform needs nothing new; a host for several needs one engine
   stack and one `engine.json` per platform.

## The pages on Vercel, the server on the client's machine (2026-11-17)

The server half (`/api/host/*`, the MCP gateway, Toolbox processes, files under `$ONTOLOGY_HOME`)
needs a lasting disk and long-running processes, and SQL tools connect from wherever Toolbox runs,
so it cannot live on Vercel. It moves to the client's own server, beside the engine. Where earlier
text differs, this section wins for the hosted shape; the one-host mode keeps everything above.
None of it has been run yet.

1. **One codebase, three modes.**

   | Mode     | Setting                                  | Behaviour                                                                   |
   | -------- | ---------------------------------------- | --------------------------------------------------------------------------- |
   | One host | none                                     | as above: pages and server half on one origin                               |
   | Pages    | `NEXT_PUBLIC_ONTOLOGY_RELAY=1` at build  | serves pages only; every `/api/host/*` call is forwarded to the named server |
   | Server   | `ONTOLOGY_SETUP_CODE` in its environment | `503` until set up from its installer's link, then that one platform only   |

2. **On the client's server, `/iblai` is ours and everything else is NVIDIA's.** Caddy on :443
   (certificate obtained automatically) sends `/iblai/api/host/*` and `/iblai/<platform>/<slug>/mcp`
   to the server half on `127.0.0.1:3000` with the prefix stripped, anything else under `/iblai` to
   a `404`, and everything else to NVIDIA's web app on `127.0.0.1:3100`. The engine API (3001),
   ingestion (3002), Postgres (5434) and every Toolbox port stay on loopback; the files are a
   Docker volume (`ONTOLOGY_HOME=/data`). Agents call `https://<host>/iblai/<platform>/<slug>/mcp`.
3. **The header.** The browser names the platform's server in `x-ontology-server`
   (`SERVER_HEADER`, `lib/server-address.ts`), its address `https://<host>/iblai` (`serverBase`).
   The pages forward method, body, `authorization`, `content-type` and `x-ontology-platform` to it
   (`lib/host/relay.ts`): only to a public https address, following no redirect, within 60 s.
   No header is a `404`. The pages' own `/<platform>/<slug>/mcp` answers `404`.
4. **The address is kept per browser**, in `localStorage["ontology_server:<platform>"]`: the
   platform has no record for it yet. The first administrator gets it from the installer's link,
   `<console>/#host=<host>&code=<32 hex>`, kept across sign-in; a **Set up `<host>`** card names the
   host and the platform. Others type the host name under **Connect a server**.
5. **The setup route.** `GET /api/host/setup` → `{ set_up }`, no sign-in. `POST /api/host/setup`
   `{ code }` with an administrator's `Token` and `x-ontology-platform` → `{ ok, platform }`. The
   code is compared in constant time and the claim is the existing `$ONTOLOGY_HOME/engine-platform`,
   which only setup writes on such a server. No key is minted: the server holds no ibl.ai secret.
6. **One platform per server.** `asConsole` and the gateway refuse before asking ibl.ai: not set up
   → `503` naming the installer's link; another platform → `403`.
7. **The settings**, read at run time on the server (Next fixes `NEXT_PUBLIC_*` at build):
   `ONTOLOGY_SETUP_CODE`, `ONTOLOGY_DM_URL` (else the build's DM address), `ONTOLOGY_HOME`,
   `AO_URL=http://127.0.0.1:3100`, `AO_API_KEY` (minted by the installer), `TOOLBOX_BIN`.
   `engine.json` stays for one host serving several platforms.
8. **Install** with one command, `deploy/install.sh` on Ubuntu 22.04 or later, with the image
   `ghcr.io/iblai/ontology` and `deploy/server.yml` ([docs/install.md](docs/install.md)). The
   engine starts with no model: connecting a database, the map, certifying, raw SQL and
   certified-term tools work; inferred joins and question answering wait for one.
