# Ontology console revamp: hand-off for the next agent

Written 2026-11-17, about 22:40 +08, by a session that started without the earlier conversation.
It is rebuilt from git, `PLAN.md`, the eight knowledge base entries under
`ontology.ibl.ai/1794843911-revamp-host-layer` and the two memory notes. Sections 2 and 7 were read
from the tree and the machine at that time. Nothing was run: no test, typecheck, lint or build.

## 0. Rules for whoever continues

- **No test, build or check until rei says so** (`PLAN.md`, "Still standing"). Tests are written
  with the code and not run. Only `pnpm install` and `oxfmt` may run before then. Subagents run
  nothing.
- **rei touch-tests himself.** Do not click through the app, call it or look around the machine.
  He stopped this session's reading with "stop probing".
- **Never `git commit`.** He commits; propose one line under 100 characters.
- **Parallel subagents early**, on disjoint files, against contracts written as code. Say in one
  line what you do alone and when the agents go out. He has interrupted twice over this.
- **The mock is the target look** (`lib/mock.ts`): live data fills the mock's shapes, a value with
  no source shows "—", and a control is dropped only when nothing can back it.
- **Never open `.env`, `.env.local` or anything under `.ontology/`.** They hold keys and database
  passwords. `.env.example` is fine.
- "platform", never "tenant", in anything a user reads. i18n is deferred for this pass by his
  decision of 2026-11-16: strings stay inline English.
- Fail loudly, in the other system's own words. Comments are one line.
- The review fixes are on hold (section 6), except a blocker on the path he is testing: fix it
  when found, and say so.
- The shell: a hook rewrites `ls`, `rg`, `stat`, `wc`, `git log` and others to `rtk …`; when a call
  bounces with "a hook changed this call's input", issue again exactly the command it quotes. The
  Read tool can replace function bodies with an "elided" comment: `rtk read -n <file>` gives the
  text.
- When checks are allowed: typecheck with `tsc --noEmit --incremental false` (the cached run
  answered exit 0 three times over a real error), and lint with
  `node_modules/.bin/oxlint --max-warnings 0 .`.
- Start in the repo root. `frontend/` is an empty leftover directory, and this session's shell
  started in it.

## 1. Settle this first

`PLAN.md` in the working tree is the second draft of a new plan, written at 22:16 +08: **Docker
Compose is the install, and the client's server serves the whole console.** rei asked for the
first draft to make `.env` optional. Nothing in the repo, the knowledge base or the memory notes
records his go-ahead on this draft. Ask him before building.

What the plan lists under "Decided by rei" is his. The two default model names (`gpt-4.1`,
`text-embedding-3-large`) are the previous agent's, and the plan says so.

## 2. Where things stand

- `iblai/ontology`, checkout `~/Projects/work/ibl.ai/ontology.ibl.ai/revamp`, branch `revamp`.
  HEAD is `97b43d0`, and the remote's `revamp` is the same commit, so everything committed is
  pushed. There is no pull request from `revamp`.
- `revamp` is the repository's default branch on GitHub. `origin/main` is `bbb5db4`, the old
  product (checkouts `../main` and `../main2`; `main2` holds the Python backend the host layer was
  ported from).
- The latest release is `v0.2.13` (2026-11-12), from the old product. Publishing `v1.0.0` makes
  `releases/latest/download/*` serve this branch's files.
- The four commits: `f844a7a` and `e1f8130` (Miguel Amigot: the mocked console, SSO, the shell),
  `309be62` (console moved to the repo root; oxlint, oxfmt, TypeScript 7, vitest, pnpm 12),
  `97b43d0` (139 files, +18,997 −1,776: the host layer, the MCP gateway, several platforms on one
  host, the hosted shape and a server install).
- Uncommitted: `PLAN.md` (modified) and this file (untracked). Nothing else.
- The clone has no git hooks, so nothing ran on the push.
- `package.json` is version `0.1.0`, and its `typecheck` script is `tsc --noEmit`.

**The plan file.** The committed `PLAN.md` (480 lines, `git show HEAD:PLAN.md`) is the earlier
"make it work" plan: the decisions table, the disk layout, the agents' build brief with its rules
and file owners, "Not in this pass", and the sections on several platforms and on the hosted
shape. The working copy (203 lines) replaces all of it with the Compose plan. Committing it drops
those sections from the tip; history keeps them.

**The tree against the Compose plan: none of it is built.**

- Missing, to be created: `deploy/compose.yaml`, `lib/host/engine-key.ts`, `lib/host/models.ts`,
  `app/internal/models/v1/…`, `instrumentation.ts`, `app/api/host/health/`.
- Present, to be removed: `deploy/server.yml`, `lib/host/setup.ts`, `lib/setup-link.ts`,
  `components/shell/setup-server.tsx`, `app/api/host/setup/` and their tests. 23 files name the
  one-time link or its code:
  `rg -l 'api/host/setup|setupCode|keepSetupLink|setup-link|setup-server|ONTOLOGY_SETUP_CODE' -g '!PLAN.md' .`
- The `engine-platform` claim is named in 7 files (`rg -l 'engine-platform' -g '!PLAN.md' .`). Its
  code is in `lib/host/setup.ts` (`claimed`, `serves`, `assertServes`, `setUp`), not in
  `lib/host/engine.ts` as the plan's text reads: `engine.ts` imports `serves` and `guard.ts`
  imports `assertServes`.
- Present, to be changed: `lib/host/{env,engine,guard,ao}.ts`,
  `app/[platform]/[slug]/mcp/route.ts`, `Dockerfile` (builds the whole app already; its header
  still says "server half"), `.github/workflows/release.yml` (stamps and attaches `install.sh`,
  `server.yml` and the override; refuses a tag that is not the version in `package.json`),
  `deploy/install.sh` (578 lines), `deploy/{deploy,install}.test.ts`, `docs/install.md`,
  `docs/network.md`, `README.md`, `.env.example`.
- Present, kept as the option: the pages-only build (`NEXT_PUBLIC_ONTOLOGY_RELAY`), in 14 files,
  among them `lib/host/relay.ts`, `lib/server-address.ts` and
  `components/shell/connect-server.tsx`.

## 3. What HEAD holds, and how far it was proven

Proven by a real run on 2026-11-17 (knowledge base: `running-the-engine-and-a-local-twenty`,
`making-the-console-multi-platform`):

- The engine's stack beside the console through `deploy/auto-ontology.override.yml`: host network,
  every listener on loopback.
- The engine's service key minted by a script, and the console reading the engine with it
  (`GET /api/host/systems`, `/graph`, `/toolsets` 200; `POST /api/host/systems/test` 200).
- rei's own session through the platform binding (`iblai-org`): `GET /api/host/servers`, `/apis`
  and `/activity` 200.
- Fetch Spec against the local Twenty, 200.
- One server deployed over an HTTP API: Toolbox 1.16.0 started on the console's flags and answered
  for the `loaded-` mark (603 tools, 3 toolsets), then `POST /<platform>/twenty/mcp` 200 from the
  console and from a real ibl.ai agent through ngrok.
- A compile with a read-only PostgreSQL login and no model key, which ended with no relationships.

Last recorded green: typecheck with the cache off, the format check and 305 unit tests, at the end
of the multi-platform work. Lint failed on nine warnings and they are still in the tree (for one,
`new Array` in `lib/host/log.ts`).

Never run, typechecked or built: everything written after that for the hosted shape and the server
install. That is `Dockerfile`, `deploy/server.yml`, `deploy/install.sh`, `release.yml`,
`lib/host/{setup,relay}.ts`, `lib/{setup-link,server-address}.ts`, the two server cards in
`components/shell/`, and their tests. `next build` has never run on this branch.

Also unproven: a SQL source through Toolbox; the semantic toolset against a filled engine;
`mysql-sql` and `clickhouse-sql`; ibl.ai refusing another platform's token; sign-in in a fresh
browser with no stored platform; a database password that holds `"`. No e2e test is written, so by
the workspace rule the feature is not done.

## 4. Next: build the Compose plan

Read `PLAN.md` whole; it is the specification. Its build order:

1. The lead, alone: the server half's pieces, because everything else names them.
   `lib/host/engine-key.ts` (the server signs in to the engine and makes its own key),
   `lib/host/models.ts` with `app/internal/models/v1/…` (the loopback route that turns the
   engine's model calls into OpenAI's), `GET /api/host/health`, `instrumentation.ts`, and the
   removal of the one-time link.
2. Agents on separate files: `deploy/compose.yaml` with its text checks and the release workflow;
   the short `install.sh` and the guide; the pages' trim; the docs.
3. `package.json` to `1.0.0`.
4. **Last, and said when it lands:** the `ONTOLOGY_PLATFORM` rule in `lib/host/env.ts`,
   `platform.ts`, `engine.ts`, `guard.ts` and the gateway route. rei's `.env.local` names a local
   engine, and a dev server is running on port 3000 now (section 7): it answers 503 from the
   moment it reloads until he adds `ONTOLOGY_PLATFORM=<his platform's key>` to that file. The line
   is his to add.
5. On his word: `oxfmt --check`, `tsc --noEmit --incremental false`, oxlint, `pnpm test`,
   `docker compose -f deploy/compose.yaml config`, `bash -n` and shellcheck on the script, its
   `--dry-run`, a local `docker build`. Then his run on a fresh server.

## 5. Decisions already made (rei's)

- 2026-11-16: the house toolchain (oxlint, oxfmt, TypeScript 7, vitest, pnpm 12); i18n deferred;
  the mock as the look; parallel subagents.
- 2026-11-17, while testing: a system's "Name" field is a label kept per platform, and the
  database's name stays the key; Fetch Spec asks three times with the auth header, then once
  without it and shows a toast.
- 2026-11-17, the Compose plan: the console at the root of the client's host name;
  `ONTOLOGY_PLATFORM` required wherever there is a local engine; version `1.0.0`; no `.env` needed;
  `OPENAI_API_KEY` optional; Ubuntu 22.04, 24.04 and 26.04; the engine built from the pinned
  commit; one engine per server; `install.sh` on normal releases.
- Decided and not built: an endpoint tool is named `<api>_<endpoint>` (64 characters with the
  prefix); the `semantic` toolset is lent only by name or to a platform admin.

## 6. Open after the plan

- **The review fix round, on hold.** Four reviewers' findings are in the knowledge base entry
  `open-review-findings`: three page blockers still open, six port-fidelity majors, six security
  majors, three seam majors. Each is a finding as reported, not a proven defect. Two were looked at
  tonight and are still open: nothing named `resaveDeployed` exists, and `lib/ibl-flows.ts` has no
  detach.
- The nine lint warnings.
- The `typecheck` script: `--incremental false` was proposed to rei and not changed.
- Known gaps: a system whose tables never appear keeps "Ingest" spinning and the page polling; a
  connected system cannot be renamed; saving an API under an existing name replaces it silently; a
  hosted console should refuse private addresses as well as loopback.
- For rei to settle: the two default model names, and the next plan, `POST …/v1/embeddings` in the
  DM, in its own worktree.
- Outside this pass by the committed plan: i18n, e2e journeys, a CI workflow, the SDK sidebar in
  place of Miguel's shell, authoring write tools in the UI, ibl.ai-side call analytics.
- The Twenty admin API key minted for the demo is to be revoked when the demo ends.

## 7. The machine right now

Read once, about 22:30 +08:

- A Next server listens on port 3000: the console's dev server is up.
- The engine: checkout `/home/rei/Projects/src/github/NVIDIA/auto-ontology` at
  `22e22c894df8cde7a78f854ea40476a8577e9a3d`, the pinned commit (also `deploy/install.sh:24`). Its
  containers have been up 19 hours and report healthy, on loopback: web 3100, API 3001, ingestion
  3002, Postgres 5434, pgAdmin 5050. At the last note its `.env` held placeholder model keys, so it
  names terms from names, infers no joins and answers no questions.
- Twenty: compose project `twenty-demo` in `/var/tmp/twenty-demo`, up 2 days, server on 3030,
  Postgres on `127.0.0.1:5433`. To bring it back after `/iblai-stop`:
  `cd /var/tmp/twenty-demo && docker compose -p twenty-demo -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.3030.yml up -d`
- `.ontology/` (git-ignored) holds `platforms/` and `engine-platform`, the claim file the plan
  does away with.

## 8. Traps most likely to bite this build

Each is in the knowledge base with its evidence.

- The engine's sign-in takes only the origin in its `APP_URL`: a call to `127.0.0.1:3100` must
  send `Origin: http://localhost:3100`. A key runs with its minter's role, so mint as the admin.
- `CONNECTION_STRINGS` must stay unset, or connections made over the API are never ingested.
- NVIDIA's API and ingestion service hard-code `0.0.0.0`; the override's entrypoint swaps the host.
  Host networking also needs the service names in `extra_hosts` and every port pinned.
- NVIDIA's web app cannot be served under a path prefix.
- Next fixes `NEXT_PUBLIC_*` at build time in server code too: what a server is told as it runs has
  a name without the prefix.
- Toolbox ships one Linux binary (x86-64, glibc). The image copies it, sets `TOOLBOX_BIN`, and
  runs with `init: true`.
- A first engine build can stop on a timeout at nvcr.io; `docker pull` of the base image clears it.
- NVIDIA's published images are a week older than the pinned commit, hence the build from source.
- Ubuntu's own archive has Docker 29.1.3, Compose 2.40.3 and buildx 0.30.1 on all three releases.
- State kept in memory is keyed by a full path or the platform, never by a server's name alone.
- A bare `oxfmt` reformats untracked files too, this one and `PLAN.md` included:
  `node_modules/.bin/oxfmt . '!PLAN.md' '!handoff.md'`.

## 9. Where the detail is

`~/Projects/work/ibl.ai/knowledge-base/logs/ontology.ibl.ai/1794843911-revamp-host-layer/`:

- `moving-the-console-to-the-root`: pnpm 12's lockfile gate, oxfmt, the mock as the target.
- `reading-the-auto-ontology-api-contract`: the engine's API shapes, typed in `lib/ao-types.ts`.
- `mapping-the-sdk-surface-for-the-console`: which SDK slices and calls the console uses, and
  their traps.
- `building-the-host-layer-in-parallel`: Toolbox 1.16's file format, the engine's two decisive
  settings, how sixteen agents were run.
- `making-the-console-multi-platform`: the platform scope, the `iblai-org` binding, folder names,
  the typecheck cache trap.
- `running-the-engine-and-a-local-twenty`: every real run so far, and the fixes that followed.
- `open-review-findings`: the fix round's list.
- `putting-the-server-half-on-the-clients-machine`: the hosted shape now in HEAD, which the
  Compose plan turns around.

The newest of these was written at 05:35 +08, before the commit. Tonight's planning added none, so
what `PLAN.md` states beyond them (Docker building from a git address at a full hash, the engine
sending an `openai/` model id as it is) has no entry yet.
