import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aoAllowed, connectionOf } from "./ao";
import { engine } from "./engine";
import { inPlatform } from "./platform";

const id = "3f2a9c1e-0b7d-4e5f-9a1b-2c3d4e5f6a7b";

describe("engine", () => {
  let home = "";
  const before = { ...process.env };

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ontology-home-"));
    Object.assign(process.env, { ONTOLOGY_HOME: home, AO_URL: "http://ao.test/", AO_API_KEY: "k" });
  });

  afterAll(async () => {
    for (const name of ["ONTOLOGY_HOME", "AO_URL", "AO_API_KEY"]) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    await rm(home, { recursive: true, force: true });
  });

  it("gives the host's engine to the first platform and refuses it to a second", async () => {
    expect(await inPlatform("acme", engine)).toEqual({ url: "http://ao.test", key: "k" });
    expect(await readFile(path.join(home, "engine-platform"), "utf8")).toBe("acme\n");
    expect(await inPlatform("acme", engine)).toEqual({ url: "http://ao.test", key: "k" });
    const refused = await inPlatform("beta", engine).catch((error: Error) => error.message);
    expect(refused).toMatch(/serves another platform.*platforms\/beta\/engine\.json/);
    expect(refused).not.toMatch(/acme/);
  });

  it("gives a platform with an engine.json its own, and names what is wrong in one", async () => {
    const file = path.join(home, "platforms", "~41~cme", "engine.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ url: "http://acme.test//", key: "own" }));
    expect(await inPlatform("Acme", engine)).toEqual({ url: "http://acme.test", key: "own" });
    await writeFile(file, JSON.stringify({ url: "http://acme.test", key: "" }));
    await expect(inPlatform("Acme", engine)).rejects.toThrow(/engine\.json holds no “key”/);
    await writeFile(file, '{"url": "x", "key": "sec');
    await expect(inPlatform("Acme", engine)).rejects.toThrow(
      /^platforms\/~41~cme\/engine\.json is not JSON\.$/,
    );
  });
});

describe("aoAllowed", () => {
  it.each([
    ["GET", `/columns/${id}`],
    ["GET", `/terms/${id}`],
    ["GET", `/terms/${id}/column-attributes`],
    ["GET", `/terms/${id}/sql-attributes`],
    ["GET", `/exploration/tables/${id}/details`],
    ["GET", `/exploration/terms/${id}/details`],
    ["GET", "/configurations/semantic-compilation"],
    ["GET", "/configurations/pii-detection"],
    ["GET", "/configurations/distinct-value-probing"],
    ["GET", "/semantic-compilation/status"],
    ["GET", "/tags"],
    ["PATCH", `/terms/${id}`],
    ["PATCH", `/terms/${id}/column-attributes/${id}`],
    ["PATCH", `/sql-attributes/${id}`],
    ["PUT", "/configurations/semantic-compilation"],
    ["PUT", "/configurations/pii-detection"],
    ["PUT", "/configurations/distinct-value-probing"],
    ["POST", "/model/export"],
  ])("lets %s %s through", (method, path) => {
    expect(aoAllowed(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/connections"],
    ["POST", "/connections"],
    ["POST", "/connections/test"],
    ["GET", "/api-tokens"],
    ["POST", "/api-tokens"],
    ["GET", `/terms/../connections`],
    ["GET", `/terms/${id}/../../connections`],
    ["GET", "/terms/a/b"],
    ["GET", "/terms/a%2Fb"],
    ["GET", `/terms/${"a".repeat(65)}`],
    ["DELETE", `/terms/${id}`],
    ["PUT", `/terms/${id}`],
    ["POST", "/tags"],
    ["GET", "/model/export"],
    ["PATCH", "/configurations/pii-detection"],
    ["GET", "/configurations/sql-query-timeout"],
    ["GET", "/datasources/dbs"],
    ["GET", "/tags/"],
    ["GET", "tags"],
    ["get", "/tags"],
    ["constructor", "/tags"],
  ])("refuses %s %s", (method, path) => {
    expect(aoAllowed(method, path)).toBe(false);
  });
});

const input = (url: string, scope: string[] = []) => ({ url, scope, pii: true, probing: false });

describe("connectionOf", () => {
  it("reads a postgres URL, decoding the login, and never shows the password", () => {
    const found = connectionOf(input("postgres://ana%40x:p%3Ass@db.edu:5433/sis?sslmode=require"));
    expect(found.connection).toEqual({
      type: "postgresql",
      host: "db.edu",
      user: "ana@x",
      port: "5433",
      database: "sis",
      password: "p:ss",
    });
    expect(found.url).toBe("postgres://ana%40x@db.edu:5433/sis");
    expect(found.url).not.toContain("p%3Ass");
  });

  it("takes snowflake's account from the host and the warehouse from the query", () => {
    const { connection } = connectionOf(
      input("snowflake://u:p@xy123.us-east-1/SALES?warehouse=WH"),
    );
    expect(connection).toMatchObject({
      type: "snowflake",
      account: "xy123.us-east-1",
      warehouse: "WH",
    });
  });

  it("turns SCHEMA.TABLE entries into schemas and an escaped table pattern", () => {
    const { connection } = connectionOf(
      input("mysql://u:p@h/db", ["crm.deals", "crm.a.b", "ops.x+y"]),
    );
    expect(connection.schemas).toEqual(["crm", "ops"]);
    expect(connection.table_allow_regex).toBe("^(?:deals|a\\.b|x\\+y)$");
  });

  it.each<[string, string[]]>([
    ["not a url", []],
    ["oracle://u:p@h/db", []],
    ["postgres://u@h/db", []],
    ["postgres://u:p@h/", []],
    ["snowflake://u:p@acct/db", []],
    ["postgres://u:p@h/db", ["crm", "ops.x"]],
    ["postgres://u:p@h/db", ["crm."]],
  ])("refuses %s %j with a 400", (url, scope) => {
    let status: number | undefined;
    try {
      connectionOf(input(url, scope));
    } catch (error) {
      status = (error as { status?: number }).status;
    }
    expect(status).toBe(400);
  });
});
