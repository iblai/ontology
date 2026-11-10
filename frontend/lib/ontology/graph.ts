import type { GraphData, GraphKind, GraphLink, GraphLinkKind, GraphNode, Role } from "./types";

/** The viewport background (dataviz dark surface the palette was validated on). */
export const SURFACE = "#0f1526";

/** Dark-surface palette slots per kind; hubs (memory domains) are white, leaves grey. */
export const KIND_COLORS: Record<GraphKind, string> = {
  service: "#3987e5",
  table: "#199e70",
  entity_group: "#008300",
  source: "#d95926",
  tool: "#c98500",
  toolset: "#9085e9",
  role: "#d55181",
  schedule: "#e66767",
  memory_domain: "#f5f5f4",
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

/** What a role can reach: grants → toolsets → tools → sources/tables, plus memory and cache grants. */
export function reach(
  links: GraphLink[],
  roleId: string,
): { nodes: Set<string>; granted: Set<string> } {
  const forward: Record<string, GraphLinkKind[]> = {
    role: ["grants", "reads", "caches"],
    toolset: ["contains"],
    tool: ["uses_source", "queries"],
    service: ["has_table"],
    table: ["has_column", "in_group"],
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
        else if (kind === "source" && l.kind === "exposes" && endId(l.target) === id)
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

/**
 * The role after granting or revoking one target; `*` becomes an explicit list on the first
 * revoke. A cache toggle names its domain's tables, granted and revoked together.
 */
export function toggleGrant(
  role: Role,
  kind: ToggleKind,
  name: string | string[],
  all: string[],
): Role {
  const names = [name].flat();
  if (kind === "memory_domain") {
    const broad = (p: string) => /^\/ontology\/\*\*?\/?$/.test(p);
    const paths = role.memory_paths.some(broad)
      ? all.map((d) => `/ontology/${d}/**`)
      : role.memory_paths.filter((p) => !broad(p));
    const mine = (p: string) => p.split("/").filter(Boolean)[1] === names[0];
    const next = paths.some(mine)
      ? paths.filter((p) => !mine(p))
      : [...paths, `/ontology/${names[0]}/**`];
    return { ...role, memory_paths: next };
  }
  const key = kind === "toolset" ? "mcp_toolsets" : "cache_tables";
  const current = role[key].includes("*") ? all : role[key];
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
  const labels = targets.map((n) => n.label);
  const next = domain
    ? // `*` expands to every table a domain is cached in.
      toggleGrant(role, kind, cacheTables(domain), [...new Set(targets.flatMap(cacheTables))])
    : toggleGrant(role, kind, name, labels);
  // A wildcard became explicit: keep its edges, drop the flag; then flip the toggled one.
  const links = g.links
    .map((l) => (mine(l) ? { ...l, wildcard: false } : l))
    .filter((l) => !(mine(l) && endId(l.target) === targetId));
  if (!had) links.push({ source: roleId, target: targetId, kind: linkKind });
  return { role: next, links, had };
}

export function searchGraph(nodes: GraphNode[], query: string, limit = 8): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter(
      (n) =>
        n.kind !== "missing" &&
        (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function isGraphData(d: GraphData | null): d is GraphData {
  return !!d && Array.isArray(d.nodes);
}
