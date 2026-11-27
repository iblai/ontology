// Every ready-made definition is one a save takes and the runtime's validator passes.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { apiDocs, checkApi, signedTools } from "@/lib/host/apis";
import { validateDocs } from "@/lib/host/toolbox-config";
import type { HostApiInput } from "@/lib/host/types";
import { catalog } from "@/lib/view/catalog";
import { library, load } from "./index";
import { scopeLine, setup } from "./setup";
import { toolName, type ReadyApi } from "./types";

vi.mock("@/lib/host/address", () => ({
  apiAddress: vi.fn<typeof import("@/lib/host/address").apiAddress>(async (base: string) => ({
    address: `${base.trim().replace(/\/+$/, "")}/`,
    private: false,
    local: false,
  })),
}));
vi.mock("@/lib/host/semantic", () => ({
  SEMANTIC_TOOLS: [{ name: "ask_question" }, { name: "search_terms" }, { name: "describe_table" }],
}));

// A definition as the form sends it once an admin has typed an address and credentials.
function entered(ready: ReadyApi): HostApiInput {
  const endpoints = ready.endpoints.map((ep) => ({ ...ep, name: toolName(ready.id, ep.name) }));
  const base = { name: ready.id, baseUrl: ready.baseUrl || ready.example, endpoints };
  if ("header" in ready.auth) return { ...base, authHeader: `${ready.auth.header}key-123456` };
  const { tokenExample, ...oauth } = ready.auth.oauth;
  return {
    ...base,
    authHeader: "",
    oauth: {
      ...oauth,
      tokenUrl: oauth.tokenUrl || tokenExample || "",
      clientId: "console",
      clientSecret: "s3cret-value",
      refreshToken: "refresh-value",
    },
  };
}

describe("the ready-made definitions", () => {
  it("are one file per tile, and one tile per file", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(here).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(library.map((tile) => `${tile.id}.json`).sort());
    expect(Object.keys(load).sort()).toEqual(library.map((tile) => tile.id).sort());
    expect(new Set(library.map((tile) => tile.name)).size).toBe(library.length);
  });

  it.each(library.map((tile) => [tile.id, tile] as const))(
    "%s is saved as it is filled in, and served",
    async (id, tile) => {
      const ready = await load[id]();
      expect(ready).toMatchObject(tile);
      expect(ready.hint.length).toBeGreaterThan(10);
      expect(ready.baseUrl || ready.example).toMatch(/^https:\/\//);
      expect(ready.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
      expect(ready.endpoints.length).toBeGreaterThanOrEqual(3);
      // A POST that only asks is still a POST.
      const asked = ready.endpoints.filter((ep) => ready.ask?.includes(ep.name));
      expect(asked.map((ep) => ep.name)).toEqual(ready.ask ?? []);
      expect(asked.every((ep) => ep.method !== "GET")).toBe(true);

      const { api } = await checkApi(entered(ready));
      expect(api.endpoints.map((ep) => ep.name)).toEqual(
        ready.endpoints.map((ep) => toolName(id, ep.name)),
      );
      const docs = apiDocs(api);
      expect(() => validateDocs(docs)).not.toThrow();
      const signed = Object.keys(signedTools(docs)).length;
      expect(signed).toBe("oauth" in ready.auth ? api.endpoints.length : 0);
    },
  );

  it("names a tool behind its API’s name, whatever that is", () => {
    expect(toolName("canvas", "list_courses")).toBe("canvas_list_courses");
    expect(toolName("canvas-eu", "list_courses")).toBe("canvas_eu_list_courses");
    expect(toolName("a".repeat(60), "list_courses")).toHaveLength(64);
  });
});

describe("the tiles’ logos", () => {
  const publicDir = fileURLToPath(new URL("../../public", import.meta.url));
  const tiles = catalog.filter((kind) => kind.logo);

  it("are one file per tile, and one tile per file", () => {
    expect(readdirSync(path.join(publicDir, "logos")).sort()).toEqual(
      tiles.map((kind) => path.basename(kind.logo ?? "")).sort(),
    );
  });

  // Served from the console's origin, so one opened on its own must not run or fetch anything.
  it.each(tiles.map((kind) => [kind.name, kind.logo ?? ""] as const))(
    "%s’s is a plain SVG",
    (_name, logo) => {
      const svg = readFileSync(path.join(publicDir, logo), "utf8");
      expect(svg).toMatch(/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/);
      expect(svg).toMatch(/\sviewBox=/);
      expect(svg).not.toMatch(
        /<script|<foreignObject|<image|<!DOCTYPE|<!ENTITY|@import|javascript:|\son[a-z]+\s*=/i,
      );
      const refs = [...svg.matchAll(/(?:href\s*=\s*["']|url\(\s*["']?)([^"')]*)/gi)];
      expect(refs.map((m) => m[1]).filter((ref) => !ref.startsWith("#"))).toEqual([]);
    },
  );
});

describe("the setup steps behind the form’s ?", () => {
  // Written by hand, so each name must still be one the tile's own hint gives.
  it.each(library.map((tile) => tile.id))(
    "%s has them exactly when it signs in with Google or Microsoft",
    async (id) => {
      const ready = await load[id]();
      const oauth = "oauth" in ready.auth ? ready.auth.oauth : null;
      const vendor =
        oauth?.tokenUrl === "https://oauth2.googleapis.com/token"
          ? "google"
          : oauth?.tokenExample?.includes("login.microsoftonline.com")
            ? "microsoft"
            : undefined;
      const s = setup[id];
      expect(s?.vendor).toBe(vendor);
      if (!s) return;
      const named = s.vendor === "google" ? [s.api, ...s.scopes] : [...s.permissions, ...s.writes];
      expect(named.filter((name) => !ready.hint.includes(name))).toEqual([]);
    },
  );

  it("gives the Playground every scope as a full address", () => {
    const admin = setup["google-admin"];
    const line = admin.vendor === "google" ? scopeLine(admin.scopes) : "";
    expect(line.split(" ")).toHaveLength(10);
    expect(
      line.split(" ").every((s) => s.startsWith("https://www.googleapis.com/auth/admin.")),
    ).toBe(true);
  });
});
