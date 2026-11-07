import { mockApi as api } from "../mock/handlers";

type Handler = (params: string[], query: URLSearchParams, body: any) => unknown;
const num = (q: URLSearchParams, key: string, fallback: number) => Number(q.get(key) ?? fallback);

/** REST surface → the function API (`typeof mockApi`); a DM adapter plugs in here when its endpoints exist. */
const ROUTES: [string, string, Handler][] = [
  ["GET", "health", () => api.health.all()],
  ["POST", "health/recheck", () => api.health.recheck()],
  ["GET", "services", () => api.services.list()],
  ["POST", "services", (_, __, b) => api.services.add(b)],
  ["GET", "services/:", ([s]) => api.services.get(s)],
  ["DELETE", "services/:", ([s]) => api.services.remove(s)],
  ["GET", "services/:/runs", ([s]) => api.services.runs(s)],
  ["GET", "services/:/safety", ([s]) => api.services.safetyReport(s)],
  ["POST", "services/:/status", ([s]) => api.services.status(s)],
  ["POST", "services/:/test", ([s]) => api.services.test(s)],
  ["POST", "services/:/discover", ([s]) => api.services.discover(s)],
  ["POST", "services/:/approve", ([s]) => api.services.approve(s)],
  ["POST", "services/:/sync", ([s]) => api.services.sync(s)],
  ["PATCH", "services/:/tables", ([s], _, b) => api.services.updateTables(s, b)],
  ["GET", "graph", (_, q) => api.graph(q.get("columns") === "true")],
  ["GET", "graph/records", (_, q) => api.graphRecords(q.get("domain") ?? "", num(q, "limit", 500))],
  ["POST", "sync/run", () => api.sync.runAll()],
  ["GET", "sync/schedules", () => api.sync.schedules()],
  ["PUT", "sync/schedules/:", (_, __, b) => api.sync.saveSchedule(b)],
  ["DELETE", "sync/schedules/:", ([s]) => api.sync.removeSchedule(s)],
  ["GET", "sync/status", () => api.sync.status()],
  [
    "GET",
    "sync/history",
    (_, q) => {
      const service = q.get("service");
      return api.sync.history(
        service && service !== "all" ? service : undefined,
        num(q, "limit", 20),
      );
    },
  ],
  ["GET", "mcp/status", () => api.mcp.status()],
  ["GET", "mcp/tools", () => api.mcp.tools()],
  ["GET", "mcp/toolsets", () => api.mcp.toolsets()],
  ["GET", "mcp/sources", () => api.mcp.sources()],
  ["POST", "mcp/validate", () => api.mcp.validate()],
  ["POST", "mcp/build", () => api.mcp.build()],
  ["POST", "mcp/test/:", ([tool], _, b) => api.mcp.test(tool, b ?? {})],
  ["PUT", "mcp/tools/:", (_, __, b) => api.mcp.saveTool(b)],
  ["DELETE", "mcp/tools/:", ([t]) => api.mcp.removeTool(t)],
  ["PUT", "mcp/toolsets/:", (_, __, b) => api.mcp.saveToolset(b)],
  ["DELETE", "mcp/toolsets/:", ([t]) => api.mcp.removeToolset(t)],
  ["PUT", "mcp/sources/:", (_, __, b) => api.mcp.saveSource(b)],
  ["DELETE", "mcp/sources/:", ([s]) => api.mcp.removeSource(s)],
  ["GET", "mcp/config", () => api.mcp.config()],
  ["PUT", "mcp/config", (_, __, b) => api.mcp.saveConfig(b?.text ?? "")],
  ["GET", "roles", () => api.roles.list()],
  ["PUT", "roles/:", (_, __, b) => api.roles.save(b)],
  ["DELETE", "roles/:", ([r]) => api.roles.remove(r)],
  ["GET", "config", () => api.config.snapshot()],
  ["GET", "counts", () => api.counts()],
  ["POST", "reset", () => api.reset()],
];

/** The handler for a method and an already split, decoded path; null when no route matches. */
export function route(method: string, path: string[]) {
  for (const [m, pattern, handler] of ROUTES) {
    const parts = pattern.split("/");
    if (m !== method || parts.length !== path.length) continue;
    if (parts.every((p, i) => p === ":" || p === path[i]))
      return (query: URLSearchParams, body: unknown) =>
        handler(
          path.filter((_, i) => parts[i] === ":"),
          query,
          body,
        );
  }
  return null;
}
