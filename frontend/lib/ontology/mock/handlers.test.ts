import { beforeEach, describe, expect, it } from "vitest";
import { mockApi } from "./handlers";

beforeEach(() => mockApi.reset());

describe("mock table edits", () => {
  it("reflects a table edit in the service manifest", () => {
    const r = mockApi.services.updateTables("peoplesoft", {
      tables: ["SYSADM.PS_FIN_AID_AWD"],
      entity_group: "students",
      description: "Moved.",
    });
    expect(r).toEqual({ ok: true, message: "Updated 1 table(s).", updated: 1 });
    const svc = mockApi.services.list().find((x) => x.name === "peoplesoft")!;
    const moved = svc.schema_manifest!.tables.find((t) => t.table_name === "PS_FIN_AID_AWD")!;
    expect(moved.entity_group).toBe("students");
    expect(moved.description).toBe("Moved.");
    expect(mockApi.services.updateTables("nope", { tables: ["a"], description: "x" }).ok).toBe(
      false,
    );
  });
});

describe("mock graph", () => {
  it("builds a deterministic typed graph with wildcard grants and health", () => {
    const g = mockApi.graph(false);
    expect(mockApi.graph(false)).toEqual(g);
    const kinds = new Set<string>(g.nodes.map((n) => n.kind));
    for (const k of [
      "service",
      "table",
      "entity_group",
      "source",
      "tool",
      "toolset",
      "role",
      "schedule",
      "memory_domain",
    ])
      expect(kinds.has(k)).toBe(true);
    expect(kinds.has("column")).toBe(false);
    expect(g.links.some((l) => l.kind === "grants" && l.wildcard)).toBe(true);
    expect(g.links.some((l) => l.kind === "references")).toBe(true);
    expect(g.stats.hubs).toHaveLength(5);
    expect(mockApi.graph(true).nodes.some((n) => n.kind === "column")).toBe(true);
  });
  it("expands enrollment records with links to students and courses", () => {
    const r = mockApi.graphRecords("enrollment", 10);
    expect(r.ok).toBe(true);
    expect(r.nodes.filter((n) => n.group === "enrollment")).toHaveLength(10);
    expect(r.links.length).toBeGreaterThan(0);
    expect(r.links.every((l) => l.kind === "links")).toBe(true);
    expect(mockApi.graphRecords("nope", 10).ok).toBe(false);
  });
});

describe("mock editors", () => {
  it("round-trips roles", () => {
    expect(
      mockApi.roles.save({
        name: "Auditor",
        display_name: "Auditor",
        mcp_toolsets: ["*"],
        memory_paths: [],
        cache_tables: [],
        agents: [],
        admin_dashboard: false,
      }).ok,
    ).toBe(true);
    expect(mockApi.roles.list().some((r) => r.name === "Auditor")).toBe(true);
    expect(
      mockApi.roles.save({
        name: "X",
        display_name: "X",
        mcp_toolsets: ["nope"],
        memory_paths: [],
        cache_tables: [],
        agents: [],
        admin_dashboard: false,
      }).ok,
    ).toBe(false);
    expect(mockApi.roles.remove("Auditor").ok).toBe(true);
    expect(mockApi.roles.remove("Auditor").ok).toBe(false);
    expect(mockApi.roles.remove("default").ok).toBe(false);
  });

  it("round-trips schedules", () => {
    const s = {
      name: "nightly",
      cron: "0 2 * * *",
      source: "peoplesoft",
      tool: "get-student-enrollment",
      mode: "full" as const,
      description: "",
      enabled: true,
    };
    expect(mockApi.sync.saveSchedule(s).ok).toBe(true);
    expect(mockApi.sync.saveSchedule({ ...s, enabled: false }).ok).toBe(true);
    expect(mockApi.sync.schedules().find((x) => x.name === "nightly")?.enabled).toBe(false);
    expect(mockApi.sync.removeSchedule("nightly").ok).toBe(true);
    expect(mockApi.sync.removeSchedule("nightly").ok).toBe(false);
  });

  it("round-trips tools, toolsets and sources with reference guards", () => {
    const source = mockApi.mcp.sources()[0].name;
    expect(
      mockApi.mcp.saveTool({
        kind: "tool",
        name: "ping",
        type: "postgres-sql",
        source,
        description: "d",
        parameters: [],
        statement: "SELECT 1",
      }).ok,
    ).toBe(true);
    expect(
      mockApi.mcp.saveTool({
        kind: "tool",
        name: "bad",
        type: "postgres-sql",
        source: "ghost",
        description: "d",
        parameters: [],
      }).ok,
    ).toBe(false);
    expect(mockApi.mcp.saveToolset({ kind: "toolset", name: "qa", tools: ["ping"] }).ok).toBe(true);
    expect(mockApi.mcp.removeTool("ping").ok).toBe(false); // referenced by qa
    expect(mockApi.mcp.removeToolset("qa").ok).toBe(true);
    expect(mockApi.mcp.removeTool("ping").ok).toBe(true);
    expect(mockApi.mcp.removeSource(source).ok).toBe(false); // referenced by tools
    expect(
      mockApi.mcp.saveSource({ kind: "source", name: "s2", type: "postgres", password: "hunter2" })
        .ok,
    ).toBe(false);
    expect(
      mockApi.mcp.saveSource({ kind: "source", name: "s2", type: "postgres", password: "${PW}" })
        .ok,
    ).toBe(true);
    expect(mockApi.mcp.removeSource("s2").ok).toBe(true);
  });

  it("validates tools.yaml before saving", () => {
    const before = mockApi.mcp.tools();
    const bad = mockApi.mcp.saveConfig("kind: [\n");
    expect(bad.ok).toBe(false);
    expect(bad.issues[0].severity).toBe("error");
    expect(mockApi.mcp.tools()).toEqual(before);
    const dangling = mockApi.mcp.saveConfig(
      "kind: tool\nname: x\ntype: postgres-sql\nsource: ghost\nstatement: SELECT 1\n",
    );
    expect(dangling.ok).toBe(false);
    expect(dangling.issues.map((i) => i.message).join()).toContain("undefined source");
    expect(mockApi.mcp.tools()).toEqual(before);
    const ok = mockApi.mcp.saveConfig(mockApi.mcp.config().text + "\n# note\n");
    expect(ok.ok).toBe(true);
    expect(ok.tools).toBe(before.length);
    expect(mockApi.mcp.tools().map((t) => t.name)).toEqual(before.map((t) => t.name));
  });
});
