import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendFor, forgetBackends, isPublicAddress } from "./backend";

// One resolver for every copy of the module, a re-imported one included.
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => dns);

const fetchMock = vi.fn<typeof fetch>();
const resolves = (...addresses: string[]) =>
  dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })));
/** The platform's record, as the DM returns one. */
const record = (url: unknown) => Response.json({ key: "default", data: { url } });
const answers = (make: () => Response) => fetchMock.mockImplementation(async () => make());

beforeEach(() => {
  forgetBackends();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  dns.lookup.mockReset();
  resolves("93.184.216.34");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backendFor", () => {
  it("reads the platform's record with the caller's own token, once a minute per token", async () => {
    answers(() => record("https://ontology.acme.edu/"));
    expect(await backendFor("Token jane")).toEqual({ url: "https://ontology.acme.edu" });
    expect(await backendFor("Token jane")).toEqual({ url: "https://ontology.acme.edu" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/ontology\/kinds\/backend\/records\/default$/);
    expect(init).toMatchObject({ headers: { authorization: "Token jane" }, redirect: "manual" });

    // Another token is another platform's question.
    await backendFor("Token john");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says why there is no backend, and keeps a refusal as it keeps an address", async () => {
    const refusals = [
      [404, "no_backend"],
      [403, "not_admin"],
      [401, "not_signed_in"],
    ] as const;
    for (const [status, error] of refusals) {
      answers(() => new Response("{}", { status }));
      expect(await backendFor(`Token ${status}`)).toEqual({ status, error });
      expect(await backendFor(`Token ${status}`)).toEqual({ status, error });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(await backendFor(null)).toEqual({ status: 401, error: "not_signed_in" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("asks again when the platform could not be asked", async () => {
    answers(() => new Response("down", { status: 503 }));
    expect(await backendFor("Token jane")).toMatchObject({ status: 502 });
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await backendFor("Token jane")).toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses an address a user's token must not be sent to", async () => {
    const bad = { status: 404, error: "bad_backend" };
    const addresses = [
      "http://ontology.acme.edu",
      "https://user:pw@ontology.acme.edu",
      "ftp://ontology.acme.edu",
      "not a url",
      42,
      undefined,
    ];
    for (const [n, address] of addresses.entries()) {
      answers(() => record(address));
      expect(await backendFor(`Token ${n}`), String(address)).toEqual(bad);
    }

    // A name that resolves into a private network, even in part, or does not resolve.
    answers(() => record("https://internal.acme.edu"));
    resolves("93.184.216.34", "10.0.0.7");
    expect(await backendFor("Token private")).toEqual(bad);
    dns.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await backendFor("Token unknown")).toEqual(bad);
  });

  it("takes a developer's localhost, outside production only", async () => {
    answers(() => record("http://localhost:8000"));
    expect(await backendFor("Token dev")).toEqual({ url: "http://localhost:8000" });
    vi.stubEnv("NODE_ENV", "production");
    expect(await backendFor("Token prod")).toEqual({ status: 404, error: "bad_backend" });
  });
});

describe("isPublicAddress", () => {
  it("is false for loopback, private, link-local and multicast addresses", () => {
    const refused = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:a00:1",
    ];
    for (const address of refused) expect(isPublicAddress(address), address).toBe(false);
    const allowed = [
      "93.184.216.34",
      "172.32.0.1",
      "100.128.0.1",
      "2606:2800:220:1:248:1893:25c8:1946",
      "::ffff:93.184.216.34",
    ];
    for (const address of allowed) expect(isPublicAddress(address), address).toBe(true);
  });
});

describe("the route in hosted mode", () => {
  it("sends each caller to their own platform's backend, or relays why not", async () => {
    vi.stubEnv("ONTOLOGY_MULTI_PLATFORM", "true");
    vi.stubEnv("ONTOLOGY_API_URL", "");
    vi.resetModules();
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/ontology/[...path]/route");
    const call = (path: string, headers: Record<string, string> = {}) =>
      GET(new NextRequest(`http://console.test/api/ontology/${path}`, { headers }));

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const sent = new Headers(init?.headers);
      const token = sent.get("authorization");
      if (url.endsWith("/records/default"))
        return token === "Token jane"
          ? record("https://ontology.acme.edu")
          : new Response("{}", { status: 404 });
      if (url.endsWith("/config")) {
        const files = [{ id: "tools", content: "password: hunter2\n", modified_at: null }];
        return Response.json({ root: "/app/config", files });
      }
      return Response.json({ url, token, jwt: sent.get("x-edx-jwt"), redirect: init?.redirect });
    });

    // The DM token goes on; the edX JWT stays in the browser.
    const jane = { authorization: "Token jane", "x-edx-jwt": "a-jwt" };
    expect(await (await call("roles?x=1", jane)).json()).toEqual({
      url: "https://ontology.acme.edu/roles?x=1",
      token: "Token jane",
      jwt: null,
      redirect: "manual",
    });
    // The backend's files, summarised and masked a second time here.
    const snapshot = await (await call("config", jane)).json();
    expect(snapshot.root).toBe("/app/config");
    expect(snapshot.files.map((f: { id: string }) => f.id)).toEqual(["tools"]);
    expect(snapshot.files[0].content).toBe("password: ••••••••\n");

    const none = await call("roles", { authorization: "Token john" });
    expect([none.status, await none.json()]).toEqual([404, { error: "no_backend" }]);
    expect((await call("roles")).status).toBe(401);
  });
});
