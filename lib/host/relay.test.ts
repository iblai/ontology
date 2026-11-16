import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_HEADER } from "@/lib/server-address";
import { relay } from "./relay";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Address literals, so no name is resolved: 203.0.113.0/24 is public, 10/8 is private.
const SERVER = "https://203.0.113.10/iblai";
const call = (headers: Record<string, string>, init: RequestInit = {}) =>
  new Request("https://console.example/api/host/servers?x=1", { ...init, headers });

describe("relay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks no one when the browser named no server, or one it may not be sent to", async () => {
    const fetch = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetch);
    await expect(relay(call({}))).rejects.toMatchObject({ status: 404 });
    const inside = call({ [SERVER_HEADER]: "https://10.0.0.5/iblai" });
    await expect(relay(inside)).rejects.toThrow(/private network/);
    const clear = call({ [SERVER_HEADER]: "http://203.0.113.10/iblai" });
    await expect(relay(clear)).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards the call with the sign-in and the platform, and nothing else", async () => {
    const fetch = vi.fn<Fetch>(
      async () =>
        new Response('{"ok":true}', {
          status: 201,
          headers: { "content-type": "application/json", "set-cookie": "a=b" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const headers = {
      [SERVER_HEADER]: `${SERVER}/`,
      authorization: "Token t",
      "x-ontology-platform": "acme",
      "content-type": "application/json",
      cookie: "session=1",
    };
    const answer = await relay(call(headers, { method: "POST", body: '{"a":1}' }));

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/host/servers?x=1`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect([...new Headers(init.headers).keys()].sort()).toEqual([
      "authorization",
      "content-type",
      "x-ontology-platform",
    ]);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"a":1}');

    expect(answer.status).toBe(201);
    expect(answer.headers.get("content-type")).toBe("application/json");
    expect(answer.headers.get("set-cookie")).toBeNull();
    expect(await answer.json()).toEqual({ ok: true });
  });

  it("follows no redirect, and names a server that does not answer", async () => {
    const elsewhere = new Response(null, { status: 302, headers: { location: "https://x.test/" } });
    vi.stubGlobal(
      "fetch",
      vi.fn<Fetch>(async () => elsewhere),
    );
    const named = { [SERVER_HEADER]: SERVER };
    await expect(relay(call(named))).rejects.toThrow(/203\.0\.113\.10 answered with a redirect/);

    const down = vi.fn<Fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", down);
    await expect(relay(call(named))).rejects.toMatchObject({ status: 502 });
  });
});
