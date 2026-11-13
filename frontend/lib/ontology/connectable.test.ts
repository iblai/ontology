import { describe, expect, it } from "vitest";
import {
  AUTO_ONTOLOGY,
  UNSYNCED,
  apiAddress,
  connectable,
  endpointName,
  headerName,
  holders,
  listed,
} from "./connectable";
import type { Service } from "./types";

describe("a custom API's form", () => {
  it("takes an address of a host and a path, over https or http", () => {
    for (const ok of [
      "https://api.acme.example/v1",
      "http://10.20.3.7:8080",
      " https://api.acme.example ",
    ])
      expect(apiAddress(ok), ok).toBe(true);
    // Where an address leads is the backend's to judge; its shape is judged here.
    for (const no of [
      "",
      "api.acme.example",
      "ftp://api.acme.example",
      "https://user:pw@api.acme.example",
      "https://api.acme.example/v1?key=1",
      "https://api.acme.example/v1#top",
    ])
      expect(apiAddress(no), no).toBe(false);
  });

  it("takes a header's name, slugs an endpoint's and splits a typed list", () => {
    expect(headerName("X-API-Key")).toBe(true);
    expect(headerName("X API Key")).toBe(false);
    expect(headerName("")).toBe(false);
    expect(endpointName("  List invoices! ")).toBe("list-invoices");
    expect(endpointName("---")).toBe("");
    expect(listed("status, limit  page")).toEqual(["status", "limit", "page"]);
    expect(listed("  ")).toEqual([]);
  });
});

describe("an Auto Ontology server", () => {
  it("connects by its adapter and is never synced", () => {
    expect(connectable(AUTO_ONTOLOGY)?.label).toBe("NVIDIA Auto Ontology");
    expect(connectable("auto-ontology")?.kind).toBe("terms");
    expect(UNSYNCED).toEqual(["http_api", "auto_ontology"]);
  });

  it("names the systems here that hold one of its databases, letter case aside", () => {
    const system = (name: string, adapter: string, database?: string) =>
      ({
        name,
        adapter,
        schema_manifest: database === undefined ? undefined : { database },
      }) as unknown as Service;
    const here = [
      system("campus", "generic-postgres", "Campus"),
      system("campus-copy", "generic-postgres", "campus"),
      system("warehouse", "snowflake", "ANALYTICS"),
      system("crm", "twenty_api"),
      // The server itself holds no database, whatever its own manifest says.
      system("terms", AUTO_ONTOLOGY, "analytics"),
    ];
    expect(holders(here, "analytics").map((s) => s.name)).toEqual(["warehouse"]);
    // Two systems hold it: nothing says which one is meant, so the page says both.
    expect(holders(here, "CAMPUS").map((s) => s.name)).toEqual(["campus", "campus-copy"]);
    expect(holders(here, "sales")).toEqual([]);
    // A system that names no database holds none, an unnamed one included.
    expect(holders(here, "")).toEqual([]);
  });
});
