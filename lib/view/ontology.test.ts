import { describe, expect, it } from "vitest";
import type { AoColumnAttribute, AoSqlAttribute, AoTermDetail } from "@/lib/ao-types";
import type { HostGraph, HostSystem, HostToolset } from "@/lib/host/types";
import { linkName, objectTypeView, ontologyTree, snake } from "./ontology";

const g: HostGraph = {
  systems: ["sis", "crm"],
  tables: [
    { id: "t1", name: "students", system: "sis", schema: null, columns: 3 },
    { id: "t2", name: "person", system: "crm", schema: null, columns: 2 },
    { id: "t3", name: "company", system: "crm", schema: null, columns: 2 },
  ],
  foreignKeys: [["t2", "t3"]],
  terms: [
    {
      id: "a",
      name: "Student",
      description: "A person enrolled.",
      synonyms: [],
      certified: true,
      tags: ["person"],
      tables: ["t1", "t2"],
      metrics: [{ id: "m1", name: "retention_rate", certified: true, expression: "x" }],
      properties: 2,
    },
    {
      id: "b",
      name: "HighSchool",
      description: "",
      synonyms: [],
      certified: false,
      tags: ["person", "billable"],
      tables: ["t2", "t3"],
      metrics: [{ id: "m2", name: "at_risk", certified: false, expression: "y" }],
      properties: 0,
    },
  ],
  termLinks: [["a", "b"]],
  compile: { calculated: true, running: false, lastSuccessAt: null, lastFailureAt: null },
};

const toolsets: HostToolset[] = [
  {
    name: "advising-actions",
    summary: "",
    defaultOn: false,
    risk: "writes",
    kind: "actions",
    tools: [
      { name: "flag_at_risk", sig: "flag_at_risk(student_id, reason)" },
      { name: "close_flag", sig: "close_flag(flag_id)" },
    ],
  },
];

const systems: HostSystem[] = [
  {
    name: "sis",
    label: "sis",
    engine: "postgresql",
    url: "",
    tables: 1,
    scoped: false,
    piiColumns: 0,
    terms: 1,
    status: "ingested",
    serve: true,
  },
];

const audit = { created: null, modified: null, created_by: null, modified_by: null };

describe("ontologyTree", () => {
  it("names link types in snake case and sorts metrics and tags", () => {
    expect(snake("HighSchool")).toBe("high_school");
    expect(linkName("Student", "Course Section")).toBe("student_course_section");
    expect(ontologyTree(g, toolsets)).toEqual({
      objectTypes: [
        { id: "a", name: "Student", systems: 2, status: "certified" },
        { id: "b", name: "HighSchool", systems: 1, status: "suggested" },
      ],
      linkTypes: ["student_high_school"],
      metrics: ["at_risk", "retention_rate"],
      actions: ["flag_at_risk", "close_flag"],
      tags: ["billable", "person"],
      certified: 1,
      suggested: 1,
    });
  });
});

describe("objectTypeView", () => {
  const detail: AoTermDetail = {
    ...audit,
    id: "a",
    name: "Student",
    description: "A person enrolled.",
    synonyms: ["learner"],
    name_certified: true,
    description_certified: true,
    certification: "certified",
    owner_id: null,
    zones: null,
    table_count: 2,
    tables: [],
    related_terms: [{ id: "b", name: "HighSchool", description: null }],
    tags: [{ id: "x", name: "person" }],
  };
  const column = (id: string, name: string, col: string, tags: string[]): AoColumnAttribute => ({
    ...audit,
    id,
    name,
    description: null,
    term_name: "Student",
    source_column: col,
    datatype: "string",
    table_id: "t1",
    sample_values: null,
    certified: id === "c1",
    zones: null,
    tags: tags.map((t) => ({ id: t, name: t })),
    primary_column: null,
    referenced_columns: null,
  });
  const sql: AoSqlAttribute = {
    ...audit,
    id: "m1",
    name: "retention_rate",
    description: null,
    description_suggestion: null,
    expression: "count(*)",
    source: null,
    sql: null,
    sql_id: null,
    certified: false,
    term_id: "a",
    term_name: "Student",
    database_name: "sis",
    owner_id: null,
    zones: null,
    tags: null,
  };

  it("places the term's detail and attributes on the graph", () => {
    const v = objectTypeView({
      detail,
      columns: [
        column("c1", "student_id", "student_id", []),
        column("c2", "email", "email", ["PII"]),
      ],
      sql: [sql],
      graph: g,
      systems,
      toolsets,
    });
    expect(v).toMatchObject({ name: "Student", status: "certified", systems: 2, tags: ["person"] });
    expect(v.backing).toEqual([
      { color: "#336791", name: "sis.students", note: "primary" },
      { color: "#9ca3af", name: "crm.person", note: "shared key" },
    ]);
    expect(v.properties).toEqual([
      {
        id: "c1",
        name: "student_id",
        key: true,
        type: "string",
        column: "sis.students.student_id",
        pii: false,
        status: "certified",
      },
      {
        id: "c2",
        name: "email",
        key: undefined,
        type: "string",
        column: "sis.students.email",
        pii: true,
        status: "suggested",
      },
    ]);
    expect(v.links).toEqual([
      { name: "student_high_school", dir: "→", target: "HighSchool", via: "crm.person" },
    ]);
    expect(v.metrics).toEqual([
      { id: "m1", name: "retention_rate", expr: "count(*)", grain: "Student", status: "suggested" },
    ]);
    expect(v.actions).toEqual([
      { name: "flag_at_risk", sig: "(student_id, reason)", via: "toolset advising-actions" },
    ]);
  });
});
