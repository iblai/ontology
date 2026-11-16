import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "./dm";
import { assertServes, pending, serves, setUp } from "./setup";

const CODE = "0123456789abcdef0123456789abcdef";
const caller = (platform: string, admin = true) => ({ platform, admin }) as Caller;

describe("a server installed from a link", () => {
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ontology-setup-"));
    vi.stubEnv("ONTOLOGY_HOME", home);
    vi.stubEnv("ONTOLOGY_SETUP_CODE", CODE);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it("serves no platform until it is set up, and says where the link is", async () => {
    expect(await pending()).toBe(true);
    await expect(assertServes("acme")).rejects.toMatchObject({ status: 503 });
    await expect(assertServes("acme")).rejects.toThrow(/open the link its installer printed/);
    // The first platform to ask does not take it: only the code does.
    await expect(serves("acme")).rejects.toMatchObject({ status: 503 });
    expect(await pending()).toBe(true);
  });

  it("is claimed by an administrator who holds the code", async () => {
    await expect(setUp("0".repeat(32), caller("acme"))).rejects.toMatchObject({ status: 403 });
    await expect(setUp("", caller("acme"))).rejects.toMatchObject({ status: 403 });
    await expect(setUp(CODE, caller("acme", false))).rejects.toThrow(/Only an administrator/);
    expect(await pending()).toBe(true);

    expect(await setUp(CODE, caller("acme"))).toBe("acme");
    expect(await readFile(path.join(home, "engine-platform"), "utf8")).toBe("acme\n");
    expect(await pending()).toBe(false);
    await expect(assertServes("acme")).resolves.toBeUndefined();
    expect(await serves("acme")).toBe("acme");
  });

  it("stays that platform's: asking again changes nothing, another is refused", async () => {
    await setUp(CODE, caller("acme"));
    // The platform that holds it needs no code to hear so.
    expect(await setUp("", caller("acme"))).toBe("acme");
    await expect(setUp(CODE, caller("beta"))).rejects.toMatchObject({ status: 409 });
    await expect(assertServes("beta")).rejects.toMatchObject({ status: 403 });
    const refused = await assertServes("beta").catch((error: Error) => error.message);
    expect(refused).not.toMatch(/acme/);
  });

  it("serves any platform with no code set, as a host run by hand does", async () => {
    vi.stubEnv("ONTOLOGY_SETUP_CODE", "");
    expect(await pending()).toBe(false);
    await expect(assertServes("acme")).resolves.toBeUndefined();
    await expect(setUp(CODE, caller("acme"))).rejects.toMatchObject({ status: 404 });
    expect(await serves("acme")).toBe("acme");
    expect(await serves("beta")).toBe("acme");
  });

  it("refuses a claim file that names no platform", async () => {
    await writeFile(path.join(home, "engine-platform"), "\n");
    await expect(assertServes("acme")).rejects.toThrow(/names no platform/);
  });
});
