// A caller's ibl.ai grants under /custom/ontology/, read into what they may reach. Pure.
// Ported from the old product's identity/role_source.py (_holds, _read, granted).

import { NAME, ROOT, VERBS, type GrantKind } from "@/lib/ontology-rbac";

/** As the DM resolves them: { resource: { actions: [...] } }. */
export type Grants = Record<string, { actions?: string[] }>;

export type Scope = {
  everything: boolean; // a platform admin: every toolset, those that write too
  allToolsets: boolean; // every toolset that only reads
  toolsets: string[]; // toolsets held by name; a role reaches one that writes only this way
  tools: string[]; // single tools held by name
  console: boolean;
};

// An action as fnmatch reads it, anchored: `*` is any run of characters, `?` any one.
const glob = (action: string) =>
  new RegExp(
    `^${action
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "s",
  );

const holds = (actions: unknown, verb: string) =>
  Array.isArray(actions) &&
  actions.some((action) => typeof action === "string" && glob(action).test(verb));

/** What `grants` amount to. A resource counts only where it is held with its kind's verb. */
export function scopeOf(grants: Grants): Scope {
  const toolsets = new Set<string>();
  const tools = new Set<string>();
  let allToolsets = false;
  let console = false;
  for (const [resource, held] of Object.entries(grants)) {
    const has = (kind: GrantKind) => holds(held?.actions, VERBS[kind]);
    const path = resource.endsWith("/") ? resource : `${resource}/`;
    // The root, or a parent of it, covers every kind; the whole of tools lends no tool.
    if (ROOT.startsWith(path)) {
      allToolsets ||= has("toolsets");
      console ||= has("console");
      continue;
    }
    if (!path.startsWith(ROOT)) continue;
    const rest = path.slice(ROOT.length);
    const kind = rest.slice(0, rest.indexOf("/"));
    const tail = rest.slice(kind.length + 1, -1); // "" for the whole kind
    if (kind === "toolsets" && has("toolsets")) {
      if (!tail) allToolsets = true;
      else if (NAME.test(tail)) toolsets.add(tail);
    } else if (kind === "tools" && has("tools") && NAME.test(tail)) tools.add(tail);
    else if (kind === "console" && has("console") && !tail) console = true;
  }
  // No grant amounts to everything: that is a platform admin's alone (adminScope).
  return {
    everything: false,
    allToolsets,
    toolsets: [...toolsets].sort(),
    tools: [...tools].sort(),
    console,
  };
}

/** What a platform admin reaches with no role listing them: every toolset and the console. */
export function adminScope(held: Scope): Scope {
  return { ...held, everything: true, allToolsets: true, console: true };
}

/** Whether the scope reaches anything at all. */
export function reaches(scope: Scope): boolean {
  return (
    scope.everything ||
    scope.allToolsets ||
    scope.console ||
    scope.toolsets.length > 0 ||
    scope.tools.length > 0
  );
}
