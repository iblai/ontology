import { mockApi } from "./mock/handlers";
import type {
  Service,
  ServiceHealth,
  SafetyReport,
  ProvisioningRun,
  SyncRun,
  SyncSchedule,
  McpTool,
  McpToolset,
  McpSource,
  GatewayHealth,
  ComplianceReport,
  HealthSnapshot,
  Role,
  QuickCounts,
  BackendConfigSnapshot,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_ONTOLOGY_API_URL ?? "";
const USE_MOCK = !BASE;

/**
 * The ibl.ai SSO flow stores both tokens in localStorage; the backend's DM
 * auth scheme wants `Authorization: Token <dm_token>` paired with the edX JWT
 * in `X-Edx-Jwt`. Browser-only (SSR has no localStorage); absent tokens send
 * nothing, so dev-anon and Entra-Bearer setups are unaffected.
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
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const apiClient = {
  health: {
    all: (): Promise<HealthSnapshot> =>
      USE_MOCK ? Promise.resolve(mockApi.health.all()) : http("/health"),
    recheck: (): Promise<HealthSnapshot> =>
      USE_MOCK
        ? Promise.resolve(mockApi.health.recheck())
        : http("/health/recheck", { method: "POST" }),
  },
  services: {
    list: (): Promise<Service[]> =>
      USE_MOCK ? Promise.resolve(mockApi.services.list()) : http("/services"),
    get: (name: string): Promise<Service | null> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.get(name))
        : http(`/services/${name}`).then((s) => s as Service | null),
    runs: (name: string): Promise<ProvisioningRun[]> =>
      USE_MOCK ? Promise.resolve(mockApi.services.runs(name)) : http(`/services/${name}/runs`),
    safetyReport: (name: string): Promise<SafetyReport | undefined> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.safetyReport(name))
        : http(`/services/${name}/safety`),
    status: (name: string): Promise<ServiceHealth | null> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.status(name))
        : http(`/services/${name}/status`, { method: "POST" }),
    test: (name: string): Promise<SafetyReport> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.test(name))
        : http(`/services/${name}/test`, { method: "POST" }),
    discover: (name: string): Promise<{ ok: boolean; message: string }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.discover(name))
        : http(`/services/${name}/discover`, { method: "POST" }),
    approve: (name: string): Promise<{ ok: boolean; runId?: string; message: string }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.approve(name))
        : http(`/services/${name}/approve`, { method: "POST" }),
    sync: (name: string): Promise<{ ok: boolean; message: string }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.sync(name))
        : http(`/services/${name}/sync`, { method: "POST" }),
    remove: (name: string): Promise<{ ok: boolean; message: string }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.remove(name))
        : http(`/services/${name}`, { method: "DELETE" }),
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
    }): Promise<{ ok: boolean; message: string }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.services.add(input))
        : http("/services", { method: "POST", body: JSON.stringify(input) }),
  },
  sync: {
    runAll: (): Promise<{ ok: boolean; message: string }> =>
      USE_MOCK ? Promise.resolve(mockApi.sync.runAll()) : http("/sync/run", { method: "POST" }),
    schedules: (): Promise<SyncSchedule[]> =>
      USE_MOCK ? Promise.resolve(mockApi.sync.schedules()) : http("/sync/schedules"),
    status: (): Promise<SyncRun[]> =>
      USE_MOCK ? Promise.resolve(mockApi.sync.status()) : http("/sync/status"),
    history: (service?: string, limit = 20): Promise<SyncRun[]> =>
      USE_MOCK
        ? Promise.resolve(mockApi.sync.history(service, limit))
        : http(`/sync/history?service=${service ?? "all"}&limit=${limit}`),
  },
  mcp: {
    status: (): Promise<GatewayHealth> =>
      USE_MOCK ? Promise.resolve(mockApi.mcp.status()) : http("/mcp/status"),
    tools: (): Promise<McpTool[]> =>
      USE_MOCK ? Promise.resolve(mockApi.mcp.tools()) : http("/mcp/tools"),
    toolsets: (): Promise<McpToolset[]> =>
      USE_MOCK ? Promise.resolve(mockApi.mcp.toolsets()) : http("/mcp/toolsets"),
    sources: (): Promise<McpSource[]> =>
      USE_MOCK ? Promise.resolve(mockApi.mcp.sources()) : http("/mcp/sources"),
    validate: (): Promise<ComplianceReport> =>
      USE_MOCK
        ? Promise.resolve(mockApi.mcp.validate())
        : http("/mcp/validate", { method: "POST" }),
    build: (): Promise<{ ok: boolean; nativeTools: number; path: string }> =>
      USE_MOCK ? Promise.resolve(mockApi.mcp.build()) : http("/mcp/build", { method: "POST" }),
    test: (
      tool: string,
      params: Record<string, unknown>,
    ): Promise<{ ok: boolean; result: unknown }> =>
      USE_MOCK
        ? Promise.resolve(mockApi.mcp.test(tool, params))
        : http(`/mcp/test/${tool}`, { method: "POST", body: JSON.stringify(params) }),
  },
  roles: {
    list: (): Promise<Role[]> =>
      USE_MOCK ? Promise.resolve(mockApi.roles.list()) : http("/roles"),
  },
  config: {
    // Served by this console's own Next route, which reads the real backend
    // config files from disk (secrets masked server-side) — real data even in
    // mock mode. When the backend grows a /config endpoint, the route can proxy.
    snapshot: async (): Promise<BackendConfigSnapshot> => {
      const res = await fetch("/api/ontology/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      return res.json() as Promise<BackendConfigSnapshot>;
    },
  },
  counts: (): Promise<QuickCounts> =>
    USE_MOCK ? Promise.resolve(mockApi.counts()) : http("/counts"),
  reset: (): Promise<void> => {
    if (USE_MOCK) {
      mockApi.reset();
      return Promise.resolve();
    }
    return http("/reset", { method: "POST" }).then(() => undefined);
  },
};

export const usingMock = USE_MOCK;
