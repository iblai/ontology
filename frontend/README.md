# Ontology console (frontend)

Next.js 16 app in the ibl.ai shell. Today every page renders from [`lib/mock.ts`](lib/mock.ts),
where each export is tagged with the system of record it will be read from (ibl.ai, the dissection
engine, or the server runtime). See the [repository README](../README.md) for the full
documentation set.

```bash
pnpm install
cp .env.example .env.local        # NEXT_PUBLIC_MAIN_TENANT_KEY=<your ibl.ai org>
pnpm dev                          # http://localhost:3000, ibl.ai sign-in
NEXT_PUBLIC_DEMO=1 pnpm dev       # no sign-in, fixed demo session
node scripts/screenshots.mjs      # refresh ../docs/screenshots (demo server running; uses installed Chrome)
node scripts/audit-layout.mjs     # layout audit at 375–1920px
```

| Path | What it is |
|---|---|
| `app/(app)/*` | One folder per console route: dashboard, systems, map, ontology, mcp, mcp/new, mcp/[slug], agents, roles, access, catalog, sync (Compilation), config |
| `components/shell/` | Sidebar, header, page primitives and the prototype walkthrough stepper |
| `components/graph/ontology-graph.tsx` | Canvas force graph used on the Map |
| `components/ui/` | shadcn components (base-nova on Base UI) |
| `lib/mock.ts` | Ontology data shown today, tagged IBL / AO / TB |
| `providers/`, `lib/iblai/`, `store/`, `app/(auth)/` | ibl.ai SSO (provider chain, session, SDK store, sign-in callback) |
| `components/shell/app-shell.tsx`, `account-dialog.tsx` | Shell state, the OS-style footer dialogs hosting SDK tabs |
| `.env.example` | Environment switches (walkthrough, ibl.ai SSO, API base) |
| `AGENTS.md` | Rules written by `next dev` for coding agents; keep it committed |
