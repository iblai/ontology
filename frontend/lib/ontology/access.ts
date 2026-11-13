import type { McpToolset, Role, RoleAccess } from "./types";

/** What deciding a role's tools needs: the toolsets, the tools that can change data, every tool. */
export interface Tooling {
  toolsets: McpToolset[];
  writing: ReadonlySet<string>;
  known: ReadonlySet<string>;
}

/** The tools a toolset lends: one not marked `write` never lends a tool that changes data. */
const lends = (ts: McpToolset, writing: ReadonlySet<string>) =>
  ts.write ? ts.tools : ts.tools.filter((t) => !writing.has(t));
/** Whether a role holds a toolset: by name, or through `*` when it only reads. */
const holds = (sets: string[], ts: McpToolset) =>
  sets.includes(ts.name) || (sets.includes("*") && !ts.write);

/** The tools a role may call, as the gateway works it out: its toolsets' tools, and those it holds by name. */
export function roleScope(role: Role, { toolsets, writing, known }: Tooling): Set<string> {
  const scope = new Set<string>();
  for (const ts of toolsets)
    if (holds(role.mcp_toolsets, ts)) for (const t of lends(ts, writing)) scope.add(t);
  for (const t of role.mcp_tools ?? []) if (known.has(t)) scope.add(t);
  return scope;
}

/** How many of `tools` a scope holds: what a switch shows. */
export function held(scope: ReadonlySet<string>, tools: string[]): "all" | "some" | "none" {
  const n = tools.filter((t) => scope.has(t)).length;
  return n === 0 ? "none" : n === tools.length ? "all" : "some";
}

/** How far a role reaches, as the backend says it: reading is a tool that only reads, or any memory or cache. */
export function accessLevel(role: Role, tooling: Tooling): RoleAccess {
  const scope = [...roleScope(role, tooling)];
  const writes = scope.some((t) => tooling.writing.has(t));
  const reads =
    role.memory_paths.length + role.cache_tables.length > 0 ||
    scope.some((t) => !tooling.writing.has(t));
  return reads && writes ? "read_write" : writes ? "write" : reads ? "read" : "none";
}

/**
 * The role after `tools` are switched on or off. On adds the missing ones by name; on a
 * toolset's own card (`own`) a role that ends up with all it lends holds the toolset, so a tool
 * added to it later comes along. Off takes them away however they were held: a toolset that
 * lent one is replaced by its other tools, by name, and `*` by the read-only toolsets it stood for.
 */
export function setTools(
  role: Role,
  tools: string[],
  on: boolean,
  tooling: Tooling,
  own?: string,
): Role {
  const { toolsets, writing, known } = tooling;
  const named = new Set(role.mcp_tools ?? []);
  let sets = role.mcp_toolsets;
  if (on) {
    const scope = roleScope(role, tooling);
    for (const t of tools) if (!scope.has(t)) named.add(t);
    const ts = toolsets.find((x) => x.name === own);
    const lent = ts ? lends(ts, writing) : [];
    const reach = roleScope({ ...role, mcp_tools: [...named] }, tooling);
    if (ts && lent.length > 0 && !holds(sets, ts) && lent.every((t) => reach.has(t))) {
      sets = [...sets, ts.name];
      for (const t of lent) named.delete(t);
    }
  } else {
    const gone = new Set(tools);
    const lost = (ts: McpToolset) => lends(ts, writing).some((t) => gone.has(t));
    if (sets.includes("*") && toolsets.some((ts) => !ts.write && lost(ts)))
      sets = [
        ...new Set([
          ...toolsets.filter((ts) => !ts.write).map((ts) => ts.name),
          ...sets.filter((s) => s !== "*"),
        ]),
      ];
    sets = sets.filter((name) => {
      const ts = toolsets.find((x) => x.name === name);
      if (!ts || !lost(ts)) return true;
      for (const t of lends(ts, writing)) named.add(t);
      return false;
    });
    for (const t of gone) named.delete(t);
  }
  // A name no tool answers to any more is not carried on.
  return { ...role, mcp_toolsets: sets, mcp_tools: [...named].filter((t) => known.has(t)).sort() };
}
