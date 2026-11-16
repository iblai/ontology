import { beforeEach, describe, expect, it, vi } from "vitest";
import { aoJson } from "./ao";
import { inPlatform } from "./platform";
import { forgetReading, graphOf, readEngine, systemsOf } from "./reading";
import { fixtureReading } from "./reading.fixture";

vi.mock("./ao", () => ({ aoJson: vi.fn<typeof import("./ao").aoJson>() }));
vi.mock("./files", () => ({
  envName: (name: string, suffix: string) =>
    `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`,
}));
vi.mock("./toolbox-config", () => ({
  dialectOf: (type: string) => (type === "postgresql" ? { engine: "postgres" } : null),
}));

describe("systemsOf", () => {
  const env = ["SIS_DB_PASSWORD", "CRM_DB_PASSWORD"];

  it("gives one system per connection with what the engine read", () => {
    const [sis, crm] = systemsOf(fixtureReading(), env, { sis: "Student records" });
    expect(sis).toEqual({
      name: "sis",
      label: "Student records",
      engine: "postgresql",
      url: "postgresql://ro@db.example:5432/sis",
      tables: 4,
      scoped: true,
      piiColumns: 2,
      terms: 4,
      status: "ingested",
      serve: true,
    });
    expect(crm).toMatchObject({ url: "databricks://dbx.example/crm", tables: 1, scoped: false });
    expect(crm).toMatchObject({ piiColumns: 0, terms: 1, serve: false });
    // A system the admin gave no name is called by its database's.
    expect(crm.label).toBe(crm.name);
  });

  it("shows a database the engine does not list yet as ingesting, with no counts", () => {
    const lms = systemsOf(fixtureReading(), env)[2];
    expect(lms).toEqual({
      name: "lms",
      label: "lms",
      engine: "postgresql",
      url: "postgresql://u@lms.example/lms",
      tables: null,
      scoped: false,
      piiColumns: null,
      terms: null,
      status: "ingesting",
      serve: false,
    });
  });

  it("marks every system compiling while the compile runs", () => {
    const reading = fixtureReading();
    reading.status.running = true;
    expect(systemsOf(reading, env).map((s) => s.status)).toEqual([
      "compiling",
      "compiling",
      "compiling",
    ]);
  });

  it("writes a snowflake address with its account and never a password", () => {
    const reading = fixtureReading();
    reading.connections = [
      {
        database_name: "wh",
        connection: {
          type: "snowflake",
          account: "acme-1",
          warehouse: "w",
          user: "svc",
          database: "wh",
          password: "secret",
        },
      },
    ];
    expect(systemsOf(reading, []).map((s) => s.url)).toEqual(["snowflake://svc@acme-1/wh"]);
  });
});

describe("graphOf", () => {
  it("gives the tables, the foreign keys, the terms and their links", () => {
    const graph = graphOf(fixtureReading());
    expect(graph.systems).toEqual(["sis", "crm", "lms"]);
    expect(graph.tables).toHaveLength(5);
    expect(graph.tables[0]).toEqual({
      id: "t-students",
      name: "students",
      system: "sis",
      schema: "public",
      columns: 5,
    });
    expect(graph.foreignKeys).toEqual([
      ["t-enrol", "t-students"],
      ["t-enrol", "t-sections"],
    ]);
    expect(graph.termLinks).toEqual([["term-student", "term-enrol"]]);
    expect(graph.compile).toEqual({
      calculated: true,
      running: false,
      lastSuccessAt: null,
      lastFailureAt: null,
    });
  });

  it("certifies a term only when its name and description both are", () => {
    const terms = graphOf(fixtureReading()).terms;
    const student = terms.find((t) => t.name === "Student")!;
    expect(student).toMatchObject({
      certified: true,
      tags: ["Advising", "SIS"],
      tables: ["t-students"],
      properties: 4,
    });
    expect(student.metrics.map((m) => [m.name, m.certified])).toEqual([
      ["Retention Rate", true],
      ["Purge Inactive", true],
      ["Draft", false],
    ]);
    expect(terms.find((t) => t.name === "Course")!.certified).toBe(false);
  });
});

describe("readEngine", () => {
  let calls: string[];
  let inFlight: number;
  let most: number;

  // The engine as the routes answer it: envelopes, pages of 100, a PII tag and its targets.
  function answer(path: string): unknown {
    if (path === "/connections") return { data: fixtureReading().connections, count: 3 };
    if (path === "/datasources/dbs") {
      return { data: [{ id: "db1", name: "sis", schemas: [] }], count: 1 };
    }
    if (path === "/schemas/db1") {
      return { schemas: [{ id: "s1", schema_name: "public", tables_count: 3 }], schemas_count: 1 };
    }
    if (path.startsWith("/exploration/")) return { data: { nodes: [], links: [] } };
    if (path === "/semantic-compilation/status") return fixtureReading().status;
    if (path === "/tags?query=PII") {
      return {
        data: [
          { id: "tag-1", name: "PII-review" },
          { id: "tag-2", name: "PII" },
        ],
      };
    }
    if (path === "/tags/tag-2/targets") {
      return {
        data: [
          { type: "column", database_id: "db1" },
          { type: "column", database_id: "db1" },
          { type: "table", database_id: "db1" },
        ],
      };
    }
    const page = /^\/terms\?skip=(\d+)&limit=100$/.exec(path);
    if (page) {
      const skip = Number(page[1]);
      const ids = skip === 0 ? 100 : 1;
      return { terms: Array.from({ length: ids }, (_, i) => ({ id: `t${skip + i}` })), total: 101 };
    }
    if (/^\/terms\/t\d+\/(column|sql)-attributes$/.test(path)) return { data: [] };
    if (/^\/terms\/t\d+$/.test(path)) {
      return { data: { id: path.slice(7), name: "  A\n term ", description: null, tables: [] } };
    }
    throw new Error(`unexpected ${path}`);
  }

  const acme = () => inPlatform("acme", readEngine);

  beforeEach(() => {
    inPlatform("acme", forgetReading);
    inPlatform("beta", forgetReading);
    calls = [];
    inFlight = 0;
    most = 0;
    vi.mocked(aoJson).mockImplementation((async (path: string) => {
      calls.push(path);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return answer(path);
    }) as typeof aoJson);
  });

  it("reads every page of terms, eight calls at a time", async () => {
    const reading = await acme();
    expect(reading.terms).toHaveLength(101);
    expect(reading.terms[0].term.name).toBe("A term");
    expect(calls.filter((c) => c.startsWith("/terms?"))).toEqual([
      "/terms?skip=0&limit=100",
      "/terms?skip=100&limit=100",
    ]);
    expect(most).toBe(8);
  });

  it("counts the PII tag's columns per connection and the schemas' tables", async () => {
    const reading = await acme();
    expect(reading.pii).toEqual({ sis: 2 });
    expect(reading.databases[0].schemas[0].tables_count).toBe(3);
    expect(reading.graph).toEqual({ nodes: [], links: [] });
  });

  it("shares a reading in flight and reads again once forgotten", async () => {
    const [a, b] = await Promise.all([acme(), acme()]);
    expect(a).toBe(b);
    expect(await acme()).toBe(a);
    inPlatform("acme", forgetReading);
    await acme();
    expect(calls.filter((c) => c === "/connections")).toHaveLength(2);
  });

  it("keeps one reading per platform and forgets only the current one", async () => {
    const a = await acme();
    expect(await inPlatform("beta", readEngine)).not.toBe(a);
    inPlatform("beta", forgetReading);
    expect(await acme()).toBe(a);
    expect(calls.filter((c) => c === "/connections")).toHaveLength(2);
  });

  it("refuses to read outside a platform", async () => {
    await expect(readEngine()).rejects.toThrow(/for no platform/);
  });
});
