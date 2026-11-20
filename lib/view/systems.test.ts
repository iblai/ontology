import { describe, expect, it } from "vitest";
import type { HostSystem, HostToolset } from "@/lib/host/types";
import { engineKind } from "./catalog";
import { apiRow, prebuiltRows, systemRow, withScheme } from "./systems";

const sis: HostSystem = {
  name: "sis",
  label: "sis",
  engine: "postgresql",
  url: "postgresql://ro@db:5432/sis",
  tables: 42,
  scoped: false,
  piiColumns: 2,
  terms: 9,
  status: "ingested",
  serve: true,
};

describe("systemRow", () => {
  it("keys by name and takes the engine's catalog name, abbreviation and colour", () => {
    const r = systemRow(sis);
    expect(r).toMatchObject({ key: "sis", engine: "PostgreSQL", abbr: "PG", color: "#336791" });
    expect(r.detail).toBe("42 tables · 2 PII columns");
    expect(r.dissect).toBe(true);
  });

  it("reads like the mock, with — where a number is unknown", () => {
    expect(systemRow({ ...sis, scoped: true, tables: 3 }).detail).toBe("3 tables scoped");
    expect(systemRow({ ...sis, piiColumns: 0, tables: 3 }).detail).toBe("3 tables");
    expect(systemRow({ ...sis, tables: null, piiColumns: null }).detail).toBe(
      "— tables · — PII columns",
    );
  });

  it("greys an engine the catalog does not know", () => {
    expect(engineKind("heavydb")).toEqual({ name: "heavydb", abbr: "He", color: "#9ca3af" });
  });
});

describe("apiRow and prebuiltRows", () => {
  it("counts endpoints and labels each raw toolset", () => {
    expect(
      apiRow({ name: "slate", baseUrl: "https://x", authHeader: "", endpoints: [], tools: 2 }),
    ).toEqual({ name: "slate", baseUrl: "https://x", endpoints: 0, tools: 2 });
    const toolsets: HostToolset[] = [
      { name: "sis-raw", summary: "", tools: [], defaultOn: false, kind: "raw" },
      { name: "advising", summary: "", tools: [], defaultOn: true, kind: "terms" },
    ];
    expect(prebuiltRows(toolsets, [sis])).toEqual([
      { toolset: "sis-raw", label: "sis · postgresql · execute_sql, list_tables" },
    ]);
  });
});

describe("a system's label", () => {
  it("is what the row and the prebuilt list show, while the key stays the database's name", () => {
    const named = { ...sis, label: "Student records" };
    expect(systemRow(named)).toMatchObject({ key: "sis", name: "Student records" });
    const [raw] = prebuiltRows(
      [{ name: "sis-raw", summary: "", tools: [], defaultOn: false, kind: "raw" }],
      [named],
    );
    expect(raw).toEqual({
      toolset: "sis-raw",
      label: "Student records · postgresql · execute_sql, list_tables",
    });
  });
});

describe("withScheme", () => {
  it("swaps a database scheme and keeps what was typed after it", () => {
    expect(withScheme("mysql://u:p@h/db", "postgresql://")).toBe("postgresql://u:p@h/db");
    expect(withScheme("", "trino://")).toBe("trino://");
    expect(withScheme("u@h/db", "mysql://")).toBe("mysql://u@h/db");
  });

  it("keeps nothing to or from local://", () => {
    expect(withScheme("mysql://u:p@h/db", "local://")).toBe("local://");
    expect(withScheme("local:///srv/data", "postgresql://")).toBe("postgresql://");
  });

  it("leaves a URL already under the scheme as it is", () => {
    expect(withScheme("local:///srv/data", "local://")).toBe("local:///srv/data");
    expect(withScheme("mysql://u@h/db", "mysql://")).toBe("mysql://u@h/db");
  });
});
