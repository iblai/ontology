import { describe, expect, it } from "vitest";
import type { AoConnectionConfig } from "@/lib/ao-types";
import { HostError } from "./errors";
import {
  authDocs,
  dialectOf,
  MARK,
  members,
  parseConfig,
  rawDocs,
  renderConfig,
  sourceDoc,
  sqlToolDoc,
  toolsetDoc,
  validateDocs,
  whyStatementWrites,
  writingTools,
  writingToolsets,
  type ToolboxDoc,
} from "./toolbox-config";

const sql = (
  name: string,
  statement: unknown,
  source = "ro",
  extra: Record<string, unknown> = {},
): ToolboxDoc => ({
  kind: "tool",
  name,
  type: "postgres-sql",
  source,
  statement,
  ...extra,
});

const pg = (database = "sis"): AoConnectionConfig => ({
  type: "postgresql",
  host: "db.example.edu",
  user: "reader",
  database,
});

// A small server: one source, a term tool, the raw tools on their own source, and auth.
function server(statement = "SELECT id FROM students WHERE id = $1"): ToolboxDoc[] {
  const dialect = dialectOf("postgresql")!;
  return [
    sourceDoc("sis", pg(), "SIS_DB_PASSWORD"),
    sourceDoc("sis-raw", pg(), "SIS_DB_PASSWORD"),
    sqlToolDoc({
      name: "get_student",
      source: "sis",
      dialect,
      description: "One student by id.",
      statement,
      parameters: [{ name: "id", type: "integer", description: "The student’s id." }],
    }),
    ...rawDocs("sis-raw", dialect),
    toolsetDoc("sis", ["get_student"]),
    toolsetDoc("sis-raw", ["sis-raw_execute_sql", "sis-raw_list_tables"]),
    ...authDocs({ platform: true, google: { audience: "123.apps.googleusercontent.com" } }),
  ];
}

describe("does it write?", () => {
  it.each([
    "SELECT id FROM students WHERE id = $1",
    "  (SELECT a FROM t) UNION (SELECT b FROM u);",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SHOW TABLES",
    "DESCRIBE students",
    "TABLE students",
    "VALUES (1), (2)",
    // A write word inside a longer name is not the word.
    "SELECT updated_at, is_deleted, created_by, grant_id FROM t",
  ])("a fixed statement that only reads is not a write: %s", (statement) => {
    expect(whyStatementWrites(statement)).toBeNull();
    expect(writingTools([sql("t", statement)])).toEqual({});
  });

  it.each([
    ["UPDATE holds SET released = true WHERE id = $1", "does not start with"],
    ["WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "holds DELETE"],
    ["SELECT * INTO backup FROM t", "holds INTO"],
    ["EXPLAIN ANALYZE DELETE FROM t", "does not start with"],
    ["SELECT 1; DROP TABLE t", "holds a ';'"],
    // T-SQL runs two statements without a semicolon between them.
    ["SELECT 1 DROP TABLE t", "holds DROP"],
    ["SELECT * FROM t FOR UPDATE", "holds UPDATE"],
    // A text scan, not a parser: the word counts inside a string too.
    ["SELECT * FROM aid WHERE kind = 'grant'", "holds GRANT"],
    ["", "no statement of its own"],
    [null, "no statement of its own"],
  ])("a statement not known to read is a write: %s", (statement, why) => {
    expect(writingTools([sql("t", statement)]).t).toContain(why);
  });

  it("counts what else writes", () => {
    const why = writingTools([
      sql("free-sql", "SELECT 1", "ro", { type: "postgres-execute-sql" }),
      sql("no-type", "SELECT 1", "ro", { type: "" }),
      sql("any-table", "SELECT * FROM {{.table}}", "ro", {
        templateParameters: [{ name: "table", type: "string" }],
      }),
      { kind: "tool", name: "get", type: "http", method: "get", path: "x" },
      { kind: "tool", name: "head", type: "http", method: "HEAD", path: "x" },
      { kind: "tool", name: "post", type: "http", method: "POST", path: "x" },
      { kind: "tool", name: "no-method", type: "http", path: "x" },
    ]);
    expect(Object.keys(why).sort()).toEqual([
      "any-table",
      "free-sql",
      "no-method",
      "no-type",
      "post",
    ]);
    expect(why["free-sql"]).toContain("postgres-execute-sql");
    expect(why["any-table"]).toContain("templateParameters");
    expect(why.post).toBe("its method is POST");
    expect(why["no-method"]).toBe("its method is not given");
  });

  it("makes every tool on a source one tool writes through a write", () => {
    const why = writingTools([
      sql("read", "SELECT 1"),
      sql("release-hold", "UPDATE holds SET released = true", "rw"),
      sql("looks-like-a-read", "SELECT 1", "rw"),
    ]);
    expect(Object.keys(why).sort()).toEqual(["looks-like-a-read", "release-hold"]);
    expect(why["looks-like-a-read"]).toBe("it shares the source 'rw' with 'release-hold'");
  });

  it("names the toolsets that hold a writer, raw ones included", () => {
    expect(writingToolsets(server())).toEqual(["sis-raw"]);
    expect(writingToolsets(server("DELETE FROM students"))).toEqual(["sis", "sis-raw"]);
  });
});

describe("validation", () => {
  it("takes the documents the builders make", () => {
    expect(() => validateDocs(server())).not.toThrow();
  });

  it("refuses a literal secret, at any depth", () => {
    const literal = { ...sourceDoc("sis", pg(), "SIS_DB_PASSWORD"), password: "hunter2" };
    expect(() => validateDocs([literal, sql("t", "SELECT 1", "sis")])).toThrow(
      /literal secret at password/,
    );
    const api: ToolboxDoc = {
      kind: "source",
      name: "acme",
      type: "http",
      baseUrl: "https://acme.example/",
      headers: { Authorization: "Bearer sk_live_1" },
    };
    const call = { kind: "tool", name: "x", type: "http", source: "acme", method: "GET" };
    expect(() => validateDocs([api, { ...call, path: "x", description: "X." }])).toThrow(
      /literal secret at headers.Authorization/,
    );
  });

  it("refuses ${ outside a source's reference", () => {
    const docs = server();
    docs[2] = { ...docs[2], description: "Costs ${amount}" };
    expect(() => validateDocs(docs)).toThrow(/holds '\$\{' at description/);
  });

  it("collects every finding, one per line", () => {
    const docs: ToolboxDoc[] = [
      { kind: "source", name: "a.b", type: "oracle" },
      sql("t", "SELECT 1", "missing"),
      toolsetDoc("set", ["t", "ghost"]),
      { kind: "prompt", name: "p" },
      { kind: "authService", name: "g", type: "generic", mcpEnabled: true },
    ];
    let caught: unknown = null;
    try {
      validateDocs(docs);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HostError);
    expect((caught as HostError).status).toBe(400);
    const lines = (caught as HostError).message.split("\n");
    for (const expected of [
      "'a.b' is not a name",
      "no source for: 'oracle'",
      "is used by no tool",
      "names the source 'missing'",
      "has no description",
      "names 'ghost'",
      "does not take: 'prompt'",
      "has no 'audience'",
      "switched on for the whole endpoint",
    ]) {
      expect(lines).toContainEqual(expect.stringContaining(expected));
    }
  });

  it("refuses a key the runtime would refuse, and two documents of one name", () => {
    const docs = server();
    docs.push({ ...toolsetDoc("sis", ["get_student"]), write: true });
    expect(() => validateDocs(docs)).toThrow(/two toolsets are named 'sis'/);
    expect(() => validateDocs(docs)).toThrow(/key the runtime refuses: write/);
  });
});

describe("the file", () => {
  it("renders a comment, the documents in key order, and the mark last", () => {
    const { yaml, mark, id } = renderConfig(server(), "sis-eu · revision 3");
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(mark).toBe(MARK + id);
    expect(yaml.split("\n")[0]).toBe("# generated · sis-eu · revision 3 · do not edit by hand");
    expect(yaml).toContain("kind: source\nname: sis\ntype: postgres\n");
    expect(yaml).toContain('password: "${SIS_DB_PASSWORD}"');
    expect(yaml.endsWith(`---\nkind: toolset\nname: ${mark}\ntools: []\n`)).toBe(true);
  });

  it("gives equal documents the same mark and changed ones another", () => {
    const a = renderConfig(server(), "t");
    expect(renderConfig(server(), "t").mark).toBe(a.mark);
    expect(renderConfig(server("SELECT 2"), "t").mark).not.toBe(a.mark);
    expect(renderConfig(server(), "u").mark).not.toBe(a.mark);
  });

  it("gives two owners of one text different marks, and prints neither", () => {
    const a = renderConfig(server(), "t", "acme");
    const b = renderConfig(server(), "t", "beta");
    expect(b.mark).not.toBe(a.mark);
    expect(a.yaml.replace(a.mark, "")).toBe(b.yaml.replace(b.mark, ""));
    expect(a.yaml).not.toContain("acme");
  });

  it("reads back what it wrote", () => {
    const docs = server();
    const parsed = parseConfig(renderConfig(docs, "t").yaml);
    expect(parsed.slice(0, -1)).toEqual(docs);
    expect(members(parsed)).toEqual({
      sis: ["get_student"],
      "sis-raw": ["sis-raw_execute_sql", "sis-raw_list_tables"],
    });
  });

  it("refuses text that is not such a file, and a title that would break it", () => {
    expect(() => parseConfig("- a\n- b\n")).toThrow(/not a mapping/);
    expect(() => parseConfig("kind: [\n")).toThrow(/not YAML/);
    expect(() => renderConfig([], "a\nb")).toThrow(/one plain line/);
    expect(() => renderConfig([], "${HOME}")).toThrow(/one plain line/);
  });
});

describe("building documents", () => {
  it("serves the four engines it proved, and nothing else", () => {
    expect(dialectOf("postgresql")?.placeholder(2)).toBe("$2");
    expect(dialectOf("postgres")?.sqlTool).toBe("postgres-sql");
    expect(dialectOf("mysql")?.placeholder(2)).toBe("?");
    expect(dialectOf("clickhouse")?.executeTool).toBe("clickhouse-execute-sql");
    expect(dialectOf("snowflake")?.placeholder(2)).toBe(":2");
    expect(dialectOf("postgres")?.quote('a"b')).toBe('"a""b"');
    expect(dialectOf("mysql")?.quote("a`b")).toBe("`a``b`");
  });

  it.each(["trino", "databricks", "heavydb", "kyuubi", "toString"])("serves no %s", (engine) => {
    expect(dialectOf(engine)).toBeNull();
  });

  it("makes a source per engine, its password a reference", () => {
    expect(sourceDoc("sis", pg(), "SIS_DB_PASSWORD")).toEqual({
      kind: "source",
      name: "sis",
      type: "postgres",
      host: "db.example.edu",
      port: "5432",
      database: "sis",
      user: "reader",
      password: "${SIS_DB_PASSWORD}",
    });
    const ch = sourceDoc(
      "events",
      { type: "clickhouse", host: "ch.example.edu", port: "8443", database: "events" },
      "EVENTS_DB_PASSWORD",
    );
    expect(ch).toMatchObject({ type: "clickhouse", user: "default", protocol: "https" });
    const sf = sourceDoc(
      "dw",
      {
        type: "snowflake",
        account: "acme",
        warehouse: "WH",
        user: "u",
        database: "DW",
        schemas: ["S"],
      },
      "DW_DB_PASSWORD",
    );
    expect(sf).toMatchObject({ type: "snowflake", schema: "S", warehouse: "WH" });
    const trino: AoConnectionConfig = { type: "trino", host: "t", user: "u", database: "d" };
    expect(() => sourceDoc("t", trino, "T_DB_PASSWORD")).toThrow(/no source for trino/);
    expect(() => sourceDoc("sis", pg(), "sis password")).toThrow(/not an env name/);
  });

  it("keeps parameters in order, a default making one optional", () => {
    const doc = sqlToolDoc({
      name: "list_students",
      source: "sis",
      dialect: dialectOf("postgres")!,
      description: "Students.",
      statement: "SELECT * FROM students WHERE term = $1 LIMIT $2",
      parameters: [
        { name: "term", type: "string", description: "Term." },
        { name: "limit", type: "integer", description: "Rows.", default: 100 },
      ],
    });
    expect(doc.parameters).toEqual([
      { name: "term", type: "string", description: "Term." },
      { name: "limit", type: "integer", description: "Rows.", default: 100 },
    ]);
  });

  it("writes auth services the MCP endpoint does not use", () => {
    const docs = authDocs({
      platform: true,
      entra: { tenant: "contoso.onmicrosoft.com", audience: "api://ontology" },
      google: { audience: "123.apps.googleusercontent.com" },
      oidc: { issuer: "https://id.example.edu", audience: "ontology" },
    });
    expect(docs).toEqual([
      {
        kind: "authService",
        name: "entra",
        type: "generic",
        audience: "api://ontology",
        authorizationServer: "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0",
        mcpEnabled: false,
      },
      {
        kind: "authService",
        name: "google",
        type: "google",
        clientId: "123.apps.googleusercontent.com",
      },
      {
        kind: "authService",
        name: "oidc",
        type: "generic",
        audience: "ontology",
        authorizationServer: "https://id.example.edu",
        mcpEnabled: false,
      },
    ]);
    expect(authDocs({ platform: true })).toEqual([]);
  });

  it("names the option it cannot write", () => {
    const oidc = (issuer: string) => authDocs({ platform: false, oidc: { issuer, audience: "a" } });
    expect(() => oidc("http://id.example.edu")).toThrow(/^OIDC: the issuer/);
    expect(() => oidc("${ISSUER}")).toThrow(/^OIDC/);
    expect(() => authDocs({ platform: false, google: { audience: "" } })).toThrow(/^Google/);
    expect(() => authDocs({ platform: false, entra: { tenant: "a/b", audience: "x" } })).toThrow(
      /^Microsoft Entra/,
    );
  });
});
