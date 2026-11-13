import type { GraphData, GraphKind, GraphLink, GraphLinkKind, GraphNode, Role } from "./types";

/** The viewport background: white, the surface the palette's light steps are made for. */
export const SURFACE = "#ffffff";
/** Ink on that surface: hubs, labels and links. */
export const INK = "#0b0b0b";

/** Light-surface palette slots per kind; hubs (memory domains) are ink, leaves grey. */
export const KIND_COLORS: Record<GraphKind, string> = {
  service: "#2a78d6",
  table: "#1baf7a",
  entity_group: "#008300",
  // The palette has no ninth hue: a term wears its tables' colour and is drawn as a diamond.
  term: "#1baf7a",
  source: "#eb6834",
  tool: "#eda100",
  toolset: "#6250d6",
  role: "#e87ba4",
  schedule: "#e34948",
  memory_domain: INK,
  column: "#898781",
  memory_record: "#898781",
  missing: "#898781",
};
export const KINDS = Object.keys(KIND_COLORS) as GraphKind[];
/** Sync flow edges, drawn with moving particles. */
export const FLOW: ReadonlySet<GraphLinkKind> = new Set(["syncs_from", "runs", "writes"]);
/** Edges a role grants directly; toggled from the graph. */
export const GRANT: ReadonlySet<GraphLinkKind> = new Set(["grants", "reads", "caches"]);

/** force-graph replaces link ends with node objects once it runs; read the id either way. */
export const endId = (end: unknown): string =>
  typeof end === "object" && end !== null ? String((end as { id: string }).id) : String(end);

export function degrees(links: GraphLink[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) {
    out.set(endId(l.source), (out.get(endId(l.source)) ?? 0) + 1);
    out.set(endId(l.target), (out.get(endId(l.target)) ?? 0) + 1);
  }
  return out;
}

/** Ids within `hops` links of `id`, including `id`. */
export function neighbourhood(links: GraphLink[], id: string, hops = 1): Set<string> {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    adj.set(s, [...(adj.get(s) ?? []), t]);
    adj.set(t, [...(adj.get(t) ?? []), s]);
  }
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const n of frontier)
      for (const m of adj.get(n) ?? [])
        if (!seen.has(m)) {
          seen.add(m);
          next.push(m);
        }
    frontier = next;
  }
  return seen;
}

/** What a role can reach: grants → toolsets and tools → sources/tables and the terms they hold, plus memory and cache grants. */
export function reach(
  links: GraphLink[],
  roleId: string,
): { nodes: Set<string>; granted: Set<string> } {
  const forward: Record<string, GraphLinkKind[]> = {
    role: ["grants", "reads", "caches"],
    toolset: ["contains"],
    tool: ["uses_source", "queries"],
    service: ["has_table"],
    // An inferred join is not followed: reaching one table is not reaching the other.
    table: ["has_column", "in_group", "represents"],
  };
  const nodes = new Set([roleId]);
  const granted = new Set<string>();
  let frontier = [roleId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      const kind = id.split(":")[0];
      const wanted = new Set(forward[kind] ?? []);
      for (const l of links) {
        let t: string | null = null;
        if (wanted.has(l.kind) && endId(l.source) === id) t = endId(l.target);
        // The system behind a source, or behind a tool the gateway runs on the system itself.
        else if (
          (kind === "source" || kind === "tool") &&
          l.kind === "exposes" &&
          endId(l.target) === id
        )
          t = endId(l.source);
        if (t === null) continue;
        if (GRANT.has(l.kind) && endId(l.source) === id) granted.add(t);
        if (!nodes.has(t)) {
          nodes.add(t);
          next.push(t);
        }
      }
    }
    frontier = next;
  }
  return { nodes, granted };
}

export type ToggleKind = "toolset" | "memory_domain" | "cache";
/** The edge each toggle kind flips. */
export const LINK_OF: Record<ToggleKind, GraphLinkKind> = {
  toolset: "grants",
  memory_domain: "reads",
  cache: "caches",
};

/**
 * The tables a memory domain is cached in, which a role's cache grant has to name. A backend
 * says which (none: nothing to grant); the demo data caches a domain under its own name.
 */
export function cacheTables(domain: GraphNode): string[] {
  const tables = domain.meta.cache_tables;
  return Array.isArray(tables) ? tables.map(String) : [domain.label];
}

/** Whether a role may query a memory domain's cache: it holds one of the domain's tables. */
export function cachesDomain(role: Role, domain: GraphNode): boolean {
  const held = role.cache_tables;
  return cacheTables(domain).some((table) => held.includes("*") || held.includes(table));
}

/** A memory path over every domain. */
const broad = (p: string) => /^\/ontology\/\*\*?\/?$/.test(p);
const segments = (p: string) => p.split("/").filter(Boolean);

/** How much of a memory domain a role reads: all of it, only some paths under it, or none. */
export function readsDomain(role: Role, domain: string): "all" | "part" | "none" {
  if (role.memory_paths.some(broad)) return "all";
  const mine = role.memory_paths.map(segments).filter((s) => s[1] === domain);
  if (mine.length === 0) return "none";
  return mine.some((s) => s.length === 3 && /^\*\*?$/.test(s[2])) ? "all" : "part";
}

/**
 * The role after granting or revoking one target; `*` becomes an explicit list on the first
 * revoke. A cache toggle names its domain's tables, granted and revoked together. For toolsets
 * `all` is the read-only ones `*` stands for; any other toolset flips by name, beside `*`.
 */
export function toggleGrant(
  role: Role,
  kind: ToggleKind,
  name: string | string[],
  all: string[],
): Role {
  const names = [name].flat();
  if (kind === "memory_domain") {
    const paths = role.memory_paths.some(broad)
      ? all.map((d) => `/ontology/${d}/**`)
      : role.memory_paths.filter((p) => !broad(p));
    const mine = (p: string) => segments(p)[1] === names[0];
    const next = paths.some(mine)
      ? paths.filter((p) => !mine(p))
      : [...paths, `/ontology/${names[0]}/**`];
    return { ...role, memory_paths: next };
  }
  const key = kind === "toolset" ? "mcp_toolsets" : "cache_tables";
  const held = role[key];
  let current = held;
  if (held.includes("*")) {
    if (kind === "cache") current = all;
    else if (names.some((n) => all.includes(n)))
      current = [...new Set([...all, ...held.filter((x) => x !== "*")])];
  }
  const next = names.some((n) => current.includes(n))
    ? current.filter((x) => !names.includes(x))
    : [...current, ...names];
  return { ...role, [key]: next };
}

/** One grant flip: the next role and the links patched to match; `had` = it was granted before. */
export function grantPatch(
  g: GraphData,
  role: Role,
  kind: ToggleKind,
  name: string,
): { role: Role; links: GraphLink[]; had: boolean } {
  const nodeKind = kind === "toolset" ? "toolset" : "memory_domain";
  const targets = g.nodes.filter((n) => n.kind === nodeKind);
  const linkKind = LINK_OF[kind];
  const roleId = `role:${role.name}`;
  const targetId = `${nodeKind}:${name}`;
  const mine = (l: GraphLink) => l.kind === linkKind && endId(l.source) === roleId;
  const domain = kind === "cache" ? targets.find((n) => n.label === name) : undefined;
  // A cache grant is read off the role's tables: an edge can stand for a table of another name.
  const had = domain
    ? cachesDomain(role, domain)
    : g.links.some((l) => mine(l) && endId(l.target) === targetId);
  // `*` stands for the read-only toolsets only.
  const labels = targets.filter((n) => kind !== "toolset" || !n.meta.write).map((n) => n.label);
  const next = domain
    ? // `*` expands to every table a domain is cached in.
      toggleGrant(role, kind, cacheTables(domain), [...new Set(targets.flatMap(cacheTables))])
    : toggleGrant(role, kind, name, labels);
  // A wildcard that became explicit keeps its edges and drops the flag; then flip the toggled one.
  const wild = kind === "toolset" && next.mcp_toolsets.includes("*");
  const links = g.links
    .map((l) => (mine(l) && !wild ? { ...l, wildcard: false } : l))
    .filter((l) => !(mine(l) && endId(l.target) === targetId));
  if (!had) links.push({ source: roleId, target: targetId, kind: linkKind });
  return { role: next, links, had };
}

/** "Financial aid advisors" -> "FinancialAidAdvisors"; numbered when taken or nothing Latin is left. */
export function technicalName(display: string, taken: string[]): string {
  const joined = (display.match(/[A-Za-z0-9]+/g) ?? [])
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  // A role's name starts with a letter and holds 64 characters at most, its number included.
  const base = (/^[A-Za-z]/.test(joined) ? joined : `Role${joined}`).slice(0, 60);
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (joined && !used.has(base.toLowerCase())) return base;
  for (let n = joined ? 2 : 1; ; n++)
    if (!used.has(`${base}${n}`.toLowerCase())) return `${base}${n}`;
}

export function searchGraph(nodes: GraphNode[], query: string, limit = 8): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter(
      (n) =>
        n.kind !== "missing" &&
        // A term is found by its other names too.
        [n.label, n.id, ...(Array.isArray(n.meta.synonyms) ? n.meta.synonyms : [])].some((s) =>
          String(s).toLowerCase().includes(q),
        ),
    )
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function isGraphData(d: GraphData | null): d is GraphData {
  return !!d && Array.isArray(d.nodes);
}
