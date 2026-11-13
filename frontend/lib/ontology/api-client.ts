import type {
  Agent,
  AgentConnection,
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
  ServiceEndpoint,
  ServiceHealth,
  SyncRun,
  SyncSchedule,
  TableEdit,
  TermDetail,
} from "./types";
import { resolveAppTenant } from "@/lib/iblai/tenant";

/** Same-origin route handlers; the server decides between the mock and a real backend. */
const BASE = "/api/ontology";
/** The hosted console's own routes: they speak to the ibl.ai platform, not to a backend. */
const HOSTED = "/api/hosted";
const enc = encodeURIComponent;

type Ok = { ok: boolean; message: string };
type Refused = { ok: false; message: string };

/** Where this browser keeps its platform's backend address, while the platform keeps no record of it. */
const backendAt = () => `ontology_backend:${resolveAppTenant()}`;

/**
 * The ibl.ai SSO flow stores the DM token in localStorage; the route handler forwards
 * it to a real backend as `Authorization: Token <dm_token>`, the one credential a
 * backend is sent. The hosted console is also told the backend this browser keeps for its
 * platform, if any. Browser-only (SSR has no localStorage); no token sends nothing.
 */
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = {};
  const dmToken = window.localStorage.getItem("dm_token");
  if (dmToken) headers.Authorization = `Token ${dmToken}`;
  const backend = window.localStorage.getItem(backendAt());
  if (backend) headers["X-Ontology-Backend"] = backend;
  return headers;
}

/** A refused call: its HTTP status, with the server's own words in the message. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, text: string) {
    super(`API ${status}: ${text}`);
    this.status = status;
  }
}

async function http<T>(path: string, init?: RequestInit, base = BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
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
      /** The name people read, when one was typed; else the backend's own for that kind. */
      display_name?: string;
      service_type: "database" | "api";
      adapter: string;
      host: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      /** Twenty's key; a custom API's whole header value; an Auto Ontology server's token. */
      api_key?: string;
      /** A custom API: `header`, the name of the header its key goes in. */
      options?: Record<string, string>;
      domain: string;
    }): Promise<Ok> => post("/services", input),
    // A custom API's endpoints: each is one tool an agent may call.
    endpoints: (name: string): Promise<ServiceEndpoint[]> =>
      http(`/services/${enc(name)}/endpoints`),
    saveEndpoint: (name: string, endpoint: Omit<ServiceEndpoint, "tool" | "write">): Promise<Ok> =>
      put(`/services/${enc(name)}/endpoints/${enc(endpoint.name)}`, endpoint),
    removeEndpoint: (name: string, endpoint: string): Promise<Ok> =>
      del(`/services/${enc(name)}/endpoints/${enc(endpoint)}`),
    // A database system: a term for each table that has none, written by the platform's model.
    generateTerms: (name: string): Promise<Ok> => post(`/services/${enc(name)}/terms`),
    // A term's columns and calculations: read live from its Auto Ontology server, or generated here.
    term: (name: string, term: string): Promise<TermDetail> =>
      http(`/services/${enc(name)}/terms/${enc(term)}`),
    // The databases a PostgreSQL or MySQL login may open, so the form offers the name.
    databases: (login: {
      adapter: string;
      host: string;
      port: number;
      user: string;
      password: string;
    }): Promise<Ok & { databases: string[] }> => post("/services/databases", login),
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
  agents: {
    // The platform's agents; not ok says why they could not be listed.
    list: (): Promise<Ok & { agents: Agent[] }> => http("/agents"),
    connections: (): Promise<AgentConnection[]> => http("/agent-connections"),
    connect: (input: { agent: string; role: string }): Promise<Ok> =>
      post("/agent-connections", input),
    disconnect: (name: string): Promise<Ok> => del(`/agent-connections/${enc(name)}`),
  },
  config: {
    // Mock mode renders the files from its state; a backend sends its own, masked on its host.
    snapshot: (): Promise<BackendConfigSnapshot> => http("/config"),
  },
  counts: (): Promise<QuickCounts> => http("/counts"),
  // Hosted mode only: where the platform keeps its backend, and connecting or setting one up.
  hosted: {
    backend: (): Promise<{ url: string | null }> => http("/backend", undefined, HOSTED),
    // `code` is the one-time code of an install's link: it sets a fresh server up for this platform.
    connect: async (url: string, code?: string): Promise<{ ok: true; url: string } | Refused> => {
      const res = await http<{ ok: true; url: string; browser?: true } | Refused>(
        "/backend",
        { method: "PUT", body: JSON.stringify({ url, platform: resolveAppTenant(), code }) },
        HOSTED,
      );
      // The console says when the address is this browser's to keep, not the platform's.
      if (res.ok && res.browser) window.localStorage.setItem(backendAt(), res.url);
      return res;
    },
  },
};
