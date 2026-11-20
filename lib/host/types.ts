// Every payload that crosses /api/host/*. Types only: the browser and the host both import this.
//
//   GET  /api/host/systems                    → HostSystem[]
//   POST /api/host/systems                    HostSystemInput → HostSystem
//   POST /api/host/systems/test               HostSystemInput → HostSystemTest
//   GET  /api/host/apis                       → HostApi[]
//   POST /api/host/apis                       HostApiInput → HostApi
//   POST /api/host/apis/spec                  { url, baseUrl?, authHeader? } → HostSpec
//   GET  /api/host/locals                     → HostLocal[]
//   POST /api/host/locals                     HostLocalInput → HostLocal
//   GET  /api/host/locals/browse?path=        → HostFolder
//   GET  /api/host/graph                      → HostGraph
//   GET  /api/host/toolsets                   → HostToolset[]
//   GET  /api/host/servers                    → HostServer[]
//   POST /api/host/servers/preview            { slug, draft } → HostPreview
//   GET  /api/host/servers/[slug]             → HostServerDetail, 404 when there is none
//   PUT  /api/host/servers/[slug]             { draft, start } → HostServerDetail
//   POST /api/host/servers/[slug]/rollback    → HostServerDetail
//   GET  /api/host/servers/[slug]/activity    → HostServerActivity
//   GET  /api/host/activity                   → HostEvent[]
//   ANY  /api/host/ao/[...path]               → the engine's own answer (lib/ao-types.ts)
//   POST /[platform]/[slug]/mcp               the gateway, JSON-RPC 2.0
//
// Every /api/host/* call names its platform in `x-ontology-platform`, beside its ibl.ai token.
// A failure is always { error } with the status that fits; `error` is the words to show.

export type HostErrorBody = { error: string };

/* ---------- systems (engine connections) ---------- */

export type HostSystemStatus = "ingested" | "ingesting" | "compiling";

export type HostSystem = {
  name: string; // the engine's connection name, which is its database's name
  label: string; // what the admin calls it; the name when they gave none
  engine: string; // the engine's connector type, e.g. "postgresql"
  url: string; // scheme://user@host:port/database, never a password
  tables: number | null; // tables the engine read; null before the first ingest
  scoped: boolean; // the connection names schemas or a table pattern
  piiColumns: number | null;
  terms: number | null; // terms mapped to its tables
  status: HostSystemStatus;
  serve: boolean; // the runtime has a source kind for it and the host holds its password
};

// The engine names a connection after its database, so a system's name is the URL's database.
export type HostSystemInput = {
  url: string; // scheme://user:password@host:port/database?options
  scope: string[]; // "SCHEMA" or "SCHEMA.TABLE"; empty means everything
  pii: boolean; // engine switch: PII detection
  probing: boolean; // engine switch: distinct-value probing
  label?: string; // what to call it; empty keeps the database's name
};

export type HostSystemTest = {
  ok: boolean;
  message: string; // the engine's words
  ms: number;
  tables: number | null; // tables visible to the login, when the engine says
};

/* ---------- what the engine read and inferred, in one answer ---------- */

export type HostGraphTable = {
  id: string; // the engine's table id
  name: string;
  system: string; // HostSystem.name
  schema: string | null;
  columns: number | null;
};

export type HostGraphMetric = { id: string; name: string; certified: boolean; expression: string };

export type HostGraphTerm = {
  id: string;
  name: string;
  description: string;
  synonyms: string[];
  certified: boolean; // its name and its description are both certified
  tags: string[];
  tables: string[]; // ids of the tables that represent it
  metrics: HostGraphMetric[]; // its SQL attributes
  properties: number; // its column attributes
};

export type HostCompile = {
  calculated: boolean; // a semantic layer exists
  running: boolean;
  lastSuccessAt: string | null; // ISO time
  lastFailureAt: string | null;
};

export type HostGraph = {
  systems: string[]; // HostSystem names, in the engine's order
  tables: HostGraphTable[];
  foreignKeys: [string, string][]; // table ids
  terms: HostGraphTerm[];
  termLinks: [string, string][]; // term ids
  compile: HostCompile;
};

/* ---------- custom HTTP APIs ---------- */

export type HostApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HostApiEndpoint = {
  name: string; // the tool's name
  method: HostApiMethod;
  path: string; // "/v3/objects/{id}"
  description: string;
  query: string[]; // query parameter names
  notes?: Record<string, string>; // what a path or query parameter means, by its name
};

export type HostApiInput = {
  name: string;
  baseUrl: string;
  authHeader: string; // "Authorization: Bearer <secret>" or "… ${NAME}"; may be empty
  endpoints: HostApiEndpoint[];
};

export type HostApi = {
  name: string;
  baseUrl: string;
  authHeader: string; // with ${NAME} where the secret was
  endpoints: HostApiEndpoint[];
  tools: number;
};

export type HostSpec = {
  title: string;
  endpoints: HostApiEndpoint[];
  withoutAuth?: string; // why the request with the auth header failed, when it came without it
};

/* ---------- filesystems (local://) ---------- */

export type HostLocalInput = {
  name: string; // names the toolset <name>-files and its two tools
  url: string; // local:///absolute/path, a folder or one file
};

export type HostLocal = { name: string; url: string };

export type HostFolderEntry = {
  name: string;
  dir: boolean;
  size: number; // bytes; 0 for a folder
  modified: string; // ISO time
};

/** One folder under ONTOLOGY_LOCAL_ROOT, as the file picker shows it. */
export type HostFolder = {
  root: string; // the root's real path: nothing above it is shown
  path: string; // the folder listed
  parent: string | null; // null at the root
  entries: HostFolderEntry[]; // folders first, then by name
  truncated: boolean; // it holds more than were listed
};

/* ---------- toolsets the host can offer ---------- */

export type HostTool = { name: string; sig: string; note?: string };

export type HostToolsetKind = "terms" | "raw" | "api" | "semantic" | "actions" | "files";

export type HostToolset = {
  name: string;
  summary: string;
  tools: HostTool[];
  defaultOn: boolean;
  risk?: "writes" | "unrestricted";
  kind: HostToolsetKind;
};

/* ---------- MCP servers ---------- */

export type HostAuth = {
  platform: boolean; // ibl.ai tokens and API keys, checked by the gateway
  entra?: { tenant: string; audience: string };
  google?: { audience: string };
  oidc?: { issuer: string; audience: string };
};

export type HostServerDraft = {
  toolsets: string[];
  auth: HostAuth;
  origins: string[];
  hosts: string[];
};

export type HostRevision = {
  n: number; // 1 for the first save
  id: string; // the twelve hex characters of the config's loaded- mark
  at: string; // ISO time
  tools: number;
  toolsets: number;
  bytes: number;
};

export type HostServer = {
  slug: string;
  revision: number; // the current revision's n; 0 when nothing was saved
  enabled: boolean; // deployed: the runtime should be up
  running: boolean; // the runtime process answers
  toolsets: number;
  tools: number;
  bytes: number; // size of tools.yaml
  port: number | null;
  deployedAt: string | null; // ISO time of the last deploy
  calls24h: number;
  top: string | null; // most called tool in the last 24 h
  draft: HostServerDraft; // what the builder last saved
};

export type HostServerDetail = HostServer & {
  yaml: string; // tools.yaml as written
  revisions: HostRevision[]; // newest first
};

export type HostPreview = { yaml: string; tools: number; toolsets: number };

/* ---------- what the gateway saw ---------- */

export type HostCall = {
  at: string; // ISO time
  tool: string;
  agent: string; // the label the agent's connection carries, or "—"
  user: string; // the ibl.ai username behind a session, or "—"
  session: string; // "—" until the platform sends one
  status: "ok" | "error";
  ms: number;
};

export type HostServerActivity = {
  calls: HostCall[]; // newest first
  log: string[]; // runtime log tail, oldest first, "HH:MM:SS LEVEL  text"
  calls24h: number;
  top: string | null;
  spark: { calls: number[]; top: number[] }; // 16 hourly buckets, oldest first
  byAgent: Record<string, number>; // calls in the last 24 h per agent label
};

export type HostEvent = {
  tag: "deploy" | "certify" | "compile" | "agent";
  tone: "green" | "blue" | "gray";
  text: string;
  at: string; // ISO time
  source: "TB" | "AO" | "IBL";
};

/* ---------- whether a server answers ---------- */

/** GET /api/host/health: a server answers here. */
export type HostHealth = { ok: true };

/* ---------- the gateway's tools, as an MCP client sees them ---------- */

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
};

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};
