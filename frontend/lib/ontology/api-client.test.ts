import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "./api-client";

const ADDRESS = "https://ontology.acme.edu";
const KEY = "k".repeat(64);

/** A browser signed in to `acme`, and a console that answers Connect as `connected`. */
function browser(connected: object) {
  const kept = new Map([
    ["dm_token", "t"],
    ["tenant", "acme"],
  ]);
  const localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
  // No platform from the build's settings: the one signed in to is the platform.
  vi.stubGlobal("window", { localStorage, __ENV__: { NEXT_PUBLIC_MAIN_TENANT_KEY: "" } });
  vi.stubGlobal("localStorage", localStorage);
  const sent: Headers[] = [];
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push(new Headers(init?.headers));
    asked.push(url);
    if (url.endsWith("/api-tokens/")) return Response.json({ key: KEY }, { status: 201 });
    return Response.json(url.endsWith("/backend") ? connected : { services: 0 });
  });
  return { kept, sent, asked };
}

afterEach(() => vi.unstubAllGlobals());

it("names the backend this browser keeps for its platform, once Connect says it is the browser's", async () => {
  const { kept, sent } = browser({ ok: true, url: ADDRESS, browser: true });
  await apiClient.counts();
  expect(sent[0].get("x-ontology-backend")).toBeNull();

  expect(await apiClient.hosted.connect(`${ADDRESS}/`)).toMatchObject({ ok: true, url: ADDRESS });
  expect(kept.get("ontology_backend:acme")).toBe(ADDRESS);
  await apiClient.counts();
  expect(sent[2].get("x-ontology-backend")).toBe(ADDRESS);
  expect(sent[2].get("authorization")).toBe("Token t");

  // Another platform in the same browser has its own, or none.
  kept.set("tenant", "other");
  await apiClient.counts();
  expect(sent[3].get("x-ontology-backend")).toBeNull();
});

it("keeps nothing in the browser when the platform keeps the address, or Connect refuses", async () => {
  for (const connected of [
    { ok: true, url: ADDRESS },
    { ok: false, message: "No answer." },
  ]) {
    const { kept } = browser(connected);
    await apiClient.hosted.connect(ADDRESS);
    expect([...kept.keys()]).toEqual(["dm_token", "tenant"]);
  }
});

it("asks the platform for the backend's key from the browser, with the sign-in and nothing else", async () => {
  const { kept, sent, asked } = browser({});
  kept.set("ontology_backend:acme", ADDRESS);
  expect(await apiClient.hosted.key()).toEqual({ ok: true, key: KEY });
  // Straight to the platform, not through the console's server.
  expect(asked[0]).toMatch(/^https:\/\/.+\/api\/core\/platform\/api-tokens\/$/);
  expect(sent[0].get("authorization")).toBe("Token t");
  expect(sent[0].get("x-ontology-backend")).toBeNull();

  kept.delete("dm_token");
  expect(await apiClient.hosted.key()).toMatchObject({ ok: false });
  expect(asked).toHaveLength(1);
});
