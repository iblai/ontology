# ibl.ai/ontology — build plan

Status: **built, not yet run against live systems.** The console at the repository root reads and
writes ibl.ai, the dissection engine and the server runtime. Nothing has been run against a live
platform, engine or runtime yet. Demo mode (`NEXT_PUBLIC_DEMO=1`) still serves the fixed data in
`lib/mock.ts`.

## What it is

One ontology of the institution. Connect the systems a campus already runs, dissect them into
business terms and relationships, certify the result, and publish it as MCP servers that agents
call with the authentication and allowed origins the institution chooses. Data stays on the
platform's server: the client's own machine, which also serves the console.

Vendor engines underneath are implementation details and never appear in the UI:

| Concern                         | Implementation                                                        | How we use it                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serving tools over MCP          | Google MCP Toolbox (`@toolbox-sdk/server` 1.16.0 from npm)            | The platform's server writes `tools.yaml` per server and runs one Toolbox process per server on a free loopback port, with `--allowed-origins` and `--allowed-hosts`. Native `authServices` verify OIDC (Entra, Google, custom).                                                                                                                                                                                                                                    |
| Inferring terms, joins, metrics | NVIDIA auto-ontology (its compose stack, web app on `127.0.0.1:3100`) | Reached only through its web app's `/api/*` with a service key (`x-api-key`). `POST /api/connections` creates a connection and starts its ingest. `PUT /api/configurations/semantic-compilation {enabled: true}` starts a compile; `GET /api/semantic-compilation/status` reports it. The Map reads `/api/exploration/graph` and `/api/exploration/semantic-graph`. `POST /api/model/export` (admin key) downloads the model. Ports 3001 and 3002 are never called. |
| Platform shell, SSO, agents     | ibl.ai (`iblai/vibe` starter, `@iblai/iblai-js`)                      | Header and sidebar match os.ibl.ai; SSO via `/iblai-vibe-auth`. Roles, policies, API keys and agent connections are written on ibl.ai with the admin's own session.                                                                                                                                                                                                                                                                                                 |

The semantic tools (`ask_question`, `search_terms`, `describe_table`) are served by the console's
gateway from the engine's REST API. The engine's own MCP server is not used.

## Screens

| Route                                                                                | Step      | What it does                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                                                         | 0         | The platform's ontology: counters, activity, MCP servers.                                                                                                                        |
| `/systems`                                                                           | 1 Connect | Connected systems and the catalog of source kinds; add a database (dissected and served), an HTTP API (served only) or a raw SQL toolset; connection test.                       |
| `/map`                                                                               | 2 Dissect | Pipeline stages derived from what the engine has read; graph of tables under terms, clustered by system; node inspector; terms spanning several systems surfaced for certifying. |
| `/ontology`                                                                          | 3 Model   | Object types, link types, metrics, actions, tags; properties with backing columns, PII flags, certified or suggested.                                                            |
| `/mcp/new`                                                                           | 4 Expose  | Toolsets generated from certified terms; sign-in (ibl.ai credentials, Entra, Google, custom OIDC); allowed origins and hosts; the generated `tools.yaml`.                        |
| `/mcp/[slug]`                                                                        | 5 Serve   | Endpoint, counters, connect snippets, attach to an ibl.ai agent, playground, gateway calls and runtime log, API keys.                                                            |
| `/mcp`, `/agents`, `/catalog`, `/sync` (Compilation), `/roles`, `/access`, `/config` | —         | Lists and read-only views.                                                                                                                                                       |

## Data layer

There is no backend of our own and no database. Every value comes from ibl.ai (browser → ibl.ai
with the SSO session), NVIDIA auto-ontology (one engine per platform, each with its own store) or
the files the host keeps for Toolbox, one folder per platform. A server with an engine of its own
serves the one platform `ONTOLOGY_PLATFORM` names; one without serves the platform the person
signs in to. The browser reaches the host through this app's route handlers under `/api/host/*`,
naming the platform in `x-ontology-platform`; they check the caller with ibl.ai on that platform
and then act. On a console hosted elsewhere (`NEXT_PUBLIC_ONTOLOGY_RELAY=1`) the pages' own route
handlers act on nothing: they forward each call to the platform's server, which the browser names
in `x-ontology-server` ([network.md](network.md)). The per-screen sources and where each thing is
saved are in [data-sources.md](data-sources.md).

## Steps

1. **Auth.** Done: ibl.ai SSO, SDK footer panels, notifications, profile menu ([auth.md](auth.md)).
2. **ibl.ai reads and writes.** Built: a role and a policy per toolset, API keys, agent
   connections, through the SDK's endpoints.
3. **Host route handlers.** Built: `app/api/host/*` checks the caller with ibl.ai, proxies an
   allow-list of the engine's API, keeps server configs and revisions, and supervises Toolbox. On
   a console hosted elsewhere each handler forwards to the platform's server instead.
4. **Dissect for real.** Built: Systems creates engine connections; the Map draws the engine's
   graphs and derives its stages from what the engine has read.
5. **Serve for real.** Built: certified terms become `tools.yaml`; one Toolbox process per server;
   the gateway at `/<platform>/<slug>/mcp` (also under `/iblai` on a client's server) checks the
   connection, origin, credential and scope, then forwards.
6. **A server per platform.** Built: on a client's server the console is built from source and
   run by systemd, and `deploy/compose.yaml` runs NVIDIA's engine and Caddy beside it, for the
   platform `ONTOLOGY_PLATFORM` names; the server makes its own engine key, and an optional
   `OPENAI_API_KEY` reaches the engine through the console's model route. The console as ibl.ai's
   image, with `deploy/install.sh`, is the optional route. A console hosted elsewhere forwards
   `/api/host/*` to the server the browser names ([install.md](install.md)).
7. **Remove the walkthrough** (`NEXT_PUBLIC_WALKTHROUGH=0`) once the flow is approved.

### Not verified yet

Nothing has been run against a live platform, engine or runtime. That covers every ibl.ai read and
write, the engine's API shapes (read from its source, never called), Toolbox start, reload and the
loaded-config check, the gateway with a real agent, and the compose override. Serving several
platforms from one host (sign-in without a platform, the platform header, the per-platform files
and engines) has not been run either, nor has the server install: the console built with mise and
run by systemd, which hands it two of the generated secrets, Docker building NVIDIA's services
from its repository, the generated secrets, Caddy's routes, the console's sign-in on the
client's own origin, the server making its own engine key, the model route with a real key, and
the forwarding from a console hosted elsewhere. No end-to-end test exists yet.

## Running

Follow the quick start in the [README](../README.md): start the engine with
`deploy/auto-ontology.override.yml`, set the environment (`ONTOLOGY_PLATFORM`, and `AO_API_KEY`
or the engine admin's sign-in), then `pnpm install && pnpm dev`. Open http://localhost:3000. The
walkthrough stepper at the bottom follows steps 0–5. That is the one-host mode.

On a server: the four blocks of [install.md](install.md). Pages
hosted elsewhere: build them with `NEXT_PUBLIC_ONTOLOGY_RELAY=1` and connect each platform's server
under **Connect a server**.
