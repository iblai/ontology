import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertName,
  assertSlug,
  envName,
  homePath,
  hostPath,
  readEnv,
  readLabels,
  readText,
  runtimeEnv,
  setEnv,
  setLabel,
  slugOf,
  writeAtomic,
} from "./files";
import { inPlatform } from "./platform";

describe("names", () => {
  it("takes a slug", () => {
    expect(assertSlug("sis-eu")).toBe("sis-eu");
    expect(assertSlug("9lives")).toBe("9lives");
  });

  it.each(["", "-a", "Sis", "a_b", "a.b", "a".repeat(64), "../x"])(
    "refuses the bad slug %j",
    (bad) => {
      expect(() => assertSlug(bad)).toThrow(/server’s name/);
    },
  );

  it.each(["new", "preview"])("refuses %j, a name a console route takes", (taken) => {
    expect(() => assertSlug(taken)).toThrow(/console itself uses/);
  });

  it("takes a page's name, which no longer shadows it", () => {
    expect(assertSlug("mcp")).toBe("mcp");
    expect(assertSlug("systems")).toBe("systems");
  });

  it("takes an API name that starts with a letter", () => {
    expect(assertName("stripe-v2")).toBe("stripe-v2");
    expect(() => assertName("2stripe")).toThrow(/API’s name/);
  });

  it("makes a slug of any name", () => {
    expect(slugOf("SIS EU (prod)")).toBe("sis-eu-prod");
    expect(slugOf("--a__b--")).toBe("a-b");
    expect(() => slugOf("!!!")).toThrow(/no letter or digit/);
  });

  it("makes an env name", () => {
    expect(envName("sis-eu", "DB_PASSWORD")).toBe("SIS_EU_DB_PASSWORD");
    expect(envName("crm.v2", "API_KEY")).toBe("CRM_V2_API_KEY");
    expect(envName("canvas", "OAUTH_CLIENT_SECRET")).toBe("CANVAS_OAUTH_CLIENT_SECRET");
  });

  it("leaves the OAuth secrets out of the runtime’s share of the env", () => {
    const env = {
      SIS_DB_PASSWORD: "p",
      CRM_API_KEY: "k",
      CANVAS_OAUTH_CLIENT_SECRET: "s",
      CANVAS_OAUTH_REFRESH_TOKEN: "r",
      OAUTH_REFRESH_TOKEN_DB_PASSWORD: "q",
    };
    expect(runtimeEnv(env)).toEqual({
      SIS_DB_PASSWORD: "p",
      CRM_API_KEY: "k",
      OAUTH_REFRESH_TOKEN_DB_PASSWORD: "q",
    });
  });
});

describe("files under ONTOLOGY_HOME", () => {
  let home = "";
  const before = process.env.ONTOLOGY_HOME;

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "ontology-home-"));
    process.env.ONTOLOGY_HOME = home;
  });

  afterAll(async () => {
    if (before === undefined) delete process.env.ONTOLOGY_HOME;
    else process.env.ONTOLOGY_HOME = before;
    await rm(home, { recursive: true, force: true });
  });

  it("keeps a path inside the platform's folder and refuses one that leaves it", () =>
    inPlatform("acme", () => {
      const acme = path.join(home, "platforms", "acme");
      expect(homePath("servers", "sis", "tools.yaml")).toBe(
        path.join(acme, "servers", "sis", "tools.yaml"),
      );
      expect(homePath()).toBe(acme);
      expect(() => homePath("..", "beta", "env")).toThrow(/leaves the platform’s folder/);
      expect(() => homePath("servers", "../../beta")).toThrow(/leaves/);
      expect(() => homePath("/etc/passwd")).toThrow(/leaves/);
      expect(() => homePath(`${acme}-other`)).toThrow(/leaves/);
    }));

  it("gives each platform its own folder, a key and its uppercase twin too", () => {
    const folder = (key: string) => inPlatform(key, () => homePath());
    expect(folder("acme")).not.toBe(folder("beta"));
    expect(folder("Acme")).toBe(path.join(home, "platforms", "~41~cme"));
    expect(folder("Acme").toLowerCase()).not.toBe(folder("acme").toLowerCase());
    expect(folder("a.b")).toBe(path.join(home, "platforms", "a~2e~b"));
  });

  it("refuses a platform's path outside a platform, and keeps hostPath host-wide", () => {
    expect(() => homePath("env")).toThrow(/for no platform/);
    expect(hostPath("engine-key")).toBe(path.join(home, "engine-key"));
    expect(() => hostPath("..", "x")).toThrow(/leaves the host’s folder/);
  });

  it("writes atomically and reads back, null for no file", () =>
    inPlatform("acme", async () => {
      const file = homePath("servers", "sis", "flags.json");
      expect(await readText(file)).toBeNull();
      await writeAtomic(file, "{}");
      expect(await readText(file)).toBe("{}");
    }));

  it("round-trips the env at 0600, keeping the other values, per platform", () =>
    inPlatform("acme", async () => {
      expect(await readEnv()).toEqual({});
      await setEnv("SIS_DB_PASSWORD", "p=a ss#1 ");
      await Promise.all([setEnv("CRM_API_KEY", "k"), setEnv("B", "2")]);
      await setEnv("B", "3");
      expect(await readEnv()).toEqual({ SIS_DB_PASSWORD: "p=a ss#1 ", CRM_API_KEY: "k", B: "3" });
      expect((await stat(homePath("env"))).mode & 0o777).toBe(0o600);
      expect(await inPlatform("beta", readEnv)).toEqual({});
    }));

  it("writes one secret over another only while that one is still there", () =>
    inPlatform("acme", async () => {
      await setEnv("X_OAUTH_REFRESH_TOKEN", "first");
      await setEnv("X_OAUTH_REFRESH_TOKEN", "second", "first");
      expect((await readEnv()).X_OAUTH_REFRESH_TOKEN).toBe("second");
      // An admin saved "pasted" meanwhile: the one a request got back does not replace it.
      await setEnv("X_OAUTH_REFRESH_TOKEN", "pasted");
      await setEnv("X_OAUTH_REFRESH_TOKEN", "third", "second");
      expect((await readEnv()).X_OAUTH_REFRESH_TOKEN).toBe("pasted");
      await setEnv("Y_OAUTH_REFRESH_TOKEN", "new", "none-kept");
      expect((await readEnv()).Y_OAUTH_REFRESH_TOKEN).toBeUndefined();
    }));

  it("keeps what a platform calls its systems, and forgets a label taken back", () =>
    inPlatform("acme", async () => {
      expect(await readLabels()).toEqual({});
      await setLabel("default", "Twenty");
      await setLabel("sis", "sis"); // the name itself is no label
      expect(await readLabels()).toEqual({ default: "Twenty" });
      expect(await inPlatform("beta", readLabels)).toEqual({});
      await setLabel("default", "");
      expect(await readLabels()).toEqual({});
    }));

  it("refuses a bad env name or a value with a line break", () =>
    inPlatform("acme", async () => {
      await expect(setEnv("lower", "x")).rejects.toThrow(/not an env name/);
      await expect(setEnv("A", "x\ny")).rejects.toThrow(/line break/);
    }));
});
