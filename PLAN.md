# Docker Compose is the install; the client's server serves the whole console

## Context

rei: "by default make the client serve the whole nextjs iblai ontology project on their server.
make this a docker compose. make the script optional. docker compose becomes the main route."
Then, on the first draft of this plan: "make .env optional pls. put the env vars in the docker
compose yaml."

Earlier today the plan put only the server half on the client's machine, with the pages on Vercel
and a script that assembled three compose files, minted a key and printed a one-time link. That is
written (not run). This plan turns it around: one compose file is the install, the whole console
runs from it, and the script is a convenience on top.

Decided by rei:

- **The console sits at the root** of the client's host name, as it runs today. NVIDIA's API is
  `https://<host>/api/…` (everything under `/api` except `/api/host`, the console's).
- **`ONTOLOGY_PLATFORM` is mandatory wherever there is a local engine.** It names the platform that
  engine belongs to, and the server then serves that platform only. A server with a local engine
  and no `ONTOLOGY_PLATFORM` refuses to start. Only a server with no local engine runs without
  it, for any platform.
- **`package.json` is 1.0.0**: the first release from this branch is `v1.0.0`.
- **No `.env` is needed.** Every variable is in `compose.yaml`; a `.env` only overrides.
- **`OPENAI_API_KEY` (optional) turns the semantic features on**, through `OPENAI_API_BASE_URL`
  (optional, default `https://api.openai.com/v1`). Without a key the engine runs as it does on
  rei's machine: terms from names, no inferred joins, no answers.

Still standing: Ubuntu 22.04, 24.04, 26.04; the engine built from NVIDIA's pinned commit
`22e22c89`; one engine per server; `install.sh` on normal releases; **no test, build or check
until rei says so**.

## What the operator does

```bash
curl -fsSLO https://github.com/iblai/ontology/releases/latest/download/compose.yaml
# the first two settings in the file (or the same names in a .env or the shell):
#   ONTOLOGY_PLATFORM  the ibl.ai platform its engine belongs to: required, compose stops without it
#   ONTOLOGY_HOST      the name this server answers at (default localhost)
docker compose up -d
```

Needs Docker with Compose and buildx, and git: Docker builds NVIDIA's services straight from its
repository at the full commit hash (confirmed in Docker's docs).

## The shape

```
Caddy :443
  /api/host/*                      → console   127.0.0.1:3000   (pages, host API, MCP gateway)
  /api/auth/*                      → 404       (NVIDIA's sign-in stays off the internet)
  /internal/*                      → 404       (the engine's model route: loopback only)
  /api/*                           → NVIDIA    127.0.0.1:3100   (its API, with its own keys)
  /iblai/api/host/*, /iblai/<platform>/<slug>/mcp → console, prefix stripped (second address)
  everything else                  → console
loopback only: 3000, 3100, engine API 3001, ingestion 3002, Postgres 5434, every Toolbox port
```

- Agents call `https://<host>/<platform>/<slug>/mcp`. `/iblai/…` stays as a second address, for a
  console hosted elsewhere (the pages-only build: now the option, not the default).
- NVIDIA's own pages are not served: on one host name they would share an origin with the console
  and could read its sign-in. They open through an SSH tunnel to 3100, so the engine's `APP_URL`
  is `http://localhost:3100`, the value its sign-in was proven with here.
- Sign-in returns only to origins a platform allows: `https://<host>` has to be added to the
  platform's allowed redirect origins on ibl.ai. The guide gives it as a step.

## Changes

**`deploy/compose.yaml` (new; replaces `deploy/server.yml`)** — self-contained, no layering:

- **Settings at the top.** `ONTOLOGY_PLATFORM` has no default: the file always brings an engine, so
  compose stops with a message that names the setting. The rest have defaults: `ONTOLOGY_HOST`
  (`localhost`, which Caddy serves with its own certificate),
  `ONTOLOGY_DM_URL` (`https://api.iblai.app/dm`), `OPENAI_API_KEY` (empty), `OPENAI_API_BASE_URL`
  (`https://api.openai.com/v1`), and the two model names the key is used with (below). Each is
  `${NAME:-default}`: edit the file, or set the name in a `.env` or the shell.
- **No secret is typed or stored in the file.** A one-shot service writes three random secrets
  (database, session signing, engine admin) into a volume on the first start and never again.
  Postgres reads its own from the file; NVIDIA's services start through one small wrapper script
  (inline in the compose file) that puts the three into their environment; the console reads the
  admin one from the file. A published default would be the same on every install, and NVIDIA's
  API is on the internet.
- **NVIDIA's services defined here**, as in its own compose file at the pinned commit, with what
  `deploy/auto-ontology.override.yml` adds today (host network, every listener on 127.0.0.1, the
  loopback entrypoint). Built from `https://github.com/NVIDIA/auto-ontology.git#<full sha>` and
  `…#<full sha>:frontend`; images tagged with the commit, so a new pin rebuilds by itself. Each
  service gets only the variables it reads. `CONNECTION_STRINGS` is never set. No pgAdmin.
- `ontology` (this repo's image, the whole app, `init: true`, files on a volume) and `proxy`
  (Caddy, the routes above in a `route` block so their order is the written one; NVIDIA's answers
  get a sandboxing `Content-Security-Policy`).
- `deploy/auto-ontology.override.yml` stays for development against a local checkout and leaves
  the release.

**The server makes its own engine key** — `lib/host/engine-key.ts` (new), `lib/host/engine.ts`,
`lib/host/ao.ts`

- With no `AO_API_KEY`, the first call signs in to the engine as its admin (email, the password
  file, the origin the engine trusts), makes a key, keeps it in `$ONTOLOGY_HOME/engine-key` (0600)
  and uses it from then on: the flow of this session's proven scratch script. One attempt at a
  time. A key the engine refuses is dropped, so the next call makes a new one.
- So nobody mints anything: not the operator, not the script.

**A model through an OpenAI key** — `app/internal/models/v1/…/route.ts` and `lib/host/models.ts`
(new)

The engine cannot be handed an OpenAI key directly. Read in its source at the pinned commit:

- It uses the plain OpenAI chat client only for a model id that starts `openai/`, and sends that
  id as it is (`auto_ontology/utils/llm_invoke.py:228-242`). openai.com has no model of that name.
- Its embedding call always adds `input_type`, `truncate` and `modality`
  (`utils/embedding.py:188-196`), which OpenAI's API does not take, and its vector column is fixed
  at 2048 dimensions (`vdb/postgres.py:174`), which no OpenAI model answers unless asked.

So the console gets one small private route that the engine calls on loopback, and it does the
translating:

- The engine is pointed at `http://127.0.0.1:3000/internal/models/v1` with a generated key of its
  own, and told two fixed names, `openai/chat` and `openai/embedding`.
- Chat: the route swaps in `OPENAI_MODEL` (default `gpt-4.1`), adds `OPENAI_API_KEY`, and forwards
  the rest untouched to `OPENAI_API_BASE_URL`. Embeddings: it swaps in `OPENAI_EMBEDDING_MODEL`
  (default `text-embedding-3-large`), drops the three extra fields and asks for 2048 dimensions.
- No `OPENAI_API_KEY`: it answers 403, the same refusal the engine gets today, and nothing leaves
  the server. Caddy answers 404 for `/internal/*`, and the route takes only the engine's own key.
- Reranking needs nothing: the engine uses it in one compile step and falls back when it fails.
- With a gateway that names models `provider/model` (the DM, OpenRouter), set `OPENAI_MODEL` to
  that id. The DM still has no embeddings route, so with it only chat would work for now.

**One platform or any** — `lib/host/env.ts`, `lib/host/platform.ts`, `lib/host/engine.ts`,
`lib/host/guard.ts`, `app/[platform]/[slug]/mcp/route.ts`

- `ONTOLOGY_PLATFORM` set: `asConsole` and the gateway answer 403 to any other platform before
  ibl.ai is asked, and the server's own engine (`AO_URL`) is that platform's.
- `AO_URL` set without it: the server refuses to start (`instrumentation.ts`, new, Next's start-up
  hook), and every host call and gateway call answers 503 naming the setting, in case a runtime
  skips the hook.
- Neither set: any platform is served; each needs its own `engine.json`, written by the server's
  operator. That file may no longer name an engine on the same machine (refused with the
  existing address rule in `lib/host/address.ts`): a local engine has one way in.
- The rule "the first platform to ask takes the host's engine" and its `engine-platform` file go
  away, in `lib/host/engine.ts`, the files' header comment, the docs and `lib/host/ao.test.ts`.
- **This changes rei's own `pnpm dev`**: his `.env.local` names a local engine, so the dev server
  will refuse to start until it also has `ONTOLOGY_PLATFORM=<his platform's key>`. I do not open
  that file, so the line is his to add. I make this edit last and say so when it lands, because
  his running console starts answering 503 the moment it hot-reloads.

**Removed (written earlier today, now without a purpose)** — the one-time link and its code:
`lib/host/setup.ts`, `POST /api/host/setup`, `ONTOLOGY_SETUP_CODE`, `lib/setup-link.ts`,
`components/shell/setup-server.tsx`, their tests, the `keepSetupLink` effect in the providers.
`GET /api/host/setup` becomes `GET /api/host/health` (`{ ok: true }`, no sign-in): what the
container, the script and the "Connect a server" card ask.

**Kept as the option, not the default** — the pages-only build (`NEXT_PUBLIC_ONTOLOGY_RELAY=1`):
`lib/host/relay.ts`, `lib/server-address.ts`, the "Connect a server" card (its install text now
points to the guide), the server control on Config.

**Image and release** — `package.json` version `1.0.0`; `Dockerfile` (already the whole app;
gains build arguments for the ibl.ai addresses, which Next fixes at build);
`.github/workflows/release.yml` (attaches `compose.yaml` and `install.sh`; stamps the image tag
and the script's version; the tag must be `v1.0.0`).

**`deploy/install.sh`, optional and short** — `--host`, `--platform`, `--platform-url`,
`--dry-run`, `--uninstall`. Checks the machine, installs Docker, Compose, buildx and git from
Ubuntu's archive, downloads `compose.yaml`, writes the names it was given into a `.env` (no
secrets), builds with retries, `docker compose up -d`, waits for `/api/host/health`, prints the
addresses and the redirect-origin step. No engine download, no minting, no link.

**Docs** — `docs/install.md` rewritten around Compose (the settings, where the generated secrets
are and how to read the engine's admin password, upgrade, remove), with the script as "or let the
script do it"; `docs/network.md`, `README.md`, `.env.example` and the lines today's earlier pass
wrote for the hosted shape, turned to: whole console on the client's server by default, hosted
pages as the option.

## How it is built

The server half's pieces first, by me (small, and everything else names them). Then agents on
separate files: the compose file with its text checks and the release workflow; the short script
and the guide; the pages' trim; the docs. Tests are written with the code and **not run**.

## Verification, on rei's word

- `oxfmt --check`, `tsc --noEmit --incremental false`, `oxlint`, `pnpm test`.
- `docker compose -f deploy/compose.yaml config`; `bash -n` and shellcheck on the script; its
  `--dry-run`; a local `docker build`.
- rei, on a fresh server: the two commands above, add the origin to the platform, sign in at
  `https://<host>/`, connect a database, deploy a server, call it from an OS agent.

## Not proven until that run

- Docker building from the git address on a server, and the engine build itself.
- The secrets step: the wrapper script inside NVIDIA's images, and Postgres reading its file.
- Caddy's routing, and that nothing but Caddy listens beyond loopback.
- The console's sign-in on the client's own origin.
- The server signing in to the engine by itself (the same calls worked from a script here).
- The model route with a real key: what the engine's chat client sends for structured output, and
  whether `gpt-4.1` and `text-embedding-3-large` at 2048 dimensions are the right defaults.

## For rei to settle outside this plan

- The two default model names are mine: `gpt-4.1` because the engine sets small output limits
  that a reasoning model's hidden tokens would eat, and `text-embedding-3-large` because it is the
  OpenAI model that can answer 2048 dimensions.
- Next plan, smaller than before: `POST …/v1/embeddings` in the DM, in a new worktree. With this
  route in place it only has to be a plain OpenAI-style endpoint that honours `dimensions`.
