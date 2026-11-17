import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aoAllowed, aoFetch, connectionOf } from "./ao";
import { engine } from "./engine";
import { inPlatform } from "./platform";

const id = "3f2a9c1e-0b7d-4e5f-9a1b-2c3d4e5f6a7b";

describe("engine", () => {
  let home = "";
  // A platform's own engine file, by the folder its key is kept under.
  const own = async (folder: string, text: string) => {
    const file = path.join(home, "platforms", folder, "engine.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ontology-home-"));
  });

  // A server with an engine of its own, which is acme's.
  beforeEach(() => {
    vi.stubEnv("ONTOLOGY_HOME", home);
    vi.stubEnv("AO_URL", "http://ao.test/");
    vi.stubEnv("AO_API_KEY", "k");
    vi.stubEnv("ONTOLOGY_PLATFORM", "acme");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("gives the server's own engine to the platform it names, and to no other", async () => {
    expect(await inPlatform("acme", engine)).toEqual({ url: "http://ao.test", key: "k" });
    await expect(inPlatform("beta", engine)).rejects.toMatchObject({
      status: 403,
      message: "This server serves another platform.",
    });
  });

  it("answers 503 naming the setting when its own engine has no platform", async () => {
    vi.stubEnv("ONTOLOGY_PLATFORM", "");
    await expect(inPlatform("acme", engine)).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/^ONTOLOGY_PLATFORM is not set: .*AO_URL/),
    });
    vi.stubEnv("ONTOLOGY_PLATFORM", "not a key");
    await expect(inPlatform("acme", engine)).rejects.toMatchObject({ status: 503 });
  });

  it("tells a platform with no engine what the server's operator does", async () => {
    vi.stubEnv("AO_URL", "");
    vi.stubEnv("ONTOLOGY_PLATFORM", "");
    const refused = await inPlatform("beta", engine).catch((error: Error) => error);
    expect(refused).toMatchObject({ status: 503 });
    expect((refused as Error).message).toBe(
      "No engine is connected for “beta”. This server’s operator sets AO_URL, or writes " +
        "platforms/beta/engine.json.",
    );
  });

  it("gives a platform with an engine.json its own, and names what is wrong in one", async () => {
    vi.stubEnv("AO_URL", "");
    vi.stubEnv("ONTOLOGY_PLATFORM", "");
    await own("~41~cme", JSON.stringify({ url: "https://203.0.113.7//", key: "own" }));
    expect(await inPlatform("Acme", engine)).toEqual({ url: "https://203.0.113.7", key: "own" });
    await own("~41~cme", JSON.stringify({ url: "https://203.0.113.7", key: "" }));
    await expect(inPlatform("Acme", engine)).rejects.toThrow(/engine\.json holds no “key”/);
    await own("~41~cme", '{"url": "x", "key": "sec');
    await expect(inPlatform("Acme", engine)).rejects.toThrow(
      /^platforms\/~41~cme\/engine\.json is not JSON\.$/,
    );
    await own("~41~cme", JSON.stringify({ url: "not an address", key: "own" }));
    await expect(inPlatform("Acme", engine)).rejects.toThrow(/“url” that is not an address/);
  });

  it("lets the named platform's own engine.json win over the server's engine", async () => {
    await own("gamma", JSON.stringify({ url: "http://10.0.0.5:3100", key: "own" }));
    vi.stubEnv("ONTOLOGY_PLATFORM", "gamma");
    expect(await inPlatform("gamma", engine)).toEqual({ url: "http://10.0.0.5:3100", key: "own" });
  });

  it.each(["http://127.0.0.1:3100", "http://localhost:3100", "http://[::1]:3100"])(
    "refuses an engine.json that names this machine, %s",
    async (url) => {
      await own("delta", JSON.stringify({ url, key: "own" }));
      vi.stubEnv("AO_URL", "");
      vi.stubEnv("ONTOLOGY_PLATFORM", "");
      await expect(inPlatform("delta", engine)).rejects.toMatchObject({
        status: 503,
        message: expect.stringMatching(
          /^platforms\/delta\/engine\.json names an engine on this machine\..*AO_URL/,
        ),
      });
    },
  );

  it("drops the key it made when the engine no longer knows it, not on a missing permission", async () => {
    const kept = path.join(home, "engine-key");
    await writeFile(kept, "made\n");
    vi.stubEnv("AO_API_KEY", "");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );
    vi.stubGlobal("fetch", fetch);
    const forbidden = await inPlatform("acme", () => aoFetch("/connections"));
    expect(forbidden.status).toBe(403);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("x-api-key")).toBe("made");
    expect(await readFile(kept, "utf8")).toBe("made\n");
    fetch.mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const unknown = await inPlatform("acme", () => aoFetch("/connections"));
    expect(unknown.status).toBe(401);
    await expect(stat(kept)).rejects.toMatchObject({ code: "ENOENT" });
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
