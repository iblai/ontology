// The ontology's namespace in ibl.ai RBAC. The host reads a caller's grants under it;
// the browser writes roles and policies into it. Ported from the old product's role_source.py.

export const ROOT = "/custom/ontology/";

// Per kind of resource under ROOT, the verb a role must hold for the resource to count.
export const VERBS = {
  toolsets: "Ontology/Toolsets/action",
  tools: "Ontology/Tools/action",
  console: "Ontology/Console/action",
} as const;
export type GrantKind = keyof typeof VERBS;

// What a role the console creates holds.
export const ALL_VERBS = "Ontology/*";
// A role's one policy is named this plus the role's name.
export const POLICY_PREFIX = "Ontology: ";
// One segment of a resource: letters, digits, - and _ only.
export const NAME = /^[A-Za-z0-9_-]+$/;

export const ALL_TOOLSETS = `${ROOT}toolsets/`;
export const CONSOLE = `${ROOT}console/`;
export const toolsetResource = (name: string) => `${ROOT}toolsets/${name}/`;
export const toolResource = (name: string) => `${ROOT}tools/${name}/`;
