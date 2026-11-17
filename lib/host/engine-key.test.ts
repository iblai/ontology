import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dropEngineKey, engineKey } from "./engine-key";

const AO = "http://127.0.0.1:3100";
const PASSWORD = "hunter2-secret";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

describe("the server's own engine key", () => {
  let home = "";
  let calls: Call[] = [];
  const kept = () => path.join(home, "engine-key");

  // An engine that signs the admin in with two cookies, makes `token`, and signs out.
  const engine = (token: unknown = "auto_ontology_made", signIn = 200) => {
    calls = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      if (url.endsWith("/api/auth/sign-in/email")) {
        if (signIn !== 200) {
          const message = `Invalid email or password: ${PASSWORD}`;
          return Response.json({ message }, { status: signIn });
        }
        return new Response("{}", {
          headers: [
            ["set-cookie", "session=s1; Path=/; HttpOnly"],
            ["set-cookie", "data=d2; Path=/"],
          ],
        });
      }
      if (url.endsWith("/api/api-tokens"))
        return Response.json({ id: "1", token }, { status: 201 });
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ontology-key-"));
    await writeFile(path.join(home, "admin-password"), `${PASSWORD}\n`);
  });

  beforeEach(async () => {
    vi.stubEnv("ONTOLOGY_HOME", home);
    vi.stubEnv("AO_API_KEY", "");
    vi.stubEnv("AO_ADMIN_EMAIL", "admin@ontology.local");
    vi.stubEnv("AO_ADMIN_PASSWORD_FILE", path.join(home, "admin-password"));
    vi.stubEnv("AO_ORIGIN", "http://localhost:3100");
    await rm(kept(), { force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("uses the key it is given and asks the engine nothing", async () => {
    const fetch = engine();
    vi.stubEnv("AO_API_KEY", "given");
    expect(await engineKey(AO)).toBe("given");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs in with the origin the engine trusts, makes a key and keeps it to itself", async () => {
    engine();
    expect(await engineKey(AO)).toBe("auto_ontology_made");
    const [signIn, make, signOut] = calls;
    expect(signIn.url).toBe(`${AO}/api/auth/sign-in/email`);
    expect(signIn.headers.origin).toBe("http://localhost:3100");
    expect(signIn.body).toEqual({ email: "admin@ontology.local", password: PASSWORD });
    expect(make.url).toBe(`${AO}/api/api-tokens`);
    expect(make.headers).toMatchObject({
      cookie: "session=s1; data=d2",
      origin: "http://localhost:3100",
    });
    expect(make.body.name).toMatch(/^ontology-server \d{4}-/);
    expect(signOut.url).toBe(`${AO}/api/auth/sign-out`);
    expect(await readFile(kept(), "utf8")).toBe("auto_ontology_made\n");
    expect((await stat(kept())).mode & 0o777).toBe(0o600);
  });

  it("falls back to the engine's own address as the origin", async () => {
    engine();
    vi.stubEnv("AO_ORIGIN", "");
    await engineKey(AO);
    expect(calls[0].headers.origin).toBe(AO);
  });

  it("reads the kept key from then on", async () => {
    await writeFile(kept(), "auto_ontology_kept\n");
    const fetch = engine();
    expect(await engineKey(AO)).toBe("auto_ontology_kept");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes one key for calls that arrive together", async () => {
    const fetch = engine();
    const keys = await Promise.all([engineKey(AO), engineKey(AO), engineKey(AO)]);
    expect(new Set(keys)).toEqual(new Set(["auto_ontology_made"]));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("drops the kept key only when it is the one the engine refused", async () => {
    await writeFile(kept(), "auto_ontology_kept\n");
    await dropEngineKey("auto_ontology_other");
    expect(await readFile(kept(), "utf8")).toBe("auto_ontology_kept\n");
    await dropEngineKey("auto_ontology_kept");
    await expect(stat(kept())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("names the settings it lacks to make a key", async () => {
    const fetch = engine();
    vi.stubEnv("AO_ADMIN_EMAIL", "");
    await expect(engineKey(AO)).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(
        /AO_API_KEY is not set.*AO_ADMIN_EMAIL.*AO_ADMIN_PASSWORD_FILE/,
      ),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names a password file it cannot read", async () => {
    engine();
    vi.stubEnv("AO_ADMIN_PASSWORD_FILE", path.join(home, "missing"));
    await expect(engineKey(AO)).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/AO_ADMIN_PASSWORD_FILE names .*missing: ENOENT/),
    });
  });

  it("gives the engine's words for a refused sign-in, never the password", async () => {
    engine("auto_ontology_made", 401);
    const refused = await engineKey(AO).catch((error: Error) => error);
    expect(refused).toMatchObject({ status: 502 });
    expect((refused as Error).message).toMatch(
      /refused its admin’s sign-in \(401\): Invalid email/,
    );
    expect((refused as Error).message).toContain("AO_ORIGIN");
    expect((refused as Error).message).not.toContain(PASSWORD);
    await expect(stat(kept())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps nothing when the engine returns no key", async () => {
    engine(null);
    await expect(engineKey(AO)).rejects.toMatchObject({ status: 502 });
    await expect(stat(kept())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
