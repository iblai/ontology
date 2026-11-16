# Ontology

One ontology of the institution, exposed to agents over MCP. Connect the systems a campus already
runs, dissect them into business terms and relationships, certify the result, and publish it as MCP
servers that ibl.ai agents, Claude, Codex and any other MCP client can call. Runs inside your
network, signs in with ibl.ai, and keeps no data of its own.

> **Status:** UX approval build. Sign-in is real ibl.ai SSO; the ibl.ai panels (Management, API,
> Secrets, Advanced, Billing, Invites, Notifications) are the live SDK components. Ontology pages
> still run on mocked data from
> [`frontend/lib/mock.ts`](frontend/lib/mock.ts). [docs/plan.md](docs/plan.md) has the order of the
> remaining work.

![Map](docs/screenshots/03-map.png)

## Quick start

```bash
cd frontend
pnpm install
cp .env.example .env.local        # set NEXT_PUBLIC_MAIN_TENANT_KEY to your ibl.ai organization
pnpm dev                          # http://localhost:3000 → signs in with ibl.ai
```

Without an ibl.ai account, run in demo mode (fixed session, SDK panels show a notice):

```bash
NEXT_PUBLIC_DEMO=1 pnpm dev
node scripts/screenshots.mjs      # regenerate docs/screenshots (demo server running)
node scripts/audit-layout.mjs     # check every page at 375–1920px for broken layout
```

Sign-in returns only to origins on your organization's allowed redirect origins on ibl.ai; add
`http://localhost:3000` and the deployed hostname there.

## Documentation

### Using the console
| Document | What it covers |
|---|---|
| [docs/console.md](docs/console.md) | Every page with screenshots, and what each control does |
| [docs/guides/connect-data-sources.md](docs/guides/connect-data-sources.md) | Adding databases and HTTP APIs: read-only logins, scope, PII, what Connect & Dissect does, troubleshooting |
| [docs/guides/permissions.md](docs/guides/permissions.md) | Policies ↔ toolsets, sign-in methods, row-level restriction, PII, writes, origins, audit |
| [docs/guides/connect-agents.md](docs/guides/connect-agents.md) | Attaching ibl.ai OS agents; Claude Desktop and Claude Code, Codex, Cursor, Python, cURL |

### Architecture and operations
| Document | What it covers |
|---|---|
| [docs/auth.md](docs/auth.md) | ibl.ai SSO: the session as iblai/os implements it, how this console wires it, configuration, demo mode |
| [docs/network.md](docs/network.md) | Topology, VPN-only inbound, outbound to `ext.ibl.ai` and data sources, what runs where, hardening |
| [docs/data-sources.md](docs/data-sources.md) | Where every value on screen comes from: ibl.ai, the dissection engine, or the server runtime |
| [docs/plan.md](docs/plan.md) | What is built and the order of the remaining work |

### Screenshots
All in [docs/screenshots/](docs/screenshots/), one per page and tab:
[Dashboard](docs/screenshots/01-dashboard.png) ·
[Systems](docs/screenshots/02-systems.png) ·
[Systems · HTTP API](docs/screenshots/02b-systems-http-api.png) ·
[Map](docs/screenshots/03-map.png) ·
[Ontology](docs/screenshots/04-ontology.png) ·
[MCP Servers](docs/screenshots/05-mcp-servers.png) ·
[New MCP Server](docs/screenshots/06-mcp-new.png) ·
[Server · Connect](docs/screenshots/07-server-connect.png) ·
[Server · Playground](docs/screenshots/07b-server-playground.png) ·
[Server · Activity](docs/screenshots/07c-server-activity.png) ·
[Server · Tokens & Origins](docs/screenshots/07d-server-tokens.png) ·
[Agents](docs/screenshots/08-agents.png) ·
[Roles](docs/screenshots/09-roles.png) ·
[Access](docs/screenshots/10-access.png) ·
[Catalog](docs/screenshots/11-catalog.png) ·
[Compilation](docs/screenshots/12-compilation.png) ·
[Config](docs/screenshots/13-config.png) ·
[Notifications](docs/screenshots/14-notifications.png) ·
[Collapsed Sidebar](docs/screenshots/15-collapsed-sidebar.png) ·
[Organization Menu](docs/screenshots/16-organization-menu.png) ·
[Management Dialog](docs/screenshots/17-management-dialog.png) ·
[Phone](docs/screenshots/18-mobile.png) ·
[Phone Menu](docs/screenshots/19-mobile-menu.png)

## Repository layout

| Path | What it is |
|---|---|
| [`frontend/`](frontend/) | Next.js 16 console in the ibl.ai shell (os.ibl.ai header and sidebar, Open Sans, `#0058cc`). See [frontend/README.md](frontend/README.md). |
| [`frontend/lib/mock.ts`](frontend/lib/mock.ts) | All data shown today, tagged by system of record |
| [`frontend/.env.example`](frontend/.env.example) | Environment switches |
| [`frontend/scripts/screenshots.mjs`](frontend/scripts/screenshots.mjs) | Regenerates every screenshot in `docs/screenshots/` |
| [`frontend/scripts/audit-layout.mjs`](frontend/scripts/audit-layout.mjs) | Checks every page at six widths for overflow, overlap and sideways scrolling |
| [`frontend/providers/iblai-providers.tsx`](frontend/providers/iblai-providers.tsx) | ibl.ai SSO provider chain (see docs/auth.md) |
| [`frontend/AGENTS.md`](frontend/AGENTS.md) | Rules for coding agents, written by `next dev` |
| [`docs/`](docs/) | The documents above |
| [`.claude/launch.json`](.claude/launch.json) | Dev-server definition for the Claude desktop preview |
