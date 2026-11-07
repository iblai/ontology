<div align="center">

<a href="https://ibl.ai"><img src="https://ibl.ai/images/iblai-logo.png" alt="ibl.ai" width="300"></a>

# ibl.ai/ontology

**The open-source console for the ontology that makes your systems queryable by AI agents.**

Connect the systems of record, map what they hold into memory domains, expose them as MCP tools, and decide which roles and agents may reach what. One codebase. Every platform. Your data, your platform, your rules.

[![Join](https://img.shields.io/badge/Join-blue)](https://ibl.ai/join)
[![About](https://img.shields.io/badge/About-ibl.ai-blue)](https://ibl.ai)
[![Docs](https://img.shields.io/badge/Docs-ibl.ai%2Fdocs-green)](https://ibl.ai/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![SOC 2 Type II](https://img.shields.io/badge/SOC_2-Type_II-blue)](https://ibl.ai)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)

<br>

### ⬇️ Get ibl.ai/ontology

<img src="https://img.shields.io/badge/Web-ontology.ibl.ai_(coming_soon)-2563eb?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Web — ontology.ibl.ai, coming soon" height="42">

<sub>Hosted web app coming soon · today: [run it locally](#quick-start) or [deploy it yourself](#deployment)</sub>

<br>

[Why ibl.ai/ontology](#why-iblaiontology) · [Every platform](#every-platform-one-codebase) · [Features](#features) · [Case studies](#case-studies) · [Screenshots](#screenshots) · [Quick Start](#quick-start) · [Deployment](#deployment) · [Architecture](#architecture)

</div>

---

<div align="center">

**SOC 2 Type II** &nbsp;·&nbsp; Universities, enterprises, and governments run on ibl.ai — [read the case studies →](https://ibl.ai/case-studies)

</div>

---

## Why ibl.ai/ontology

|                               |                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔓 **Your data, your rules**  | MIT-licensed and self-hostable. The console never holds a credential: sources name `${ENV}` references, and secrets are masked before anything leaves the server.                                    |
| 🗺️ **See the whole ontology** | Services, tables, memory domains, MCP tools, toolsets, roles, schedules and agents as one graph: a semantic map to explore and an access flowchart to govern.                                        |
| 🔐 **Access you can flip**    | Which toolsets and memory domains a role may reach, and which tools a toolset carries, are switches on the chart. The backend enforces the same grants.                                              |
| 🔌 **Any backend**            | The browser only talks to the console's own API routes. Run on built-in demo data, point them at the iblai/ontology backend, or add an adapter for the ibl.ai platform when its endpoints are ready. |

---

## Every platform, one codebase

<div align="center">

| Platform |     | Status                                                                                               |
| -------- | --- | ---------------------------------------------------------------------------------------------------- |
| **Web**  | 🌐  | Any modern browser. Hosted at **ontology.ibl.ai** coming soon; [run it locally](#quick-start) today. |

</div>

The native shells (macOS, Windows, iOS, Android) are not set up for this app yet.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

**🗂️ Connect & discover**

- **Services** — PeopleSoft, Canvas, Slate, Snowflake and more from the catalog, with a read-only safety suite before anything is approved
- **Catalog** — adapters with their connection needs and default toolsets
- **Sync** — schedules, runs and history that fill the memory domains

**🧭 See & govern**

- **Semantic map** — the force-directed graph of everything the ontology knows, with per-role focus and grant toggles
- **Access** — the layered flowchart from systems of record to agents; flip a switch to grant a toolset, a memory domain or a tool
- **Roles** — toolsets, memory paths, cache tables, agents and limits per role

</td>
<td width="50%" valign="top">

**🛠️ Serve over MCP**

- **MCP gateway** — sources, tools and toolsets; validate and build the Toolbox config; a playground to call a tool
- **tools.yaml** — edit the raw config, validated before it saves
- **Configuration** — the backend's files with secrets masked

**🏢 Platform**

- **ibl.ai SSO** — platform switcher, notifications, invitations and the account sheet (users, groups, roles, policies)
- **Demo data** — in-memory, no backend, one env var to switch to a real one

</td>
</tr>
</table>

---

## Case studies

Universities, enterprises, and government agencies build on ibl.ai — deploying agents on their own infrastructure, with their own models, at a fraction of the cost of closed platforms.

**[Read the case studies →](https://ibl.ai/case-studies)**

---

## Screenshots

Screenshots are on their way. Until then, [run it locally](#quick-start): the demo data fills every page.

---

## Quick Start

```bash
pnpm install
cp .env.example .env.local   # ibl.ai SSO keys; leave ONTOLOGY_API_URL unset for demo data
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign-in goes through ibl.ai SSO; set `NEXT_PUBLIC_MAIN_TENANT_KEY` to your platform key from [login.iblai.app/me](https://login.iblai.app/me). With `ONTOLOGY_API_URL` unset, every page runs on in-memory demo data served by the console's own API routes. The data is open to anyone who can reach the server and resets when it restarts.

### Scripts

| Command          | What it does                                                   |
| ---------------- | -------------------------------------------------------------- |
| `pnpm dev`       | Dev server on :3000                                            |
| `pnpm build`     | Production build                                               |
| `pnpm start`     | Serve the build                                                |
| `pnpm typecheck` | TypeScript 7 (tsc)                                             |
| `pnpm lint`      | oxlint                                                         |
| `pnpm format`    | oxfmt                                                          |
| `pnpm check`     | Every `t("key")` exists in `messages/en.json`                  |
| `pnpm test`      | Unit tests (vitest)                                            |
| `pnpm test:e2e`  | Playwright journeys on demo data, on their own server at :3100 |

---

## Deployment

### Option A: Demo data

```bash
pnpm build && pnpm start
```

Nothing else: the route handlers under `/api/ontology` serve the seeded in-memory data.

### Option B: The iblai/ontology backend

Set `ONTOLOGY_API_URL` to the backend's REST API (for example `http://localhost:8000`). Every `/api/ontology/*` call is forwarded there with the caller's `Authorization: Token <dm_token>` and `X-Edx-Jwt` headers, so the backend needs `ONTOLOGY_DM_URL` and `ONTOLOGY_LMS_URL` for its ibl.ai token scheme. The browser never calls the backend, so no CORS is involved. `ONTOLOGY_ROOT` points the Configuration page at the backend checkout's YAML files.

### Option C: The ibl.ai platform

Not wired yet. The route table in `lib/ontology/server/routes.ts` maps the REST surface onto one function interface; an adapter for the platform's endpoints plugs in there.

> **Note**: the console needs the ibl.ai platform for sign-in, notifications and the account sheet in every mode. Visit [ibl.ai](https://ibl.ai) to get started.

---

## Configuration

| Variable                           | Default                   | Effect                                                                   |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `ONTOLOGY_API_URL`                 | unset                     | Unset → demo data. Set → `/api/ontology/*` is forwarded to this URL.     |
| `ONTOLOGY_ROOT`                    | `..`                      | Where the Configuration page reads the backend's files (forwarded mode). |
| `NEXT_PUBLIC_MAIN_TENANT_KEY`      |                           | Your ibl.ai platform key.                                                |
| `NEXT_PUBLIC_API_BASE_URL`         | `https://api.iblai.app`   | The ibl.ai API host.                                                     |
| `NEXT_PUBLIC_AUTH_URL`             | `https://login.iblai.app` | The ibl.ai sign-in SPA.                                                  |
| `NEXT_PUBLIC_PLATFORM_BASE_DOMAIN` | `iblai.app`               | Platform subdomains allowed for images.                                  |
| `NEXT_DIST_DIR`                    | `.next`                   | A build or the e2e server beside a running dev server.                   |

---

## Architecture

```
browser ── apiClient (lib/ontology/api-client.ts) ── /api/ontology/* (app/api/ontology/[...path]/route.ts)
                                                        ├─ ONTOLOGY_API_URL unset: lib/ontology/server/routes.ts → lib/ontology/mock (seeded, in memory)
                                                        └─ ONTOLOGY_API_URL set:   fetch(ONTOLOGY_API_URL + path) with the caller's headers
```

| Path                            | What                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `app/(console)/*`               | Dashboard, semantic map, access, services, catalog, sync, MCP, roles, config |
| `app/api/ontology/[...path]`    | The one route handler: mock dispatch or forwarding                           |
| `lib/ontology/api-client.ts`    | The browser's only data access path                                          |
| `lib/ontology/server/routes.ts` | REST surface → function interface                                            |
| `lib/ontology/mock/`            | Seed, store and handlers for demo data                                       |
| `lib/ontology/graph.ts`         | Relationship graph helpers: reach, grants, patches                           |
| `lib/ontology/flow.ts`          | The access flowchart layout                                                  |
| `components/shell/`             | The ibl.ai SDK shell: sidebar, navbar, account sheet                         |
| `messages/en.json`              | Every string the UI shows                                                    |

---

## Testing

| Command         | What it covers                                                      |
| --------------- | ------------------------------------------------------------------- |
| `pnpm test`     | Mock handlers, graph helpers, the route table, the flowchart layout |
| `pnpm test:e2e` | Journeys on demo data: map, roles, schedules, MCP, access           |
| `pnpm check`    | i18n keys                                                           |

Playwright starts its own server on :3100 in demo mode with its own dist dir, so it runs beside a dev server; every journey resets the demo data first. Add or update a journey whenever you change user-facing behavior.

---

## Contributing

Issues and pull requests are welcome. Run `pnpm typecheck && pnpm lint && pnpm check && pnpm test` before opening one, and `pnpm test:e2e` for anything a user can see.

---

## Resources

- [Documentation](https://ibl.ai/docs)
- [iblai/ontology](https://github.com/iblai/ontology) — the backend this console was built for
- [@iblai/mcp](https://www.npmjs.com/package/@iblai/mcp) — MCP server for AI-assisted development
- [Vibe](https://github.com/iblai/vibe) — developer toolkit for building with ibl.ai
- [Vibe Starter](https://github.com/iblai/vibe-starter) — pre-wired Next.js + ibl.ai SSO template

---

<div align="center">

## License

MIT License. See [LICENSE](LICENSE) for details.

<br>

**[ibl.ai](https://ibl.ai)** · Your organization's AI, under your control.

</div>
