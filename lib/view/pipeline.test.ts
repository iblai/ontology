import { describe, expect, it } from "vitest";
import type { HostGraph, HostSystem, HostToolset } from "@/lib/host/types";
import type { LogLine } from "@/lib/view/types";
import { bannerOf, pipelineView, stagesDone } from "./pipeline";

const system = (name: string, over: Partial<HostSystem> = {}): HostSystem => ({
  name,
  label: name,
  engine: "postgresql",
  url: `postgresql://ro@db:5432/${name}`,
  tables: 2,
  scoped: false,
  piiColumns: 1,
  terms: 1,
  status: "ingested",
  serve: true,
  ...over,
});

const graph = (over: Partial<HostGraph> = {}): HostGraph => ({
  systems: ["sis", "lms"],
  tables: [
    { id: "t1", name: "students", system: "sis", schema: "public", columns: 7 },
    { id: "t2", name: "enrollments", system: "sis", schema: "public", columns: 5 },
    { id: "t3", name: "auth_user", system: "lms", schema: null, columns: 4 },
  ],
  foreignKeys: [["t2", "t1"]],
  terms: [
    {
      id: "a",
      name: "Student",
      description: "A person enrolled.",
      synonyms: ["learner"],
      certified: true,
      tags: ["person"],
      tables: ["t1", "t3"],
      metrics: [{ id: "m1", name: "at_risk", certified: false, expression: "gpa < 2" }],
      properties: 6,
    },
    {
      id: "b",
      name: "Enrollment",
      description: "",
      synonyms: [],
      certified: false,
      tags: [],
      tables: ["t2"],
      metrics: [],
      properties: 3,
    },
  ],
  termLinks: [["a", "b"]],
  compile: { calculated: true, running: false, lastSuccessAt: null, lastFailureAt: null },
  ...over,
});

const toolsets: HostToolset[] = [
  {
    name: "advising",
    summary: "",
    tools: [{ name: "list_student", sig: "list_student()" }],
    defaultOn: true,
    kind: "terms",
  },
];

const text = (l: LogLine) => l.parts.map((p) => (typeof p === "string" ? p : p.b)).join("");

describe("stagesDone", () => {
  it("marks all six done on a finished engine", () => {
    expect(stagesDone(graph(), [system("sis"), system("lms")])).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("keeps ingest open while a system has no tables", () => {
    const done = stagesDone(graph(), [system("sis"), system("lms"), system("crm")]);
    expect(done[0]).toBe(false);
  });

  it("follows each stage's own rule", () => {
    const g = graph({
      tables: [{ id: "t1", name: "students", system: "sis", schema: null, columns: null }],
      foreignKeys: [],
      termLinks: [],
      compile: { calculated: true, running: true, lastSuccessAt: null, lastFailureAt: null },
    });
    expect(stagesDone(g, [system("sis")])).toEqual([true, false, true, false, false, false]);
  });

  it("ends every stage from naming on once the compile has finished, whatever it found", () => {
    // Terms, no keys, no links, nothing certified: what a first dissect leaves.
    const bare = graph({ foreignKeys: [], termLinks: [] });
    expect(stagesDone(bare, [system("sis"), system("lms")])).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(pipelineView(bare, [system("sis"), system("lms")], []).current).toBe(6);
  });

  it("does not end the pipeline on tools alone", () => {
    const compile = { calculated: false, running: false, lastSuccessAt: null, lastFailureAt: null };
    const view = pipelineView(graph({ compile }), [system("sis"), system("lms")], toolsets);
    expect(view.current).toBe(4);
  });
});

describe("pipelineView", () => {
  it("points at the first stage not done, 6 when all are", () => {
    expect(pipelineView(graph(), [system("sis"), system("lms")], toolsets).current).toBe(6);
    // No term yet and the compile still running: naming is the stage in hand.
    const compile = { calculated: false, running: true, lastSuccessAt: null, lastFailureAt: null };
    const naming = pipelineView(graph({ terms: [], compile }), [system("sis"), system("lms")], []);
    expect(naming.current).toBe(2);
  });

  it("is busy while a system is still being read or compiled", () => {
    const busy = (status: HostSystem["status"]) =>
      pipelineView(graph(), [system("sis"), system("lms", { status })], toolsets).busy;
    expect(busy("ingested")).toBe(false);
    expect(busy("ingesting")).toBe(true);
    expect(busy("compiling")).toBe(true);
  });

  it("writes the lines from real numbers and names, as parts", () => {
    const v = pipelineView(graph(), [system("sis"), system("lms", { piiColumns: 2 })], toolsets);
    expect(v.lines).toHaveLength(6);
    expect(v.lines[0][0].parts[0]).toEqual({ b: "ingest" });
    expect(text(v.lines[0][0])).toBe("ingest sis, lms → 2 systems");
    expect(text(v.lines[0][1])).toBe("sis: 2 tables · lms: 1 table");
    expect(text(v.lines[1][0])).toBe("profiling 3 tables · 16 columns");
    expect(text(v.lines[1][1])).toBe("PII tags: sis 1 column · lms 2 columns");
    expect(text(v.lines[2][0])).toBe("Student ← students, auth_user · “learner”");
    expect(text(v.lines[2][1])).toBe("2 terms · 9 column mappings");
    expect(text(v.lines[3][0])).toBe("resolving joins: 1 foreign key");
    expect(text(v.lines[3][1])).toBe(
      "Student mapped to 2 tables in 2 systems: sis.students, lms.auth_user",
    );
    expect(text(v.lines[3][2])).toBe("metrics: at_risk");
    expect(text(v.lines[4][0])).toBe("compiled · 2 terms · 1 relationship · 1 SQL attribute");
    expect(text(v.lines[5][0])).toBe("1 object type → 1 tool · 1 toolset");
    expect(text(v.lines[5][1])).toBe("ready → review the ontology, then expose");
  });
});

describe("bannerOf", () => {
  it("prefers an uncertified term across systems, else a certified one, else none", () => {
    expect(bannerOf(graph())).toEqual({
      termId: "a",
      term: "Student",
      tables: ["sis.students", "lms.auth_user"],
      certified: true,
    });
    const g = graph();
    g.terms[1] = { ...g.terms[1], tables: ["t2", "t3"] };
    expect(bannerOf(g)?.term).toBe("Enrollment");
    expect(bannerOf(graph({ terms: [] }))).toBeNull();
  });
});
