# Ontology console — build plan

Status: **UX approval pass.** The console at the repository root runs against `lib/mock.ts`.
Nothing here talks to a real system yet. This document is the plan for turning it into the product.

## What it is

One ontology of the institution. Connect the systems a campus already runs, dissect them into
business terms and relationships, certify the result, and publish it as MCP servers that agents
call with the authentication and allowed origins the institution chooses. Data stays on the host.

Vendor engines underneath are implementation details and never appear in the UI:

| Concern                         | Implementation                                                                     | How we use it                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Serving tools over MCP          | Google MCP Toolbox (server binary + `toolbox-core`)                                | We generate `tools.yaml` per server and run one Toolbox process per server with `--allowed-origins`, `--allowed-hosts`, `--config`. Native `authServices` handle OIDC (Entra, Google, custom).                                                                                                                                                                                             |
| Inferring terms, joins, metrics | NVIDIA auto-ontology (compose stack: web 3000, api 3001, ingestion 3002, pgvector) | `POST /api/connections`, `POST :3002/ingest`, `POST :3002/semantic/compile`, poll `GET :3002/semantic/status`, then read `/api/exploration/data-graph`, `/api/exploration/semantic-graph`, `/api/terms`, `/api/sql-attributes`, `GET /api/model/export?format=ossie`. Its MCP tools (`ask_question`, `search_terms`, `describe_table`) are proxied into our servers as a semantic toolset. |
| Platform shell, SSO, agents     | ibl.ai (`iblai/vibe` starter, `@iblai/iblai-js`)                                   | Header/sidebar match os.ibl.ai; SSO via `/iblai-vibe-auth`; ibl.ai agents connect to a server as a connector.                                                                                                                                                                                                                                                                              |
| Existing product                | `github.com/iblai/ontology` (Django 5 + Celery + Next.js 16)                       | Same seven-component architecture. This frontend targets that backend's console routes.                                                                                                                                                                                                                                                                                                    |

## Screens (built, mocked)

| Route                                                                                | Step      | What it does                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                                                         | 0         | The organization's ontology: counters, activity, MCP servers.                                                                                                                           |
| `/systems`                                                                           | 1 Connect | Catalog with DISSECT / SERVE capability per kind; add database (dissected + served), HTTP API (served only) or prebuilt toolset; connection test.                                       |
| `/map`                                                                               | 2 Dissect | Pipeline stages with live log; force graph of tables (physical) under terms (semantic), clustered by system; node inspector; terms spanning several systems surfaced for certification. |
| `/ontology`                                                                          | 3 Model   | Ontology Manager: object types, link types, metrics, actions, tags; properties with backing columns, PII flags, certified/suggested.                                                    |
| `/mcp/new`                                                                           | 4 Expose  | Toolsets generated from certified object types; sign-in (ibl.ai platform tokens, Entra, Google, custom OIDC); allowed origins + hosts; generated `tools.yaml`.                          |
| `/mcp/[slug]`                                                                        | 5 Serve   | Endpoint, stats, connect snippets (ibl.ai agent, cURL, Claude Desktop, Python MCP SDK), playground, agent tool calls + runtime log, ibl.ai tokens.                                      |
| `/mcp`, `/agents`, `/catalog`, `/sync` (Compilation), `/roles`, `/access`, `/config` | —         | Lists and stubs so the nav is complete.                                                                                                                                                 |

## Data layer

There is no backend of our own and no database. Every value comes from ibl.ai (browser → ibl.ai with
the SSO session), NVIDIA auto-ontology (its own store on the host) or Google MCP Toolbox (config files
and the process on the host). The browser reaches the host through this app's stateless route
handlers, which verify the ibl.ai token and forward. The full per-screen audit, the removals it
forced, and the gateway design are in [data-sources.md](data-sources.md).

## Next steps, in order

1. ~~**Auth.**~~ Done: ibl.ai SSO, SDK footer panels, notifications, profile menu ([auth.md](auth.md)).
2. **ibl.ai reads.** Replace the IBL-tagged mocks with SDK/REST calls (MCP servers, api-tokens, RBAC, analytics, org metadata).
3. **Host route handlers.** `app/api/host/*`: verify the ibl.ai token, proxy auto-ontology, read/write `servers/{slug}/tools.yaml` + flags, supervise Toolbox, tail its log. No storage.
4. **Dissect for real.** Point at the auto-ontology compose stack; stream its ingest/compile status into the Map log; draw `/api/exploration/*` instead of mock tables.
5. **Serve for real.** Compile certified object types into `tools.yaml`; supervise one Toolbox process per server; gateway enforces platform keys, origin and host checks; proxy to Toolbox `/mcp/{toolset}`.
6. **Remove the walkthrough** (`NEXT_PUBLIC_WALKTHROUGH=0`) once the flow is approved.

## Running

```bash
pnpm install && pnpm dev
```

Open http://localhost:3000. The walkthrough stepper at the bottom follows steps 0–5.
