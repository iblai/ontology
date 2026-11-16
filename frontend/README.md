# Ontology console (frontend)

Next.js 16 app in the ibl.ai shell. Today every page renders from [`lib/mock.ts`](lib/mock.ts),
where each export is tagged with the system of record it will be read from (ibl.ai, the dissection
engine, or the server runtime). See the [repository README](../README.md) for the full
documentation set.

```bash
pnpm install
pnpm dev                          # http://localhost:3000
node scripts/screenshots.mjs      # refresh ../docs/screenshots (dev server must be running; uses installed Chrome)
```

| Path | What it is |
|---|---|
| `app/(app)/*` | One folder per console route: dashboard, systems, map, ontology, mcp, mcp/new, mcp/[slug], agents, roles, access, catalog, sync (Compilation), config |
| `components/shell/` | Sidebar, header, page primitives and the prototype walkthrough stepper |
| `components/graph/ontology-graph.tsx` | Canvas force graph used on the Map |
| `components/ui/` | shadcn components (base-nova on Base UI) |
| `lib/mock.ts` | All data shown today, tagged IBL / AO / TB |
| `.env.example` | Environment switches (walkthrough, ibl.ai SSO, API base) |
| `AGENTS.md` | Rules written by `next dev` for coding agents; keep it committed |
