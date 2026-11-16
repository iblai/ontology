import { describe, expect, it } from "vitest";
import type { AoTableColumnsPage } from "@/lib/ao-types";
import type { HostGraph } from "@/lib/host/types";
import { columnRows, demoColumn } from "./columns";
import { graphView } from "./graph";

const g: HostGraph = {
  systems: ["sis", "lms"],
  tables: [
    { id: "t1", name: "students", system: "sis", schema: null, columns: 3 },
    { id: "t2", name: "auth_user", system: "lms", schema: null, columns: 2 },
  ],
  foreignKeys: [["t2", "t1"]],
  terms: [
    {
      id: "a",
      name: "Student",
      description: "d",
      synonyms: ["learner"],
      certified: true,
      tags: [],
      tables: ["t1", "t2"],
      metrics: [{ id: "m", name: "at_risk", certified: true, expression: "x" }],
      properties: 0,
    },
  ],
  termLinks: [],
  compile: { calculated: false, running: false, lastSuccessAt: null, lastFailureAt: null },
};

describe("graphView", () => {
  it("tints each source by its engine and leaves rows and columns to load", () => {
    const v = graphView(g, [
      {
        name: "sis",
        label: "Student records",
        engine: "postgresql",
        url: "",
        tables: 1,
        scoped: false,
        piiColumns: 0,
        terms: 1,
        status: "ingested",
        serve: true,
      },
    ]);
    expect(v.sources).toEqual([
      { key: "sis", name: "Student records", color: "#336791" },
      { key: "lms", name: "lms", color: "#9ca3af" },
    ]);
    expect(v.tables[0]).toEqual({ id: "t1", name: "students", src: "sis", rows: null, cols: [] });
    expect(v.terms[0]).toMatchObject({ name: "Student", maps: ["t1", "t2"], syn: ["learner"] });
    expect(v.termMetrics.a).toEqual([{ id: "m", name: "at_risk", certified: true }]);
  });
});

describe("columnRows", () => {
  const page = (columns: [string, string, string[]][]): AoTableColumnsPage => ({
    data: {
      table_name: "students",
      table_type: null,
      schema_name: null,
      database_name: "sis",
      columns_count: columns.length,
      columns: columns.map(([name, type, tags], i) => ({
        id: String(i),
        ordinal_position: i,
        column_name: name,
        data_type: type,
        description: null,
        description_certified: null,
        sample_values: null,
        tags: tags.map((t) => ({ id: t, name: t })),
      })),
    },
    count: columns.length,
    total: columns.length,
  });

  it("reads kind from the type, PII from the tag and key from the foreign key", () => {
    const p = page([
      ["id", "integer", []],
      ["email", "character varying", ["PII"]],
      ["cum_gpa", "numeric(3,2)", []],
      ["admitted_at", "timestamp with time zone", []],
    ]);
    expect(columnRows(p, "t1", g.foreignKeys)).toEqual([
      { name: "id", kind: "key", pii: false },
      { name: "email", kind: "text", pii: true },
      { name: "cum_gpa", kind: "numeric", pii: false },
      { name: "admitted_at", kind: "temporal", pii: false },
    ]);
    expect(columnRows(p, "t9", g.foreignKeys)[0].kind).toBe("numeric");
  });

  it("names a mocked column's kind with the mocked Map's rules", () => {
    expect(demoColumn("banner_id")).toEqual({ name: "banner_id", kind: "key", pii: false });
    expect(demoColumn("first_name")).toEqual({ name: "first_name", kind: "text", pii: true });
    expect(demoColumn("balance").kind).toBe("numeric");
    expect(demoColumn("last_login").kind).toBe("temporal");
  });
});
