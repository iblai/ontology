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
  it("reaches a toolset that changes data only by name", () => {
    const writes = { kind: "toolset" as const, name: "writes", tools: ["get-student-enrollment"] };
    expect(mockApi.mcp.saveToolset({ ...writes, write: true }).ok).toBe(true);
    expect(mockApi.mcp.toolsets().find((ts) => ts.name === "writes")?.write).toBe(true);
    const grants = () =>
      mockApi
        .graph(false)
        .links.filter((l) => l.kind === "grants" && l.source === "role:IblaiOntologyAdmin")
        .map((l) => l.target);
    // The seeded administrator holds `*`: every read-only toolset, and not this one.
    expect(grants()).toContain("toolset:canvas-tools");
    expect(grants()).not.toContain("toolset:writes");
    const admin = mockApi.roles.list().find((r) => r.name === "IblaiOntologyAdmin")!;
    expect(mockApi.roles.save({ ...admin, mcp_toolsets: ["*", "writes"] }).ok).toBe(true);
    expect(grants()).toContain("toolset:writes");
    expect(mockApi.graph(false).nodes.find((n) => n.id === "toolset:writes")?.meta.write).toBe(
      true,
    );
    // Unmarked, the flag is left out as the backend leaves it out of tools.yaml.
    expect(mockApi.mcp.saveToolset({ ...writes, write: false }).ok).toBe(true);
    expect(mockApi.mcp.toolsets().find((ts) => ts.name === "writes")).toEqual(writes);
    expect(grants().filter((id) => id === "toolset:writes")).toHaveLength(1);
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

describe("mock custom API", () => {
  const acme = {
    name: "acme",
    service_type: "api" as const,
    adapter: "http_api",
    host: "https://api.acme.example/v1",
    api_key: "Bearer a-working-token",
    options: { header: "Authorization" },
    domain: "higher-ed",
  };
  const endpoint = {
    name: "list-invoices",
    description: "Open invoices of a client.",
    method: "GET" as const,
    path: "/clients/{client_id}/invoices",
    query: ["status"],
    body: false,
  };
  const toolset = (name: string) => mockApi.mcp.toolsets().find((t) => t.name === name);
  const role = (name: string) => mockApi.roles.list().find((r) => r.name === name);

  it("is connected at once, with two empty toolsets its role holds and a masked key", () => {
    expect(mockApi.services.add({ ...acme, host: "https://localhost/v1" }).ok).toBe(false);
    expect(mockApi.services.add(acme)).toEqual({
      ok: true,
      message: "'acme' is connected. Add the endpoints agents may call.",
    });
    const stored = mockApi.services.get("acme")!;
    expect([stored.status, stored.connection_config.header]).toEqual(["active", "Authorization"]);
    expect(JSON.stringify(stored)).not.toContain("a-working-token");
    expect(toolset("acme-reads")).toEqual({ kind: "toolset", name: "acme-reads", tools: [] });
    expect(toolset("acme-writes")).toMatchObject({ write: true, tools: [] });
    expect(role("acme")?.mcp_toolsets).toEqual(["acme-reads", "acme-writes"]);
    expect(mockApi.services.endpoints("acme")).toEqual([]);
  });

  it("keeps each endpoint as a tool in the toolset of its kind, and no role changes", () => {
    mockApi.services.add(acme);
    expect(mockApi.services.saveEndpoint("nope", endpoint).ok).toBe(false);
    expect(mockApi.services.saveEndpoint("acme", { ...endpoint, path: "invoices" }).ok).toBe(false);
    expect(mockApi.services.saveEndpoint("acme", endpoint).message).toBe(
      "acme-list-invoices is saved: a role that holds acme-reads can call it.",
    );
    const note = {
      ...endpoint,
      name: "add-note",
      method: "POST" as const,
      path: "/invoices/{invoice_id}/notes",
      query: [],
      body: true,
    };
    expect(mockApi.services.saveEndpoint("acme", note).ok).toBe(true);
    // Read back as they were entered; every method but GET changes data.
    expect(mockApi.services.endpoints("acme")).toEqual([
      { ...endpoint, tool: "acme-list-invoices", write: false },
      { ...note, tool: "acme-add-note", write: true },
    ]);
    expect(toolset("acme-reads")?.tools).toEqual(["acme-list-invoices"]);
    expect(toolset("acme-writes")?.tools).toEqual(["acme-add-note"]);
    // Such a tool goes with its system: the MCP page lists it and edits it nowhere.
    const tool = mockApi.mcp.tools().find((t) => t.name === "acme-add-note")!;
    expect([tool.service, tool.parameters.map((p) => p.name)]).toEqual([
      "acme",
      ["invoice_id", "body"],
    ]);

    // An endpoint whose method changes moves to the other toolset.
    mockApi.services.saveEndpoint("acme", { ...endpoint, method: "DELETE" });
    expect(toolset("acme-reads")?.tools).toEqual([]);
    expect(toolset("acme-writes")?.tools).toEqual(["acme-add-note", "acme-list-invoices"]);
    expect(role("acme")?.mcp_toolsets).toEqual(["acme-reads", "acme-writes"]);

    expect(mockApi.services.removeEndpoint("acme", "add-note").ok).toBe(true);
    expect(mockApi.services.removeEndpoint("acme", "add-note").ok).toBe(false);
    expect(toolset("acme-writes")?.tools).toEqual(["acme-list-invoices"]);
  });

  it("takes its endpoints, its toolsets, its sources and its role with it", () => {
    mockApi.services.add(acme);
    mockApi.services.saveEndpoint("acme", endpoint);
    mockApi.services.remove("acme");
    expect(mockApi.mcp.tools().some((t) => t.service === "acme")).toBe(false);
    expect(mockApi.mcp.sources().some((s) => s.name.startsWith("acme-"))).toBe(false);
    expect(toolset("acme-reads")).toBeUndefined();
    expect(role("acme")).toBeUndefined();
  });
});

describe("mock Auto Ontology server", () => {
  const server = {
    name: "terms",
    service_type: "api" as const,
    adapter: "auto_ontology",
    host: "https://auto-ontology.example",
    api_key: "auto_ontology_a-viewers-token",
    domain: "higher-ed",
  };

  it("draws no term before one is connected", () => {
    const g = mockApi.graph(false);
    expect(g.nodes.some((n) => n.kind === "term")).toBe(false);
    expect(g.links.some((l) => l.kind === "represents" || l.kind === "joins")).toBe(false);
  });

  it("is connected at once and read: its terms stand on the seeded tables, and it is no node", () => {
    expect(mockApi.services.add({ ...server, host: "http://localhost:3001" }).ok).toBe(false);
    expect(mockApi.services.add(server)).toEqual({
      ok: true,
      message: "'terms' is connected: 8 terms read.",
    });
    const stored = mockApi.services.get("terms")!;
    expect(stored.status).toBe("active");
    expect(JSON.stringify(stored)).not.toContain("a-viewers-token");
    expect(stored.schema_manifest).toMatchObject({
      terms: 8,
      of: 8,
      tables: [],
      databases: [
        { name: "CSPRD", terms: 5 },
        { name: "ADMISSIONS", terms: 3 },
      ],
    });

    const g = mockApi.graph(false);
    expect(g.nodes.some((n) => n.id === "service:terms")).toBe(false);
    expect(g.nodes.filter((n) => n.kind === "term")).toHaveLength(5);
    expect(g.nodes.find((n) => n.id === "term:terms:student")).toMatchObject({
      kind: "term",
      label: "Student",
      group: "",
      health: null,
      meta: {
        service: "terms",
        synonyms: ["learner", "pupil"],
        certification: "certified",
        elsewhere: 0,
      },
    });
    expect(g.links).toContainEqual({
      source: "table:peoplesoft:SYSADM.PS_STDNT_BIO",
      target: "term:terms:student",
      kind: "represents",
      wildcard: false,
    });
    // One join the database does not declare: no foreign key runs between the two tables.
    const [from, to] = [
      "table:peoplesoft:SYSADM.PS_STDNT_ENRL",
      "table:peoplesoft:SYSADM.PS_STDNT_CAR_TERM",
    ];
    expect(g.links.filter((l) => l.kind === "joins")).toEqual([
      { source: from, target: to, kind: "joins", wildcard: false },
    ]);
    expect(
      g.links.some(
        (l) =>
          l.kind === "references" && [from, to].includes(l.source) && [from, to].includes(l.target),
      ),
    ).toBe(false);
  });

  it("is read again by Discover, answers a term's columns, and takes its terms with it", () => {
    mockApi.services.add(server);
    expect(mockApi.services.discover("terms")).toEqual({ ok: true, message: "8 terms read." });
    const column = (name: string, column: string) => ({
      name,
      description: "",
      certified: false,
      table: "PS_STDNT_ENRL",
      column,
    });
    expect(mockApi.services.term("terms", "enrollment")).toEqual({
      ok: true,
      message: "",
      columns: [
        column("Student ID", "EMPLID"),
        column("Class number", "CLASS_NBR"),
        column("Units taken", "UNT_TAKEN"),
      ],
      calculations: [
        {
          name: "Units in a term",
          description: "",
          expression: "SUM(UNT_TAKEN)",
          certified: false,
        },
      ],
    });
    // Neither a term it does not hold, nor a system that is no Auto Ontology server.
    expect(mockApi.services.term("terms", "nope").ok).toBe(false);
    expect(mockApi.services.term("peoplesoft", "student").ok).toBe(false);
    mockApi.services.remove("terms");
    expect(mockApi.graph(false).nodes.some((n) => n.kind === "term")).toBe(false);
  });
});
