import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAuthorization, platformGrants, resolveCaller, schemesFor } from "./dm";

describe("platformGrants", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks ibl.ai for each platform and never answers one with another's grants", async () => {
    // As the DM: grants for the token's own platform, a 403 for any other iblai-org.
    const denied = { detail: "iblai-org does not match the token's platform." };
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (_url, init) =>
      new Headers(init.headers).get("iblai-org") === "acme"
        ? Response.json({ "/platforms/acme/": { actions: ["*"] } })
        : Response.json(denied, { status: 403 }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(platformGrants("Token", "one", "acme")).resolves.toHaveProperty([
      "/platforms/acme/",
    ]);
    await expect(platformGrants("Token", "one", "beta")).rejects.toThrow(/does not match/);
    await expect(platformGrants("Token", "one", "acme")).resolves.toBeTruthy();
    await expect(platformGrants("Token", "one", "beta")).rejects.toThrow(/does not match/);
    expect(fetch.mock.calls.map(([, init]) => new Headers(init.headers).get("iblai-org"))).toEqual([
      "acme",
      "beta",
    ]);
  });

  it("refuses a call that names no platform before asking anyone", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    await expect(resolveCaller("Token one", "../acme")).rejects.toThrow(/platform’s key/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("resolveCaller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // As the DM answers a key made with Owner permissions: no ontology grant, and its owner.
  const ownedBy = (admin: boolean) =>
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string) => Promise<Response>>(async (url) => {
        if (url.includes("/rbac/permissions/")) return Response.json({});
        if (url.includes("/token/verify/")) return Response.json({ username: "ada", email: "" });
        return Response.json([{ username: "ada", key: "acme", active: true, is_admin: admin }]);
      }),
    );

  it("lends a platform admin’s own API key everything, with no grant", async () => {
    ownedBy(true);
    await expect(resolveCaller("Api-Token admin-key", "acme")).resolves.toMatchObject({
      subject: "ibl:ada",
      admin: true,
      scope: { everything: true, allToolsets: true, console: true },
    });
  });

  it("refuses the key of an owner who is no admin and holds no grant", async () => {
    ownedBy(false);
    await expect(resolveCaller("Api-Token member-key", "acme")).rejects.toThrow(
      /no ontology grant/,
    );
  });
});

describe("parseAuthorization", () => {
  it("takes the three schemes in any case", () => {
    expect(parseAuthorization("Token abc")).toEqual({ scheme: "Token", credential: "abc" });
    expect(parseAuthorization("api-token k1")).toEqual({ scheme: "Api-Token", credential: "k1" });
    expect(parseAuthorization("BEARER  x ")).toEqual({ scheme: "Bearer", credential: "x" });
  });

  it("refuses no header, no credential and any other scheme", () => {
    expect(parseAuthorization(null)).toBeNull();
    expect(parseAuthorization("")).toBeNull();
    expect(parseAuthorization("Token")).toBeNull();
    expect(parseAuthorization("Token   ")).toBeNull();
    expect(parseAuthorization("Basic abc")).toBeNull();
    expect(parseAuthorization("constructor abc")).toBeNull();
    expect(parseAuthorization(" Token abc")).toBeNull();
  });
});

describe("schemesFor", () => {
  it("tries Bearer as a token, then as an API key", () => {
    expect(schemesFor("Bearer")).toEqual(["Token", "Api-Token"]);
    expect(schemesFor("Token")).toEqual(["Token"]);
    expect(schemesFor("Api-Token")).toEqual(["Api-Token"]);
  });
});
