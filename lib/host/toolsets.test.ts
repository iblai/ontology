import { describe, expect, it, vi } from "vitest";
import type { StoredApi } from "./apis";
import { HostError } from "./errors";
import { fixtureReading } from "./reading.fixture";
import type { ToolboxDoc, ToolParam } from "./toolbox-config";
import { catalogFrom, serverDocs } from "./toolsets";

// The builders are stubbed so these tests read only the generator's own rules.
vi.mock("./toolbox-config", () => {
  const pg = {
    engine: "postgres",
    source: "postgres",
    sqlTool: "postgres-sql",
    executeTool: "postgres-execute-sql",
    placeholder: (i: number) => `$${i}`,
    quote: (s: string) => `"${s}"`,
  };
  type Doc = { kind: string; name: string; [key: string]: unknown };
  return {
    dialectOf: (type: string) => (type === "postgresql" ? pg : null),
    sourceDoc: (name: string, _c: unknown, env: string) => ({
      kind: "source",
      name,
      type: "postgres",
      password: `\${${env}}`,
    }),
    sqlToolDoc: (i: { name: string; source: string; statement: string; parameters: unknown }) => ({
      kind: "tool",
      name: i.name,
      type: "postgres-sql",
      source: i.source,
      statement: i.statement,
      parameters: i.parameters,
    }),
    rawDocs: (source: string) => [
      {
        kind: "tool",
        name: `${source}_execute_sql`,
        type: "postgres-execute-sql",
        source,
        parameters: [{ name: "sql", type: "string" }],
      },
      { kind: "tool", name: `${source}_list_tables`, type: "postgres-list-tables", source },
    ],
    toolsetDoc: (name: string, tools: string[]) => ({ kind: "toolset", name, tools }),
    authDocs: () => [{ kind: "authService", name: "entra", type: "generic" }],
    whyStatementWrites: (s: string) => (/\b(DELETE|UPDATE)\b/i.test(s) ? "it changes data" : null),
    writingToolsets: (docs: Doc[]) => {
      const writes = (d: Doc) =>
        /-(execute-sql|list-tables)$/.test(String(d.type)) ||
        (d.type === "http" && d.method !== "GET") ||
        /\bUPDATE\b/.test(String(d.statement ?? ""));
      const writers = new Set(
        docs.filter((d) => d.kind === "tool" && writes(d)).map((d) => d.name),
      );
      return docs
        .filter((d) => d.kind === "toolset" && (d.tools as string[]).some((t) => writers.has(t)))
        .map((d) => d.name);
    },
    parseConfig: () => [],
  };
});
vi.mock("./apis", () => ({
  listApis: async () => [],
  apiDocs: (api: { name: string }) => [
    { kind: "source", name: `${api.name}-reads`, type: "http" },
    { kind: "source", name: `${api.name}-writes`, type: "http" },
    {
      kind: "tool",
      name: "slate_query",
      type: "http",
      method: "GET",
      source: `${api.name}-reads`,
      pathParams: [{ name: "query_id", type: "string" }],
    },
    {
      kind: "tool",
      name: "slate_note",
      type: "http",
      method: "POST",
      source: `${api.name}-writes`,
      bodyParams: [{ name: "note", type: "string" }],
      queryParams: [{ name: "tag", type: "string", required: false }],
    },
    { kind: "toolset", name: `${api.name}-reads`, tools: ["slate_query"] },
    { kind: "toolset", name: `${api.name}-writes`, tools: ["slate_note"] },
  ],
}));
vi.mock("./files", () => ({
  slugOf: (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  envName: (name: string, suffix: string) =>
    `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`,
  homePath: vi.fn<typeof import("./files").homePath>(),
  readText: vi.fn<typeof import("./files").readText>(),
  readEnv: vi.fn<typeof import("./files").readEnv>(),
}));

const slate: StoredApi = {
  name: "slate",
  baseUrl: "https://slate.example/api",
  authHeader: "",
  endpoints: [],
  tools: 2,
  secretEnv: null,
  private: false,
  local: false,
};

const actions: ToolboxDoc[] = [
  {
    kind: "tool",
    name: "flag_at_risk",
    type: "postgres-sql",
    source: "sis-rw",
    statement: "UPDATE students SET flagged = true WHERE banner_id = $1",
    parameters: [{ name: "student_id" }, { name: "reason" }],
  },
  { kind: "toolset", name: "advising-actions", tools: ["flag_at_risk"] },
];

const catalog = () =>
  catalogFrom({
    reading: fixtureReading(),
    apis: [slate],
    actions,
    env: ["SIS_DB_PASSWORD", "CRM_DB_PASSWORD"],
  });

const doc = (name: string, kind = "tool") =>
  catalog().docs.find((d) => d.kind === kind && d.name === name);

describe("catalogFrom", () => {
  it("lists the toolsets in order, each with its kind, default and risk", () => {
    const rows = catalog().toolsets.map((t) => [t.name, t.kind, t.defaultOn, t.risk ?? null]);
    expect(rows).toEqual([
      ["sis", "terms", true, null],
      ["advising", "terms", true, null],
      ["sis-tag", "terms", true, null],
      ["slate-reads", "api", true, null],
      ["slate-writes", "api", false, "writes"],
      ["semantic", "semantic", true, null],
      ["advising-actions", "actions", false, "writes"],
      ["sis-raw", "raw", false, "unrestricted"],
    ]);
  });

  it("names and signs a system's tools as the mock does", () => {
    const sis = catalog().toolsets.find((t) => t.name === "sis")!;
    expect(sis.summary).toBe("Student · Enrollment · Section · metrics");
    expect(sis.tools).toEqual([
      { name: "search_students", sig: "search_students(query, limit?)", note: "→ Student[]" },
      { name: "get_student", sig: "get_student(student_id)", note: "→ Student" },
      { name: "retention_rate", sig: "retention_rate()", note: "metric" },
      {
        name: "search_enrollments",
        sig: "search_enrollments(query, limit?)",
        note: "→ Enrollment[]",
      },
      { name: "search_sections", sig: "search_sections(limit?)", note: "→ Section[]" },
      { name: "get_section", sig: "get_section(id)", note: "→ Section" },
    ]);
  });

  it("gives one toolset per tag and suffixes a tag named like a system", () => {
    const toolsets = catalog().toolsets;
    const advising = toolsets.find((t) => t.name === "advising")!;
    expect(advising.summary).toBe("Student · Enrollment · metrics");
    expect(advising.tools.map((t) => t.name)).toEqual([
      "search_students",
      "get_student",
      "retention_rate",
      "search_enrollments",
    ]);
    expect(toolsets.find((t) => t.name === "sis-tag")!.summary).toBe("Student · metrics");
  });

  it("searches the certified text columns and fetches by the key other tables point at", () => {
    const search = doc("search_students")!;
    expect(search.statement).toBe(
      `SELECT "banner_id" AS "student_id", "email" AS "email", "gpa" AS "gpa" FROM "public"."students"` +
        ` WHERE LOWER(CONCAT(COALESCE("banner_id", ''), ' ', COALESCE("email", '')))` +
        ` LIKE LOWER('%' || $1 || '%') LIMIT $2`,
    );
    const params = search.parameters as ToolParam[];
    expect(params.map((p) => [p.name, p.default])).toEqual([
      ["query", ""],
      ["limit", 20],
    ]);
    const get = doc("get_student")!;
    expect(get.statement).toMatch(/FROM "public"\."students" WHERE "banner_id" = \$1$/);
    expect(get.source).toBe("sis");
    const section = doc("get_section")!;
    expect(section.statement).toBe(`SELECT * FROM "public"."sections" WHERE "id" = $1`);
  });

  it("says in plain words what it left out", () => {
    expect(catalog().skipped).toEqual([
      "crm is not served: the runtime has no source for databricks connections.",
      "lms is not served: the host does not hold its password (LMS_DB_PASSWORD).",
      "the metric purge_inactive of Student was left out: it changes data.",
      "get_enrollment was left out: no foreign key points at enrollments and it has no id column.",
      "search_sections takes no query: Section has no certified text column to search.",
      "Customer has no table in a served system, so it has no tools.",
    ]);
  });

  it("leaves out a generated tool named like one of the gateway's own", () => {
    const reading = structuredClone(fixtureReading()); // the fixture's terms are shared
    reading.terms.find((t) => t.term.name === "Section")!.term.name = "Term";
    const made = catalogFrom({ reading, apis: [], actions: [], env: ["SIS_DB_PASSWORD"] });
    const names = made.docs.filter((d) => d.kind === "tool").map((d) => d.name);
    expect(names).not.toContain("search_terms");
    expect(names).toContain("get_term");
    expect(made.skipped).toContain(
      "search_terms of Term was left out: another tool has that name.",
    );
  });

  it("gives an uncertified term nothing and leaves a writing metric out", () => {
    const names = catalog().docs.map((d) => d.name);
    expect(names.filter((n) => /course|fill_rate|draft|purge/.test(n))).toEqual([]);
  });

  it("keeps the raw tools on a source of their own and the semantic tools from the gateway", () => {
    const { toolsets } = catalog();
    const raw = toolsets.find((t) => t.name === "sis-raw")!;
    expect(raw.summary).toBe("prebuilt · postgres · read-only login");
    expect(raw.tools.map((t) => t.sig)).toEqual([
      "sis-raw_execute_sql(sql)",
      "sis-raw_list_tables()",
    ]);
    expect(doc("sis-raw_execute_sql")!.source).toBe("sis-raw");
    expect(doc("sis-raw", "source")).toBeDefined();
    const semantic = toolsets.find((t) => t.name === "semantic")!;
    expect(semantic.summary).toBe("glossary · catalog · questions");
    expect(semantic.tools.map((t) => t.sig)).toEqual([
      "ask_question(question)",
      "search_terms(query)",
      "describe_table(table)",
    ]);
    expect(doc("semantic", "toolset")).toBeUndefined();
  });

  it("signs the APIs' and the actions' tools from their documents", () => {
    const { toolsets } = catalog();
    expect(toolsets.find((t) => t.name === "slate-reads")!.tools).toEqual([
      { name: "slate_query", sig: "slate_query(query_id)", note: "http · live API" },
    ]);
    expect(toolsets.find((t) => t.name === "slate-writes")!.tools).toEqual([
      { name: "slate_note", sig: "slate_note(tag?, note)" },
    ]);
    const flag = toolsets.find((t) => t.name === "advising-actions")!;
    expect(flag.summary).toBe("write tools");
    expect(flag.tools).toEqual([{ name: "flag_at_risk", sig: "flag_at_risk(student_id, reason)" }]);
  });
});

describe("serverDocs", () => {
  const draft = (toolsets: string[]) => ({
    toolsets,
    auth: { platform: true },
    origins: [],
    hosts: [],
  });

  it("takes the chosen toolsets, their tools, the sources they use and the auth services", () => {
    const docs = serverDocs(catalog(), draft(["sis", "semantic"]));
    expect(docs.map((d) => `${d.kind}:${d.name}`)).toEqual([
      "source:sis",
      "tool:search_students",
      "tool:get_student",
      "tool:retention_rate",
      "tool:search_enrollments",
      "tool:search_sections",
      "tool:get_section",
      "toolset:sis",
      "authService:entra",
    ]);
  });

  it("refuses a toolset the catalog does not have, by name", () => {
    expect(() => serverDocs(catalog(), draft(["sis", "nope"]))).toThrow(HostError);
    const refused = () => serverDocs(catalog(), draft(["nope"]));
    expect(refused).toThrow("There is no toolset named “nope”.");
  });
});
