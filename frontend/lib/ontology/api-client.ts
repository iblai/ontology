import type {
  BackendConfigSnapshot,
  ComplianceReport,
  GatewayHealth,
  GraphData,
  GraphRecords,
  HealthSnapshot,
  McpSource,
  McpTool,
  McpToolset,
  ProvisioningRun,
  QuickCounts,
  Role,
  SafetyReport,
  Service,
  ServiceHealth,
  SyncRun,
  SyncSchedule,
  TableEdit,
} from "./types";

/** Same-origin route handlers; the server decides between the mock and a real backend. */
const BASE = "/api/ontology";
const enc = encodeURIComponent;

type Ok = { ok: boolean; message: string };

/**
 * The ibl.ai SSO flow stores both tokens in localStorage; the route handler
 * forwards them to a real backend as `Authorization: Token <dm_token>` and
 * `X-Edx-Jwt`. Browser-only (SSR has no localStorage); absent tokens send nothing.
 */
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = {};
  const dmToken = window.localStorage.getItem("dm_token");
  const edxJwt = window.localStorage.getItem("edx_jwt_token");
  if (dmToken) headers["Authorization"] = `Token ${dmToken}`;
  if (edxJwt) headers["X-Edx-Jwt"] = edxJwt;
  return headers;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  http(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown): Promise<T> =>
  http(path, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(path: string): Promise<T> => http(path, { method: "DELETE" });

export const apiClient = {
  health: {
    all: (): Promise<HealthSnapshot> => http("/health"),
    recheck: (): Promise<HealthSnapshot> => post("/health/recheck"),
  },
  services: {
    list: (): Promise<Service[]> => http("/services"),
    get: (name: string): Promise<Service | null> => http(`/services/${enc(name)}`),
    runs: (name: string): Promise<ProvisioningRun[]> => http(`/services/${enc(name)}/runs`),
    safetyReport: (name: string): Promise<SafetyReport | undefined> =>
      http<SafetyReport | null>(`/services/${enc(name)}/safety`).then((r) => r ?? undefined),
    status: (name: string): Promise<ServiceHealth | null> => post(`/services/${enc(name)}/status`),
    test: (name: string): Promise<SafetyReport> => post(`/services/${enc(name)}/test`),
    discover: (name: string): Promise<Ok> => post(`/services/${enc(name)}/discover`),
    map: (name: string): Promise<Ok & { tables: Record<string, Record<string, unknown>> }> =>
      post(`/services/${enc(name)}/map`),
    approve: (name: string): Promise<Ok & { runId?: string }> =>
      post(`/services/${enc(name)}/approve`),
    sync: (name: string): Promise<Ok> => post(`/services/${enc(name)}/sync`),
    remove: (name: string): Promise<Ok> => del(`/services/${enc(name)}`),
    add: (input: {
      name: string;
      service_type: "database" | "api";
      adapter: string;
      host: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      domain: string;
    }): Promise<Ok> => post("/services", input),
    updateTables: (name: string, body: TableEdit): Promise<Ok & { updated: number }> =>
      http(`/services/${enc(name)}/tables`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  graph: {
    get: (columns: boolean): Promise<GraphData> => http(`/graph?columns=${columns}`),
    records: (domain: string, limit = 500): Promise<GraphRecords> =>
      http(`/graph/records?domain=${enc(domain)}&limit=${limit}`),
  },
  sync: {
    runAll: (): Promise<Ok> => post("/sync/run"),
    schedules: (): Promise<SyncSchedule[]> => http("/sync/schedules"),
    status: (): Promise<SyncRun[]> => http("/sync/status"),
    history: (service?: string, limit = 20): Promise<SyncRun[]> =>
      http(`/sync/history?service=${enc(service ?? "all")}&limit=${limit}`),
    saveSchedule: (schedule: SyncSchedule): Promise<Ok> =>
      put(`/sync/schedules/${enc(schedule.name)}`, schedule),
    removeSchedule: (name: string): Promise<Ok> => del(`/sync/schedules/${enc(name)}`),
  },
  mcp: {
    status: (): Promise<GatewayHealth> => http("/mcp/status"),
    tools: (): Promise<McpTool[]> => http("/mcp/tools"),
    toolsets: (): Promise<McpToolset[]> => http("/mcp/toolsets"),
    sources: (): Promise<McpSource[]> => http("/mcp/sources"),
    validate: (): Promise<ComplianceReport> => post("/mcp/validate"),
    build: (): Promise<{ ok: boolean; nativeTools: number; path: string }> => post("/mcp/build"),
    test: (
      tool: string,
      params: Record<string, unknown>,
    ): Promise<{ ok: boolean; result: unknown }> => post(`/mcp/test/${enc(tool)}`, params),
    saveTool: (tool: McpTool): Promise<Ok> => put(`/mcp/tools/${enc(tool.name)}`, tool),
    removeTool: (name: string): Promise<Ok> => del(`/mcp/tools/${enc(name)}`),
    saveToolset: (toolset: McpToolset): Promise<Ok> =>
      put(`/mcp/toolsets/${enc(toolset.name)}`, toolset),
    removeToolset: (name: string): Promise<Ok> => del(`/mcp/toolsets/${enc(name)}`),
    saveSource: (source: McpSource): Promise<Ok> => put(`/mcp/sources/${enc(source.name)}`, source),
    removeSource: (name: string): Promise<Ok> => del(`/mcp/sources/${enc(name)}`),
    // The raw tools.yaml text, ${VAR} references unexpanded; saving validates first.
    config: (): Promise<{ text: string }> => http("/mcp/config"),
    saveConfig: (text: string): Promise<ComplianceReport> => put("/mcp/config", { text }),
  },
  roles: {
    list: (): Promise<Role[]> => http("/roles"),
    save: (role: Role): Promise<Ok> => put(`/roles/${enc(role.name)}`, role),
    remove: (name: string): Promise<Ok> => del(`/roles/${enc(name)}`),
  },
  config: {
    // Mock mode renders the files from its state; forwarded mode reads the backend checkout on disk.
    snapshot: (): Promise<BackendConfigSnapshot> => http("/config"),
  },
  counts: (): Promise<QuickCounts> => http("/counts"),
};
