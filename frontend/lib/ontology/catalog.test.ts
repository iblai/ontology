import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import {
  CONNECTABLE,
  connectable,
  portDigits,
  systemName,
  twentyAddress,
  validPort,
} from "./connectable";

// The backend's catalog, when this console sits in the ontology repository beside it.
const SOURCE = fileURLToPath(
  new URL("../../../src/iblai_ontology/catalog/catalog.yaml", import.meta.url),
);

describe("the console's copy of the catalog", () => {
  it.skipIf(!existsSync(SOURCE))("holds the backend's entries, no more and no fewer", () => {
    const entries: Record<string, { adapter: string; type: string; domain?: string }> = parse(
      readFileSync(SOURCE, "utf8"),
    ).entries;
    expect(CATALOG.map((c) => c.key).sort()).toEqual(Object.keys(entries).sort());
    // What the console decides by: the adapter it would send, the type and the domain.
    for (const c of CATALOG) {
      const theirs = entries[c.key];
      expect([c.key, c.adapter, c.type, c.domain]).toEqual([
        c.key,
        theirs.adapter,
        theirs.type,
        theirs.domain ?? "higher-ed",
      ]);
    }
  });

  it("has one entry a key", () => {
    expect(new Set(CATALOG.map((c) => c.key)).size).toBe(CATALOG.length);
  });
});

describe("what connects from here", () => {
  it("is Twenty and the nine database engines, each named once", () => {
    expect(CONNECTABLE.filter((c) => c.kind === "twenty").map((c) => c.key)).toEqual(["twenty"]);
    expect(CONNECTABLE.filter((c) => c.kind === "database")).toHaveLength(9);
    expect(new Set(CONNECTABLE.map((c) => c.key)).size).toBe(CONNECTABLE.length);
    // Only an engine whose databases the backend can list offers them.
    expect(CONNECTABLE.filter((c) => c.lookup).map((c) => c.adapter)).toEqual([
      "generic-postgres",
      "generic-mysql",
    ]);
  });

  it("finds a catalog entry's connector by its adapter, never by a shared name", () => {
    const by = (key: string) => connectable(CATALOG.find((c) => c.key === key)?.adapter)?.key;
    expect([by("twenty"), by("peoplesoft"), by("snowflake")]).toEqual([
      "twenty",
      "peoplesoft",
      "snowflake",
    ]);
    // The catalog's `banner` is Banner's REST API; the engine of that name is its Oracle database.
    expect(by("banner")).toBeUndefined();
    expect(by("canvas")).toBeUndefined();
    expect(connectable("banner")?.label).toBe("Banner (Oracle)");
    expect(connectable(null)).toBeUndefined();
  });
});

describe("what the form lets through", () => {
  it("keeps a port to digits, five at most, and knows which a server can listen on", () => {
    expect(portDigits("54a3 2x")).toBe("5432");
    expect(portDigits("1234567")).toBe("12345");
    expect(["1", "5432", "65535"].every(validPort)).toBe(true);
    expect(["", "0", "65536", "99999", "5 432", "-1"].some(validPort)).toBe(false);
  });

  it("makes a name of lowercase letters, digits and hyphens", () => {
    expect(systemName("Sales CRM (EU)")).toBe("sales-crm-eu-");
    expect(systemName("--crm_2")).toBe("crm-2");
    expect(systemName("x".repeat(80))).toHaveLength(63);
  });

  it("takes a Twenty address over https, or over http on this machine only", () => {
    expect(["https://crm.acme.edu", "http://localhost:3000", "http://127.0.0.1:3000"]).toSatisfy(
      (all: string[]) => all.every(twentyAddress),
    );
    expect(["http://crm.acme.edu", "crm.acme.edu", "ftp://crm.acme.edu", ""]).toSatisfy(
      (all: string[]) => !all.some(twentyAddress),
    );
  });
});
