import { describe, expect, it } from "vitest";
import {
  cacheTables,
  cachesDomain,
  degrees,
  grantPatch,
  neighbourhood,
  reach,
  searchGraph,
  toggleGrant,
} from "./graph";
import type { GraphData, GraphLink, GraphNode, Role } from "./types";

const L = (
  source: string,
  target: string,
  kind: GraphLink["kind"],
  wildcard = false,
): GraphLink => ({
  source,
  target,
  kind,
  wildcard,
});
const links: GraphLink[] = [
  L("role:r", "toolset:ts", "grants"),
  L("toolset:ts", "tool:t", "contains"),
  L("tool:t", "source:s", "uses_source"),
  L("service:svc", "source:s", "exposes"),
  L("service:svc", "table:svc:a", "has_table"),
  L("service:svc", "table:svc:b", "has_table"),
  L("tool:t", "table:svc:a", "queries"),
  L("role:r", "memory_domain:students", "reads"),
  L("role:other", "toolset:ts", "grants"),
];
const role: Role = {
  name: "r",
  display_name: "R",
  mcp_toolsets: ["*"],
  memory_paths: ["/ontology/**"],
  cache_tables: ["students"],
  admin_dashboard: false,
  agents: [],
};

describe("reach", () => {
  it("follows grants through toolsets, tools, sources and services to tables", () => {
    const r = reach(links, "role:r");
    expect([...r.nodes].sort()).toEqual(
      [
        "memory_domain:students",
        "role:r",
        "service:svc",
        "source:s",
        "table:svc:a",
        "table:svc:b",
        "tool:t",
        "toolset:ts",
      ].sort(),
    );
    expect([...r.granted].sort()).toEqual(["memory_domain:students", "toolset:ts"]);
    expect(r.nodes.has("role:other")).toBe(false);
  });
});

describe("toggleGrant", () => {
  it("expands a wildcard toolset grant into an explicit list on revoke", () => {
    expect(toggleGrant(role, "toolset", "ts", ["ts", "other"]).mcp_toolsets).toEqual(["other"]);
    expect(
      toggleGrant({ ...role, mcp_toolsets: ["other"] }, "toolset", "ts", ["ts", "other"])
        .mcp_toolsets,
    ).toEqual(["other", "ts"]);
  });
  it("expands a broad memory glob per domain and toggles one domain", () => {
    const revoked = toggleGrant(role, "memory_domain", "students", ["students", "courses"]);
    expect(revoked.memory_paths).toEqual(["/ontology/courses/**"]);
    expect(
      toggleGrant(revoked, "memory_domain", "students", ["students", "courses"]).memory_paths,
    ).toEqual(["/ontology/courses/**", "/ontology/students/**"]);
  });
  it("toggles cache tables and keeps the rest of the role", () => {
    const next = toggleGrant(role, "cache", "students", ["students"]);
    expect(next.cache_tables).toEqual([]);
    expect(next.display_name).toBe("R");
  });
});

describe("grantPatch", () => {
  const nodes: GraphNode[] = [
    { id: "role:r", kind: "role", label: "R", group: "roles", meta: {} },
    { id: "toolset:ts", kind: "toolset", label: "ts", group: "mcp", meta: {} },
    { id: "toolset:other", kind: "toolset", label: "other", group: "mcp", meta: {} },
    { id: "memory_domain:students", kind: "memory_domain", label: "students", group: "", meta: {} },
  ];
  const data: GraphData = {
    nodes,
    links: [...links, L("role:r", "toolset:other", "grants", true)],
    stats: { hubs: [], orphans: 0, dangling: 0 },
  };
  const edge = (ls: GraphLink[], target: string) =>
    ls.find((l) => l.source === "role:r" && l.target === target);

  it("revokes a wildcard grant into an explicit list, dropping the edge and the flags", () => {
    const p = grantPatch(data, role, "toolset", "ts");
    expect(p.had).toBe(true);
    expect(p.role.mcp_toolsets).toEqual(["other"]);
    expect(edge(p.links, "toolset:ts")).toBeUndefined();
    expect(edge(p.links, "toolset:other")?.wildcard).toBe(false);
  });
  it("grants by appending the edge", () => {
    const without = { ...data, links: data.links.filter((l) => l.target !== "toolset:ts") };
    const p = grantPatch(without, { ...role, mcp_toolsets: ["other"] }, "toolset", "ts");
    expect(p.had).toBe(false);
    expect(p.role.mcp_toolsets).toEqual(["other", "ts"]);
    expect(edge(p.links, "toolset:ts")).toEqual({
      source: "role:r",
      target: "toolset:ts",
      kind: "grants",
    });
  });
  it("revokes a memory domain read", () => {
    const p = grantPatch(data, role, "memory_domain", "students");
    expect(p.had).toBe(true);
    expect(p.role.memory_paths).toEqual([]);
    expect(edge(p.links, "memory_domain:students")).toBeUndefined();
  });
});

describe("a memory domain's cache", () => {
  const domain = (label: string, tables?: string[]): GraphNode => ({
    id: `memory_domain:${label}`,
    kind: "memory_domain",
    label,
    group: label,
    meta: tables ? { cache_tables: tables } : {},
  });
  // As a backend reports them: a domain is cached in tables of other names, or in none.
  const students = domain("students", ["students", "holds"]);
  const aid = domain("financial-aid", ["financial_aid"]);
  const hr = domain("hr", []);
  const data: GraphData = {
    nodes: [students, aid, hr],
    links: [L("role:r", "memory_domain:students", "caches")],
    stats: { hubs: [], orphans: 0, dangling: 0 },
  };
  const holding = (...tables: string[]): Role => ({ ...role, cache_tables: tables });

  it("is granted by the tables it is cached in, not by its name", () => {
    const p = grantPatch(data, holding(), "cache", "financial-aid");
    expect(p.had).toBe(false);
    expect(p.role.cache_tables).toEqual(["financial_aid"]);
    expect(p.links).toContainEqual({
      source: "role:r",
      target: "memory_domain:financial-aid",
      kind: "caches",
    });
  });
  it("reads as granted with one of its tables, and is revoked with all of them", () => {
    const p = grantPatch(data, holding("holds", "other"), "cache", "students");
    expect(p.had).toBe(true);
    expect(p.role.cache_tables).toEqual(["other"]);
    expect(p.links.some((l) => l.target === "memory_domain:students")).toBe(false);
  });
  it("expands * to every domain's tables on the first revoke", () => {
    const p = grantPatch(data, holding("*"), "cache", "students");
    expect(p.had).toBe(true);
    expect(p.role.cache_tables).toEqual(["financial_aid"]);
  });
  it("has no table to grant when the backend lists none, and its own name when it lists nothing", () => {
    expect(cacheTables(hr)).toEqual([]);
    expect(cachesDomain(holding("*"), hr)).toBe(false);
    expect(cacheTables(domain("courses"))).toEqual(["courses"]);
    // A role that holds the domain's name does not hold its table.
    expect(cachesDomain(holding("financial-aid"), aid)).toBe(false);
    expect(cachesDomain(holding("*"), aid)).toBe(true);
  });
});

describe("graph helpers", () => {
  it("counts degrees, walks neighbourhoods and searches labels", () => {
    expect(degrees(links).get("toolset:ts")).toBe(3);
    expect([...neighbourhood(links, "tool:t", 1)].sort()).toEqual(
      ["source:s", "table:svc:a", "tool:t", "toolset:ts"].sort(),
    );
    expect(neighbourhood(links, "tool:t", 2).has("role:r")).toBe(true);
    const nodes: GraphNode[] = [
      { id: "table:svc:a", kind: "table", label: "PS_A", group: "", meta: {} },
      { id: "toolset:x", kind: "missing", label: "ps_x", group: "", meta: {} },
    ];
    expect(searchGraph(nodes, "ps").map((n) => n.id)).toEqual(["table:svc:a"]);
  });
});
