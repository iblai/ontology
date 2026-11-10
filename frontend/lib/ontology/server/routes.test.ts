import { beforeEach, describe, expect, it } from "vitest";
import { route } from "./routes";
import { configFromBackend, maskSecrets } from "../config-files";
import { getDb, resetDb } from "../mock/store";
import type { BackendConfigSnapshot, Role, Service, SyncRun } from "../types";

const call = (method: string, path: string, query = "", body?: unknown) => {
  const handler = route(method, path.split("/").filter(Boolean).map(decodeURIComponent));
  if (!handler) throw new Error(`no route ${method} ${path}`);
  return handler(new URLSearchParams(query), body);
};

beforeEach(() => resetDb());

describe("route table", () => {
  it("resolves every path the client calls and nothing else", () => {
    const paths: [string, string][] = [
      ["GET", "health"],
      ["POST", "health/recheck"],
      ["GET", "services"],
      ["POST", "services"],
      ["GET", "services/peoplesoft"],
      ["DELETE", "services/peoplesoft"],
      ["GET", "services/peoplesoft/runs"],
      ["GET", "services/peoplesoft/safety"],
      ["POST", "services/peoplesoft/status"],
      ["POST", "services/peoplesoft/test"],
      ["POST", "services/peoplesoft/discover"],
      ["POST", "services/peoplesoft/approve"],
      ["POST", "services/peoplesoft/sync"],
      ["PATCH", "services/peoplesoft/tables"],
      ["GET", "graph"],
      ["GET", "graph/records"],
      ["POST", "sync/run"],
      ["GET", "sync/schedules"],
      ["PUT", "sync/schedules/x"],
      ["DELETE", "sync/schedules/x"],
      ["GET", "sync/status"],
      ["GET", "sync/history"],
      ["GET", "mcp/status"],
      ["GET", "mcp/tools"],
      ["GET", "mcp/toolsets"],
      ["GET", "mcp/sources"],
      ["POST", "mcp/validate"],
      ["POST", "mcp/build"],
      ["POST", "mcp/test/x"],
      ["PUT", "mcp/tools/x"],
      ["DELETE", "mcp/tools/x"],
      ["PUT", "mcp/toolsets/x"],
      ["DELETE", "mcp/toolsets/x"],
      ["PUT", "mcp/sources/x"],
      ["DELETE", "mcp/sources/x"],
      ["GET", "mcp/config"],
      ["PUT", "mcp/config"],
      ["GET", "roles"],
      ["PUT", "roles/x"],
      ["DELETE", "roles/x"],
      ["GET", "config"],
      ["GET", "counts"],
      ["POST", "reset"],
    ];
    for (const [method, path] of paths)
      expect(route(method, path.split("/")), `${method} ${path}`).not.toBeNull();
    expect(route("GET", ["nope"])).toBeNull();
    expect(route("DELETE", ["health"])).toBeNull();
    expect(route("GET", ["services", "a", "b", "c"])).toBeNull();
  });

  it("passes names, maps service=all to no filter and round-trips a role through reset", () => {
    expect((call("GET", "services/peoplesoft") as Service).name).toBe("peoplesoft");
    expect(call("GET", "services/nope")).toBeNull();
    expect(call("GET", "sync/history", "service=all&limit=3")).toEqual(
      call("GET", "sync/history", "limit=3"),
    );
    const canvas = call("GET", "sync/history", "service=canvas&limit=50") as SyncRun[];
    expect(canvas.length).toBeGreaterThan(0);
    expect(canvas.every((r) => r.source_system === "canvas")).toBe(true);
    const role: Role = {
      name: "Auditor",
      display_name: "Auditor",
      mcp_toolsets: ["enrollment-tools"],
      memory_paths: [],
      cache_tables: [],
      admin_dashboard: false,
      agents: [],
    };
    expect(call("PUT", "roles/Auditor", "", role)).toEqual({
      ok: true,
      message: "Role 'Auditor' saved.",
    });
    const names = () => (call("GET", "roles") as Role[]).map((r) => r.name);
    expect(names()).toContain("Auditor");
    expect(call("POST", "reset")).toBeUndefined();
    expect(names()).not.toContain("Auditor");
  });

  it("renders the config snapshot from the mock state with secrets masked", () => {
    const snap = call("GET", "config") as BackendConfigSnapshot;
    expect(snap.files.filter((f) => f.exists).map((f) => f.id)).toEqual([
      "ontology",
      "schedules",
      "roles",
      "tools",
    ]);
    expect(snap.files.find((f) => f.id === "roles")?.summary).toContainEqual({
      label: "roles",
      value: "5",
    });
    const text = snap.files.map((f) => f.content ?? "").join("\n");
    expect(text).toContain("password: ${PEOPLESOFT_RO_PASSWORD}");
    expect(text).not.toContain("REDACTED_SECRET_VALUE");
    // A literal secret is masked; a ${VAR} reference is configuration and stays.
    expect(maskSecrets("password: hunter2\ntoken: ${API_TOKEN}")).toBe(
      "password: ••••••••\ntoken: ${API_TOKEN}",
    );
  });

  it("renders what a backend sent in the page's order, masked again, and nothing it did not send", () => {
    const at = "2026-11-11T09:00:00Z";
    const snap = configFromBackend({
      root: "/app/config",
      files: [
        { id: "catalog", content: "entries:\n  - key: twenty\n", modified_at: at },
        { id: "tools", content: "kind: source\npassword: hunter2\n", modified_at: at },
        { id: "caddyfile", content: null, modified_at: null },
        { id: "ontology", content: "llm:\n  provider: openai\n", modified_at: at },
        { id: "not-a-file-of-ours", content: "x", modified_at: null },
      ],
    });
    expect(snap.root).toBe("/app/config");
    // No roles or schedules (dm keeps them in the ibl.ai platform), no compose or .env (the host's).
    expect(snap.files.map((f) => [f.id, f.exists])).toEqual([
      ["ontology", true],
      ["tools", true],
      ["catalog", true],
      ["caddyfile", false],
    ]);
    const tools = snap.files[1];
    expect(tools.content).toBe("kind: source\npassword: ••••••••\n");
    expect(tools.modifiedAt).toBe("2026-11-11T09:00:00.000Z");
    expect(tools.summary).toContainEqual({ label: "source", value: "1" });
  });

  it("keeps one store per process until a reset", () => {
    expect(getDb()).toBe(getDb());
    const before = getDb();
    resetDb();
    expect(getDb()).not.toBe(before);
  });
});
