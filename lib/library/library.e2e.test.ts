// Every ready-made API through the real runtime: one server holds all their toolsets, and the
// gateway lists each tool as an agent sees it. No tool is called. Skipped where the runtime is
// not installed.

import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveApi } from "@/lib/host/apis";
import type { Caller } from "@/lib/host/dm";
import { toolboxBin } from "@/lib/host/env";
import { handleMessage, type RpcContext } from "@/lib/host/mcp";
import { inPlatform } from "@/lib/host/platform";
import type { Reading } from "@/lib/host/reading";
import { saveServer, serving } from "@/lib/host/servers";
import { stop } from "@/lib/host/toolbox";
import type { HostApiInput, McpTool } from "@/lib/host/types";
import { library, load } from "./index";
import { toolName, type ReadyApi } from "./types";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/ontology-library-e2e-${process.pid}-${Date.now()}`;
  process.env.ONTOLOGY_HOME = dir;
  return dir;
});

// No engine: the catalog is the APIs alone.
vi.mock("@/lib/host/reading", () => ({
  readEngine: async () =>
    ({ connections: [], databases: [], terms: [], pii: {}, status: {} }) as unknown as Reading,
}));
// No DNS lookup: every address counts as public.
vi.mock("@/lib/host/address", () => ({
  apiAddress: vi.fn<typeof import("@/lib/host/address").apiAddress>(async (base: string) => ({
    address: `${base.trim().replace(/\/+$/, "")}/`,
    private: false,
    local: false,
  })),
}));

const installed = (() => {
  try {
    return Boolean(toolboxBin());
  } catch {
    return false;
  }
})();

const SLUG = "library";
const MODEL_NAME = /^[A-Za-z0-9_.-]{1,64}$/; // a parameter's name, as an agent's model takes it
const caller: Caller = {
  platform: "acme",
  scheme: "Token",
  subject: "ibl:ada",
  username: "ada",
  admin: true,
  scope: { everything: true, allToolsets: true, toolsets: [], tools: [], console: true },
  hash: "0".repeat(64),
};

// A definition as the form sends it, credentials typed in; an OAuth one signs in at tokenUrl.
function entered(ready: ReadyApi, tokenUrl: string): HostApiInput {
  const endpoints = ready.endpoints.map((ep) => ({ ...ep, name: toolName(ready.id, ep.name) }));
  const base = { name: ready.id, baseUrl: ready.baseUrl || ready.example, endpoints };
  if ("header" in ready.auth) return { ...base, authHeader: `${ready.auth.header}key-123456` };
  const { grant, clientAuth, scope } = ready.auth.oauth;
  const refreshToken = grant === "refresh_token" ? "refresh-value" : "";
  const secrets = { clientId: "console", clientSecret: "s3cret-value", refreshToken };
  return { ...base, authHeader: "", oauth: { grant, tokenUrl, clientAuth, scope, ...secrets } };
}

describe.skipIf(!installed)("every ready-made API through the runtime", () => {
  let vendor: Server;
  let port = 0;

  beforeAll(async () => {
    // Every vendor's token endpoint: each OAuth save signs in here once.
    vendor = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ access_token: "tok-library-e2e", expires_in: 3600 }));
      });
    });
    await new Promise<void>((resolve) => vendor.listen(0, "127.0.0.1", resolve));
    port = (vendor.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await inPlatform("acme", () => stop(SLUG));
    await new Promise((resolve) => vendor.close(resolve));
    await rm(home, { recursive: true, force: true });
  });

  it(
    "takes every definition, and lists each of their tools as an agent sees it",
    () =>
      inPlatform("acme", async () => {
        const tokenUrl = `http://127.0.0.1:${port}/token`;
        const apis = await Promise.all(
          library.map(async ({ id }) => entered(await load[id](), tokenUrl)),
        );
        // One at a time: each save rewrites apis.yaml.
        for (const api of apis) await saveApi(api);

        // Each API's reads and writes, where it has tools of that kind.
        const toolsets = apis.flatMap(({ name, endpoints }) => [
          ...(endpoints.some((ep) => ep.method === "GET") ? [`${name}-reads`] : []),
          ...(endpoints.some((ep) => ep.method !== "GET") ? [`${name}-writes`] : []),
        ]);
        // The runtime starts on one file that holds them all, or the save fails in its words.
        const draft = { toolsets, auth: { platform: true }, origins: [], hosts: [] };
        await saveServer(SLUG, draft, true);
        const served = await serving(SLUG);
        const ctx: RpcContext = {
          slug: SLUG,
          caller,
          serving: served!,
          origin: null,
          agent: null,
          forward: {},
        };
        const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
        const answer = (await handleMessage(ctx, list)) as {
          result?: { tools: McpTool[] };
          error?: { message: string };
        };
        expect(answer.error).toBeUndefined();
        const listed = answer.result?.tools ?? [];

        // Every endpoint is listed as its tool, and nothing else is.
        const endpoints = apis.flatMap((api) => api.endpoints);
        expect(listed.map((tool) => tool.name).sort()).toEqual(
          endpoints.map((ep) => ep.name).sort(),
        );

        // No header the gateway sets, and only names an agent's model takes: none with a $.
        const unfit = listed.flatMap(({ name, inputSchema }) =>
          [...Object.keys(inputSchema.properties ?? {}), ...(inputSchema.required ?? [])]
            .filter((param) => param === "Authorization" || !MODEL_NAME.test(param))
            .map((param) => `${name}: ${param}`),
        );
        expect(unfit).toEqual([]);

        // Graph's $filter is offered as filter.
        const offered = new Map(
          listed.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties ?? {})]),
        );
        const missing = endpoints.flatMap(({ name, query }) =>
          query
            .filter((q) => q.startsWith("$") && !offered.get(name)?.includes(q.slice(1)))
            .map((q) => `${name}: ${q}`),
        );
        expect(missing).toEqual([]);
      }),
    120_000,
  );
});
