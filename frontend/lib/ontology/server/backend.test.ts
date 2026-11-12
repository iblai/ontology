import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendFor, connectBackend, forgetBackends, isPublicAddress } from "./backend";

// One resolver for every copy of the module, a re-imported one included.
const dns = vi.hoisted(() => ({
  lookup: vi.fn<(host: string) => Promise<{ address: string; family: number }[]>>(),
}));
vi.mock("node:dns/promises", () => dns);

const fetchMock = vi.fn<typeof fetch>();
const resolves = (...addresses: string[]) =>
  dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })));
/** The platform's record, as the DM returns one. */
const record = (url: unknown) => Response.json({ key: "default", data: { url } });
const answers = (make: () => Response) => fetchMock.mockImplementation(async () => make());

type World = { record?: () => Response; put?: () => Response; counts?: () => Response };
/** The platform's record (none yet) and a backend of the platform `acme`, unless said otherwise. */
const world = (over: World = {}) =>
  fetchMock.mockImplementation(async (input, init) => {
    if (!String(input).endsWith("/records/default"))
      return over.counts?.() ?? Response.json({ services: 0, platform: "acme" });
    if (init?.method === "PUT") return over.put?.() ?? record("https://ontology.acme.edu");
    return over.record?.() ?? new Response("{}", { status: 404 });
  });

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

  it("says why there is no backend, and keeps a refused caller as it keeps an address", async () => {
    const refusals = [
      [403, "not_admin"],
      [401, "not_signed_in"],
    ] as const;
    for (const [status, error] of refusals) {
      answers(() => new Response("{}", { status }));
      expect(await backendFor(`Token ${status}`)).toEqual({ status, error });
      expect(await backendFor(`Token ${status}`)).toEqual({ status, error });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // "No backend yet" is asked again each time: connecting one ends it, whichever instance answers.
    answers(() => new Response("{}", { status: 404 }));
    expect(await backendFor("Token new")).toEqual({ status: 404, error: "no_backend" });
    expect(await backendFor("Token new")).toEqual({ status: 404, error: "no_backend" });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(await backendFor(null)).toEqual({ status: 401, error: "not_signed_in" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      const backend = await backendFor(`Token ${n}`);
      expect({ address, backend }).toEqual({ address, backend: bad });
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

describe("connectBackend", () => {
  const NEW = "https://ontology.acme.edu";

  it("keeps the address of a backend that answers as its platform's, and drops the kept lookup", async () => {
    let kept = "https://old.acme.edu";
    world({
      record: () => record(kept),
      put: () => {
        kept = NEW;
        return record(kept);
      },
    });
    expect(await backendFor("Token jane")).toEqual({ url: "https://old.acme.edu" });
    expect(await connectBackend("Token jane", ` ${NEW}/ `)).toEqual({ ok: true, url: NEW });

    // The backend is asked with the admin's own sign-in, and followed nowhere.
    const asked = fetchMock.mock.calls.find(([url]) => String(url) === `${NEW}/counts`);
    expect(asked?.[1]).toMatchObject({
      headers: { authorization: "Token jane" },
      redirect: "manual",
    });
    // The platform is told whose backend it is, in a body sent with its length.
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(String(put?.[0])).toMatch(/\/v1\/ontology\/kinds\/backend\/records\/default$/);
    expect(put?.[1]).toMatchObject({
      headers: { authorization: "Token jane", "iblai-org": "acme" },
      body: JSON.stringify({ data: { url: NEW }, unique_key: null }),
      redirect: "manual",
    });
    expect(await backendFor("Token jane")).toEqual({ url: NEW });
  });

  it("says in one sentence why a backend was not connected", async () => {
    const refused = (status: number, body: object) => () => Response.json(body, { status });
    const cases: [string, World, string, RegExp][] = [
      ["no admin", { record: () => new Response("{}", { status: 403 }) }, NEW, /Only an admin/],
      ["signed out", { record: () => new Response("{}", { status: 401 }) }, NEW, /sign in again/],
      ["platform down", { record: () => new Response("", { status: 503 }) }, NEW, /answered 503/],
      ["cleartext", {}, "http://ontology.acme.edu", /public https/],
      ["not an address", {}, "ontology", /public https/],
      [
        "no answer",
        {
          counts: () => {
            throw new Error("ECONNREFUSED");
          },
        },
        NEW,
        /^No answer from https:\/\/ontology\.acme\.edu: ECONNREFUSED$/,
      ],
      [
        "another sign-in",
        { counts: refused(401, { detail: "Invalid token." }) },
        NEW,
        /does not take your sign-in: Invalid token\.$/,
      ],
      [
        "no backend",
        { counts: () => new Response("<html>hello</html>") },
        NEW,
        /did not answer as/,
      ],
      [
        "an older backend",
        { counts: () => Response.json({ services: 3 }) },
        NEW,
        /did not answer as/,
      ],
      ["no platform", { counts: () => Response.json({ platform: "" }) }, NEW, /without a platform/],
      [
        "a name no header carries",
        { counts: () => Response.json({ platform: "acme\r\nx: y" }) },
        NEW,
        /did not answer as/,
      ],
      [
        "another platform's",
        { put: refused(403, { detail: "iblai-org does not match the token's platform." }) },
        NEW,
        /belongs to the platform acme/,
      ],
      [
        "not kept",
        { put: refused(403, { error: "Permission denied" }) },
        NEW,
        /did not keep the address: Permission denied$/,
      ],
    ];
    for (const [what, over, address, words] of cases) {
      fetchMock.mockReset();
      world(over);
      const answer = await connectBackend("Token jane", address);
      expect({ what, answer }).toEqual({
        what,
        answer: { ok: false, message: expect.stringMatching(words) },
      });
    }

    // A name that resolves into a private network is not asked either.
    resolves("10.0.0.7");
    fetchMock.mockReset();
    world();
    expect(await connectBackend("Token jane", NEW)).toMatchObject({ ok: false });
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(NEW)),
    ).toEqual([]);
  });

  it("sends this server nowhere for a caller who is not an admin, or not signed in", async () => {
    world({ record: () => new Response("{}", { status: 403 }) });
    await connectBackend("Token joe", NEW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/records\/default$/);
    expect(await connectBackend(null, NEW)).toEqual({ ok: false, message: "Sign in first." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(refused.filter((address) => isPublicAddress(address))).toEqual([]);
    const allowed = [
      "93.184.216.34",
      "172.32.0.1",
      "100.128.0.1",
      "2606:2800:220:1:248:1893:25c8:1946",
      "::ffff:93.184.216.34",
    ];
    expect(allowed.filter((address) => !isPublicAddress(address))).toEqual([]);
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

  it("offers the backend's address in the hosted console alone", async () => {
    const load = async (hosted: boolean) => {
      vi.stubEnv("ONTOLOGY_MULTI_PLATFORM", hosted ? "true" : "");
      vi.stubEnv("ONTOLOGY_API_URL", "");
      vi.resetModules();
      const { NextRequest } = await import("next/server");
      const backend = await import("@/app/api/hosted/backend/route");
      const request = (method: string, body?: object) =>
        new NextRequest("http://console.test/api/hosted/backend", {
          method,
          headers: { authorization: "Token jane" },
          body: body && JSON.stringify(body),
        });
      return { backend, request };
    };
    const address = "https://ontology.acme.edu";

    const plain = await load(false);
    const refused = [
      await plain.backend.GET(plain.request("GET")),
      await plain.backend.PUT(plain.request("PUT", { url: address })),
    ];
    expect(refused.map((res) => res.status)).toEqual([404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();

    const hosted = await load(true);
    world();
    const before = await hosted.backend.GET(hosted.request("GET"));
    expect(await before.json()).toEqual({ url: null, reason: "no_backend" });
    const connected = await hosted.backend.PUT(hosted.request("PUT", { url: address }));
    expect(await connected.json()).toEqual({ ok: true, url: address });
    // A body that names no address is refused in words, with a 200 like every refusal.
    const empty = await hosted.backend.PUT(hosted.request("PUT", {}));
    expect([empty.status, await empty.json()]).toMatchObject([200, { ok: false }]);
  });
});

describe("where each browser keeps the address", () => {
  const NEW = "https://ontology.acme.edu";
  const load = async () => {
    vi.stubEnv("ONTOLOGY_MULTI_PLATFORM", "true");
    vi.stubEnv("ONTOLOGY_API_URL", "");
    vi.stubEnv("ONTOLOGY_BACKEND_STORE", "browser");
    vi.resetModules();
    return import("./backend");
  };
  type Here = { counts?: () => Response };
  /** A backend of `acme` answers, unless said otherwise; the platform is never asked from this server. */
  const here = (over: Here = {}) =>
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v1/ontology/") || url.includes("/api/core/"))
        throw new Error(`the platform was asked: ${url}`);
      return over.counts?.() ?? Response.json({ services: 0, platform: "acme" });
    });
  const asked = () => fetchMock.mock.calls.map(([url]) => String(url));

  it("uses the address a browser names, once a backend that takes the sign-in answers there", async () => {
    const { backendFor } = await load();
    here();
    expect(await backendFor("Token jane")).toEqual({ status: 404, error: "no_backend_here" });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await backendFor("Token jane", `${NEW}/`)).toEqual({ url: NEW });
    // The address alone is asked, with the caller's sign-in, and followed nowhere.
    expect(asked()).toEqual([`${NEW}/counts`]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { authorization: "Token jane" },
      redirect: "manual",
    });
    // Kept a minute per sign-in and address: another address is another question.
    await backendFor("Token jane", `${NEW}/`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await backendFor("Token jane", "https://other.acme.edu");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says why a named address is no backend for the caller", async () => {
    const { backendFor } = await load();
    const bad = { status: 404, error: "bad_backend" };
    const forbidden = { detail: "Admin access to the ontology console is required." };
    const unknown = { detail: "DM token rejected." };
    const cases: [string, Here, string, object][] = [
      [
        "a sign-in the backend does not take",
        { counts: () => Response.json(unknown, { status: 401 }) },
        NEW,
        {
          status: 401,
          error: `The backend at ${NEW} does not take your sign-in: DM token rejected.`,
        },
      ],
      ["cleartext", {}, "http://ontology.acme.edu", bad],
      ["no backend", { counts: () => new Response("<html>hello</html>") }, NEW, bad],
      ["no platform", { counts: () => Response.json({ platform: "" }) }, NEW, bad],
      [
        "not its admin",
        { counts: () => Response.json(forbidden, { status: 403 }) },
        NEW,
        { status: 403, error: "not_admin" },
      ],
      [
        "no answer",
        {
          counts: () => {
            throw new Error("ECONNREFUSED");
          },
        },
        NEW,
        { status: 502, error: `No answer from ${NEW}: ECONNREFUSED` },
      ],
    ];
    for (const [n, [what, over, address, answer]] of cases.entries()) {
      fetchMock.mockReset();
      here(over);
      const backend = await backendFor(`Token ${n}`, address);
      expect({ what, backend }).toEqual({ what, backend: answer });
    }

    // A name that resolves into a private network is not asked.
    resolves("10.0.0.7");
    fetchMock.mockReset();
    here();
    expect(await backendFor("Token private", NEW)).toEqual(bad);
    expect(asked().filter((url) => url.startsWith(NEW))).toEqual([]);
  });

  it("connects by proving the address, and writes nothing to the platform", async () => {
    const { connectBackend } = await load();
    here();
    expect(await connectBackend("Token jane", ` ${NEW}/ `)).toEqual({
      ok: true,
      url: NEW,
      browser: true,
    });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET"]);

    here({ counts: () => Response.json({ detail: "Invalid token." }, { status: 401 }) });
    expect(await connectBackend("Token jane", NEW)).toEqual({
      ok: false,
      message: expect.stringMatching(/does not take your sign-in: Invalid token\.$/),
    });
  });

  it("the routes read the address from the browser's header, and do not pass it on", async () => {
    await load();
    const { NextRequest } = await import("next/server");
    const proxy = await import("@/app/api/ontology/[...path]/route");
    const hosted = await import("@/app/api/hosted/backend/route");
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/ontology/") || url.includes("/api/core/"))
        throw new Error(`the platform was asked: ${url}`);
      if (url.endsWith("/counts")) return Response.json({ services: 0, platform: "acme" });
      return Response.json({ url, named: new Headers(init?.headers).get("x-ontology-backend") });
    });
    const jane = { authorization: "Token jane" };
    const named = { ...jane, "x-ontology-backend": NEW };
    const call = (headers: Record<string, string>) =>
      proxy.GET(new NextRequest("http://console.test/api/ontology/roles", { headers }));

    expect(await (await call(named)).json()).toEqual({ url: `${NEW}/roles`, named: null });
    const none = await call(jane);
    expect([none.status, await none.json()]).toEqual([404, { error: "no_backend_here" }]);

    const at = "http://console.test/api/hosted/backend";
    const kept = await hosted.GET(new NextRequest(at, { headers: named }));
    expect(await kept.json()).toEqual({ url: NEW });
    const connected = await hosted.PUT(
      new NextRequest(at, { method: "PUT", headers: jane, body: JSON.stringify({ url: NEW }) }),
    );
    expect(await connected.json()).toEqual({ ok: true, url: NEW, browser: true });
  });
});
