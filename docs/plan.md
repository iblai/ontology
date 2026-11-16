# Ontology console — build plan

Status: **built, not yet run against live systems.** The console at the repository root reads and
writes ibl.ai, the dissection engine and the server runtime. Nothing has been run against a live
platform, engine or runtime yet. Demo mode (`NEXT_PUBLIC_DEMO=1`) still serves the fixed data in
`lib/mock.ts`.

## What it is

One ontology of the institution. Connect the systems a campus already runs, dissect them into
business terms and relationships, certify the result, and publish it as MCP servers that agents
call with the authentication and allowed origins the institution chooses. Data stays on the
platform's server: the client's own machine, or the one host that also serves the pages.

Vendor engines underneath are implementation details and never appear in the UI:

| Concern                         | Implementation                                                        | How we use it                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serving tools over MCP          | Google MCP Toolbox (`@toolbox-sdk/server` 1.16.0 from npm)            | The platform's server writes `tools.yaml` per server and runs one Toolbox process per server on a free loopback port, with `--allowed-origins` and `--allowed-hosts`. Native `authServices` verify OIDC (Entra, Google, custom).                                                                                                                                                                                                                                                 |
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
the files the host keeps for Toolbox, one folder per platform. No setting names the platform: it
is the one the person signs in to. The browser reaches the host through this app's route handlers
under `/api/host/*`, naming the platform in `x-ontology-platform`; they check the caller with
ibl.ai on that platform and then act. On the hosted console (`NEXT_PUBLIC_ONTOLOGY_RELAY=1`) the
pages' own route handlers act on nothing: they forward each call to the platform's server, which
the browser names in `x-ontology-server`. That server (`ONTOLOGY_SETUP_CODE` set) serves the one
platform whose administrator opened its installer's link ([network.md](network.md)). The
per-screen sources and where each thing is saved are in [data-sources.md](data-sources.md).

## Steps

1. **Auth.** Done: ibl.ai SSO, SDK footer panels, notifications, profile menu ([auth.md](auth.md)).
2. **ibl.ai reads and writes.** Built: a role and a policy per toolset, API keys, agent
   connections, through the SDK's endpoints.
3. **Host route handlers.** Built: `app/api/host/*` checks the caller with ibl.ai, proxies an
   allow-list of the engine's API, keeps server configs and revisions, and supervises Toolbox. On
   the hosted console each handler forwards to the platform's server instead.
4. **Dissect for real.** Built: Systems creates engine connections; the Map draws the engine's
   graphs and derives its stages from what the engine has read.
5. **Serve for real.** Built: certified terms become `tools.yaml`; one Toolbox process per server;
   the gateway at `/<platform>/<slug>/mcp` (`https://<host>/iblai/<platform>/<slug>/mcp` on a
   client's server) checks the connection, origin, credential and scope, then forwards.
6. **Hosted pages, a server per platform.** Built: the pages on Vercel forward `/api/host/*` to
   the server the browser names; `deploy/install.sh` installs the engine, the server half and
   Caddy on a client's Ubuntu machine; the installer's link sets the server up for one platform
   ([install.md](install.md)).
7. **Remove the walkthrough** (`NEXT_PUBLIC_WALKTHROUGH=0`) once the flow is approved.

### Not verified yet

Nothing has been run against a live platform, engine or runtime. That covers every ibl.ai read and
write, the engine's API shapes (read from its source, never called), Toolbox start, reload and the
loaded-config check, the gateway with a real agent, and the compose override. Serving several
platforms from one host (sign-in without a platform, the platform header, the per-platform files
and engines) has not been run either, nor has the hosted shape: the install on each Ubuntu, Caddy's
routes, the forwarding, the setup link and the engine with no model. No end-to-end test exists
yet.

## Running

Follow the quick start in the [README](../README.md): start the engine with
`deploy/auto-ontology.override.yml`, mint its service key, set the environment, then
`pnpm install && pnpm dev`. Open http://localhost:3000. The walkthrough stepper at the bottom
follows steps 0–5. That is the one-host mode.

Hosted: build the pages with `NEXT_PUBLIC_ONTOLOGY_RELAY=1` and deploy them to Vercel; install
each platform's server with `deploy/install.sh` ([install.md](install.md)) and open the link it
prints.
