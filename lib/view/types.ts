// What the pages render. These are the shapes lib/mock.ts gives them, plus the few fields
// real data adds (unique ids beside names, real PII flags and column kinds, numbers behind
// the detail strings). Demo mode fills them from the mock; live mode from the three systems.

import type { HostAuth } from "@/lib/host/types";

export type Tone = "gray" | "green" | "blue" | "amber" | "red";

/** What every read hook returns. `error` is the server's own words. */
export type Query<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/* ---------- systems ---------- */

export type SystemRow = {
  key: string; // stable per system; the graph clusters and tints by it
  name: string;
  engine: string; // display name, "PostgreSQL"
  abbr: string; // "PG"
  color: string;
  url: string; // never a password
  detail: string; // "42 tables · 2 PII columns"
  status: "ingested" | "ingesting" | "compiling";
  dissect: boolean;
  serve: boolean;
  tables: number | null;
  scoped: boolean;
  pii: number | null;
  terms: number | null;
};

export type ApiRow = { name: string; baseUrl: string; endpoints: number; tools: number };

/** One raw toolset per connected system, for the Prebuilt tab. */
export type PrebuiltRow = { toolset: string; label: string };

export type FileRow = { name: string; url: string };

export type SystemsView = {
  systems: SystemRow[];
  apis: ApiRow[];
  prebuilt: PrebuiltRow[];
  files: FileRow[];
};

/* ---------- map ---------- */

export type ColumnRow = {
  name: string;
  kind: "key" | "numeric" | "temporal" | "text";
  pii: boolean;
};

export type TableRow = {
  id: string; // unique across systems
  name: string; // what is drawn and printed
  src: string; // SystemRow.key
  rows: number | null;
  cols: ColumnRow[];
};

export type TermRow = {
  id: string;
  name: string;
  maps: string[]; // TableRow ids
  desc: string;
  syn: string[];
  certified: boolean;
  tags: string[];
};

export type MetricRef = { id: string; name: string; certified: boolean };

export type GraphView = {
  sources: { key: string; name: string; color: string }[];
  tables: TableRow[];
  foreignKeys: [string, string][]; // TableRow ids
  terms: TermRow[];
  termLinks: [string, string][]; // TermRow ids
  termMetrics: Record<string, MetricRef[]>; // by TermRow id
};

/** A log line as parts, so names read from a database are never set as HTML. */
export type LogPart = string | { b: string };
export type LogLine = { parts: LogPart[]; ok?: boolean };

export type BannerView = {
  termId: string;
  term: string;
  tables: string[]; // "sis.students"
  certified: boolean;
};

export type PipelineView = {
  current: number; // index of the first stage not done; 6 when all six are done
  busy: boolean; // a system is ingesting or a compile is running right now
  lines: LogLine[][]; // per stage, what to print when it completes
  banner: BannerView | null; // a term mapped to tables in several systems
};

/* ---------- ontology ---------- */

export type Status = "certified" | "suggested";

export type ObjectTypeRow = { id: string; name: string; systems: number; status: Status };

export type OntologyTree = {
  objectTypes: ObjectTypeRow[];
  linkTypes: string[];
  metrics: string[];
  actions: string[];
  tags: string[];
  certified: number; // header pill
  suggested: number; // header pill
};

export type BackingRow = { color: string; name: string; note: string };

export type PropertyRow = {
  id: string;
  name: string;
  key?: boolean;
  type: string;
  column: string;
  pii: boolean;
  status: Status;
};

export type LinkRow = { name: string; dir: "→" | "←"; target: string; via: string };

export type MetricRow = { id: string; name: string; expr: string; grain: string; status: Status };

export type ActionRow = { name: string; sig: string; via: string };

export type ObjectTypeView = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  systems: number;
  status: Status;
  synonyms: string[];
  backing: BackingRow[];
  properties: PropertyRow[];
  links: LinkRow[];
  metrics: MetricRow[];
  actions: ActionRow[];
};

/* ---------- MCP gateway ---------- */

export type ToolsetView = {
  name: string;
  summary: string;
  tools: { sig: string; note?: string }[];
  defaultOn: boolean;
  risk?: "writes" | "unrestricted";
};

export type ServerRow = {
  slug: string;
  url: string; // the endpoint agents call
  revision: number;
  enabled: boolean; // false is a draft
  toolsets: number;
  tools: number;
  calls24h: number;
  agents: number;
  top: string; // "—" when nothing was called
  deployedAgo: string; // "12m", "6d", "—"
  toolsetNames: string[];
  origins: string[];
  hosts: string[];
  auth: HostAuth;
  bytes: number; // size of tools.yaml
  port: number | null;
};

export type ServerView = ServerRow & { yaml: string };

export type CallRow = {
  t: string; // "14:02:09"
  tool: string;
  agent: string;
  user: string;
  session: string;
  status: "ok" | "error";
};

export type ServerActivityView = {
  calls: CallRow[];
  log: string[];
  spark: { calls: number[]; top: number[] };
};

export type KeyRow = {
  id: string;
  name: string;
  created: string;
  expires: string; // "—" when it does not expire
  policies: string[];
  groups: string[];
};

export type AgentRow = {
  id: string;
  name: string;
  kind: string; // "ibl.ai agent"
  server: string; // slug
  authScope: string;
  authType: string;
  status: string;
  calls: number;
};

/** An agent that could be given a server, for the attach dialog. */
export type AgentOption = { id: string; name: string };

export type ActivityRow = { tag: string; tone: Tone; text: string; when: string };

/* ---------- roles, compilation ---------- */

export type RoleRow = {
  name: string; // the policy's name, "Ontology: advising"
  toolsets: string[];
  all: boolean; // holds every read toolset
  holders: { label: string; kind: "group" | "user"; users: number | null }[];
};

export type EngineView = {
  running: boolean;
  lastSuccess: string | null; // "3h ago"
  lastFailure: string | null;
  switches: { compilation: boolean; pii: boolean; probing: boolean };
  timeout: string | null; // the engine's SQL timeout, when it says
  terms: number;
  relationships: number;
};

/** The sidebar's badges; null hides one until its number is known. */
export type CountsView = {
  systems: number | null;
  catalog: number | null; // tables
  ontology: number | null; // terms
  gateway: number | null; // tools across servers
  roles: number | null;
  agents: number | null;
};

/* ---------- playground ---------- */

export type PlayTool = { name: string; args: string }; // args: a JSON object to start from

export type ToolRun = {
  ok: boolean;
  status: number; // the HTTP status the gateway answered with
  ms: number;
  rows?: Record<string, unknown>[]; // a tool that returns records
  total?: number; // how many records there are in all, when `rows` holds fewer
  answer?: { text: string; sql: string | null; provenance: string | null }; // ask_question
  error?: string;
};
