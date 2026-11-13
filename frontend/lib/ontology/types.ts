export type ServiceStatus = "pending" | "active" | "inactive" | "error";
export type ServiceType = "database" | "api";
export type SafetyStatus = "passed" | "failed" | "pending" | "error";
export type SyncStatus = "never_run" | "success" | "failed" | "running";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type SyncRunStatus = "running" | "success" | "failed";
export type SyncMode = "full" | "delta" | "event";
export type SafetyTestResult = "passed" | "failed" | "error";
export type Domain =
  | "higher-ed"
  | "enterprise"
  | "k-12"
  | "government"
  | "legal"
  | "financial-services"
  | "medical-healthcare";

export const STEP_TYPES = [
  "cache_schema",
  "text_templates",
  "mcp_tools",
  "sync_schedules",
  "docker_compose",
  "validation",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const SAFETY_TESTS = [
  "CREATE TABLE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP TABLE",
  "ALTER TABLE",
  "TRUNCATE",
] as const;
export type SafetyTestName = (typeof SAFETY_TESTS)[number];

export interface SafetyTestRecord {
  test_name: SafetyTestName;
  sql_attempted: string;
  result: SafetyTestResult;
  detail: string;
}

export interface SafetyReport {
  service_name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  status: "passed" | "failed" | "error";
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  // The persisted SafetyReport model stores details as a flat {test_name: result}
  // dict; this array form matches the runtime SafetyVerificationResult that
  // `service test` computes. The future REST API must re-derive the array from
  // the persisted dict (or the model should be widened to store the array).
  details: SafetyTestRecord[];
  error_message?: string;
  remediation_sql?: string;
  created_at: string;
}

export interface ProvisioningStep {
  id: string;
  run_id: string;
  step_type: StepType;
  status: StepStatus;
  order: number;
  started_at?: string;
  completed_at?: string;
  // Backend model field is a JSONField; e.g. {ok: true}, {skipped: "..."}, or
  // {tables: [{table, records, ok}]} for the validation step.
  output?: Record<string, unknown>;
  error_message?: string;
}

export interface ProvisioningRun {
  id: string;
  service_name: string;
  status: RunStatus;
  started_at: string;
  completed_at?: string;
  error_message?: string;
  config_snapshot?: Record<string, unknown>;
  steps: ProvisioningStep[];
}

export interface SchemaManifestTable {
  schema_name: string;
  table_name: string;
  row_count: number;
  column_count: number;
  /** The business term generated for it, where it has one. */
  term?: string;
  // Mock-only: the real API keeps these in llm_analysis and the map response.
  entity_group?: string;
  description?: string;
}

export interface SchemaManifest {
  db_type: string;
  total_tables: number;
  total_rows: number;
  tables: SchemaManifestTable[];
  /** The database a system holds, as its own server names it. */
  database?: string;
  /** An Auto Ontology server's reading: the terms read, out of `of` it has. */
  terms?: number;
  of?: number;
  /** That reading's terms, counted per database NVIDIA knows. */
  databases?: { name: string; terms: number }[];
}

export interface ServiceHealth {
  id: string;
  service_name: string;
  connected: boolean;
  read_only: boolean;
  latency_ms: number;
  checked_at: string;
  // Backend model field is a JSONField (default=dict); e.g. {ok: true} or
  // {error: "Connection refused"}.
  detail?: Record<string, unknown>;
}

export interface Service {
  name: string;
  display_name: string;
  service_type: ServiceType;
  adapter: string;
  status: ServiceStatus;
  host: string;
  // port/database are not model columns on the backend Service; they live inside
  // the encrypted connection_config blob. The future REST API must decrypt and
  // flatten them for the UI to render.
  port?: number;
  database?: string;
  connection_config: Record<string, string>;
  schema_manifest?: SchemaManifest;
  llm_analysis?: Record<string, unknown>;
  last_discovery_at?: string;
  last_safety_check_at?: string;
  safety_status: SafetyStatus;
  last_sync_at?: string;
  sync_status: SyncStatus;
  tables_synced: number;
  rows_synced: number;
  // domain is not a Service model column; it's a CatalogEntry attribute. The
  // future REST API must infer it from adapter -> catalog lookup.
  domain: Domain;
}

export interface SyncSchedule {
  name: string;
  cron: string;
  source: string;
  tool: string;
  /** A database schedule reads `table` through `service`'s own connection; `tool` is for API sources. */
  service?: string;
  table?: string;
  mode: SyncMode;
  description: string;
  enabled: boolean;
}

export interface SyncRun {
  id: string;
  schedule_name: string;
  source_system: string;
  started_at: string;
  completed_at?: string;
  status: SyncRunStatus;
  records_processed: number;
  records_created: number;
  records_updated: number;
  error_message?: string;
  duration_seconds: number;
}

export interface McpSource {
  kind: "source";
  name: string;
  type: string;
  host?: string;
  // A number in YAML, a string from the API (tools.yaml may hold a ${VAR} reference).
  port?: number | string;
  database?: string;
  user?: string;
  password?: string;
}

export interface McpToolParameter {
  name: string;
  type: string;
  description: string;
  // required is a UI extension; the real tools.yaml schema only has
  // name/type/description, so this will be undefined when served by the real API.
  required?: boolean;
}

export interface McpTool {
  kind: "tool";
  name: string;
  type: string;
  source: string;
  description: string;
  parameters: McpToolParameter[];
  statement?: string;
  /** The system a tool is an operation or an endpoint of; such a tool comes and goes with it. */
  service?: string;
  /** What such a tool sends: an endpoint's method and path, or POST and PATCH for Twenty's. */
  method?: string;
  path?: string;
}

/** One endpoint of a custom API, as it was entered; `tool` is what an agent calls. */
export interface ServiceEndpoint {
  name: string;
  tool: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Under the system's address, with `{name}` where a value goes. */
  path: string;
  query: string[];
  /** It takes a JSON body, as one object. */
  body: boolean;
  /** It changes data: every method but GET. */
  write: boolean;
}

/** A term's columns and calculations, read from its Auto Ontology server when its panel opens. */
export interface TermDetail {
  ok: boolean;
  message: string;
  columns: {
    name: string;
    description: string;
    certified: boolean;
    table: string;
    column: string;
  }[];
  calculations: { name: string; description: string; expression: string; certified: boolean }[];
}

export interface McpToolset {
  kind: "toolset";
  name: string;
  tools: string[];
  /** Its tools change data: a role holds it by name, never through `*`. */
  write?: boolean;
}

export interface GatewayHealth {
  running: boolean;
  url: string;
  tool_count: number;
  toolset_count: number;
  active_sessions: number;
}

export interface ComplianceIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ComplianceReport {
  ok?: boolean;
  message?: string;
  sources: number;
  tools: number;
  toolsets: number;
  issues: ComplianceIssue[];
}

export interface DbHealth {
  healthy: boolean;
  table_count: number;
  total_rows: number;
  size_mb: number;
  active_connections: number;
}

export interface McpServerHealth {
  reachable: boolean;
  latency_ms: number;
  tool_count: number;
  name: string;
}

export interface SyncHealth {
  // Backend field is a bool, not a count.
  running: boolean;
  total_schedules: number;
  failed_last_24h: number;
  next_due_schedule?: string;
  next_due_at?: string;
}

export interface StorageHealthDomain {
  domain: string;
  files: number;
  size_mb: number;
}

export interface StorageHealth {
  total_files: number;
  total_size_mb: number;
  by_domain: StorageHealthDomain[];
}

export interface HealthSnapshot {
  db: DbHealth;
  mcp_servers: McpServerHealth[];
  sync: SyncHealth;
  storage: StorageHealth;
  gateway: GatewayHealth;
  checked_at: string;
}

export interface CatalogEntry {
  key: string;
  display_name: string;
  type: ServiceType;
  domain: Domain;
  adapter: string;
  default_toolset: string;
  skill: string | null;
  summary: string;
  env: string[];
  connection: Record<string, unknown>;
  sync_defaults: Record<string, string>;
}

/** How far a role reaches, worked out from its grants. */
export type RoleAccess = "none" | "read" | "write" | "read_write";

export interface Role {
  name: string;
  display_name: string;
  mcp_toolsets: string[];
  /** Tools held by their own name, beside what the toolsets lend; absent from an older backend. */
  mcp_tools?: string[];
  /** Sent by the backend, never saved; absent from an older one. */
  access?: RoleAccess;
  memory_paths: string[];
  cache_tables: string[];
  admin_dashboard: boolean;
  agents: string[];
  concurrency_limits?: {
    max_records_per_query?: number;
    max_export_rows?: number;
  };
}

/** One of the platform's agents, as the console picks one. */
export interface Agent {
  id: string;
  name: string;
}

/** An agent that reaches this gateway with one role's reach; its key is never sent. */
export interface AgentConnection {
  name: string;
  agent: string;
  agent_name: string;
  role: string;
  /** Twelve characters of the key's hash: what the audit log names its calls by. */
  fingerprint: string;
  created_at: string;
  created_by: string;
}

export interface QuickCounts {
  services: number;
  tools: number;
  toolsets: number;
  roles: number;
  /** Where the settings live: the backend's host, the ibl.ai platform (dm), or only its roles there (rbac). */
  data_store: "local" | "rbac" | "dm";
  /** The backend's own platform, by key; empty when it names none. */
  platform: string;
}

export interface Db {
  services: Service[];
  provisioning_runs: ProvisioningRun[];
  service_health: ServiceHealth[];
  safety_reports: SafetyReport[];
  sync_schedules: SyncSchedule[];
  sync_runs: SyncRun[];
  mcp_sources: McpSource[];
  mcp_tools: McpTool[];
  mcp_toolsets: McpToolset[];
  roles: Role[];
  agent_connections: AgentConnection[];
  health: HealthSnapshot;
}
// ---- Backend configuration visibility (read-only; secrets masked server-side) ----

export interface BackendConfigFile {
  /** Stable id: ontology | schedules | roles | tools | catalog | compose | caddyfile | env */
  id: string;
  /** Repo-relative path under the ontology root. */
  path: string;
  format: "yaml" | "caddyfile" | "env";
  exists: boolean;
  /** Optional files (e.g. .env) render as "not present" rather than an error. */
  optional: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  /** Raw file content with credential-looking values masked. */
  content: string | null;
  /** Parse error, if the summary could not be derived. */
  error?: string;
  /** Parsed highlights (counts, names) — never raw secret values. */
  summary: { label: string; value: string }[];
}

export interface BackendConfigSnapshot {
  root: string;
  generatedAt: string;
  files: BackendConfigFile[];
}

// ---- Table edits (PATCH /services/{name}/tables) ----

export interface TableEdit {
  tables: string[];
  entity_group?: string;
  description?: string;
}

// ---- Relationship graph (GET /graph) ----

export type GraphKind =
  | "service"
  | "table"
  | "column"
  | "entity_group"
  | "term"
  | "source"
  | "tool"
  | "toolset"
  | "role"
  | "schedule"
  | "memory_domain"
  | "memory_record"
  | "missing";
export type GraphHealth = "orphan" | "dangling" | "missing" | null;
export type GraphLinkKind =
  | "has_table"
  | "has_column"
  | "in_group"
  | "references"
  | "represents"
  | "joins"
  | "exposes"
  | "uses_source"
  | "contains"
  | "grants"
  | "reads"
  | "caches"
  | "syncs_from"
  | "runs"
  | "writes"
  | "queries"
  | "has_record"
  | "links";

export interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  group: string;
  meta: Record<string, unknown>;
  health?: GraphHealth;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
  /** The role granted `*`, so this edge stands for "everything". */
  wildcard?: boolean;
}

export interface GraphHub {
  id: string;
  label: string;
  kind: GraphKind;
  degree: number;
}

export interface GraphData {
  ok?: boolean;
  message?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  stats: { hubs: GraphHub[]; orphans: number; dangling: number };
}

export interface GraphRecords {
  ok?: boolean;
  message?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  total: number;
}
