// An OAuth API end to end, through the real runtime: a local stand-in for the vendor issues the
// tokens and records the header each call arrives with. Skipped where the runtime is not installed.

import { appendFile, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveApi } from "./apis";
import type { Caller } from "./dm";
import { toolboxBin } from "./env";
import { homePath } from "./files";
import { handleMessage, type RpcContext } from "./mcp";
import { inPlatform } from "./platform";
import type { Reading } from "./reading";
import { saveServer, serving } from "./servers";
import { logTail, stop } from "./toolbox";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/ontology-oauth-e2e-${process.pid}-${Date.now()}`;
  process.env.ONTOLOGY_HOME = dir;
  return dir;
});

// No engine: the catalog is the API alone.
vi.mock("./reading", () => ({
  readEngine: async () =>
    ({ connections: [], databases: [], terms: [], pii: {}, status: {} }) as unknown as Reading,
}));

const installed = (() => {
  try {
    return Boolean(toolboxBin());
  } catch {
    return false;
  }
})();

const SECRET = "s3cret-value";
const caller: Caller = {
  platform: "acme",
  scheme: "Token",
  subject: "ibl:ada",
  username: "ada",
  admin: true,
  scope: { everything: true, allToolsets: true, toolsets: [], tools: [], console: true },
  hash: "0".repeat(64),
};

describe.skipIf(!installed)("an OAuth API through the runtime", () => {
  let vendor: Server;
  let port = 0;
  let issued = 0; // tokens are tok-e2e-1, tok-e2e-2, …
  let refused = ""; // the token the API answers 401 to
  const seen: { authorization: string | undefined; url: string | undefined }[] = [];
  const logins: (string | undefined)[] = [];

  beforeAll(async () => {
    vendor = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        if (request.url === "/token") {
          logins.push(request.headers.authorization);
          response.end(JSON.stringify({ access_token: `tok-e2e-${++issued}`, expires_in: 3600 }));
          return;
        }
        const authorization = request.headers.authorization;
        seen.push({ authorization, url: request.url });
        if (authorization === `Bearer ${refused}`) {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: `no longer valid: ${refused}` }));
          return;
        }
        response.end(JSON.stringify([{ id: 1, name: "first" }]));
      });
    });
    await new Promise<void>((resolve) => vendor.listen(0, "127.0.0.1", resolve));
    port = (vendor.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await inPlatform("acme", () => stop("vendor"));
    await new Promise((resolve) => vendor.close(resolve));
    await rm(home, { recursive: true, force: true });
  });

  it(
    "sets the token on every call, renews it after a 401, and writes it nowhere",
    () =>
      inPlatform("acme", async () => {
        await saveApi({
          name: "vendor",
          baseUrl: `http://127.0.0.1:${port}`,
          authHeader: "",
          oauth: {
            grant: "client_credentials",
            tokenUrl: "/token",
            clientId: "console",
            clientAuth: "basic",
            scope: "",
            clientSecret: SECRET,
            refreshToken: "",
          },
          endpoints: [
            {
              name: "vendor_list_items",
              method: "GET",
              path: "/items",
              description: "Lists items.",
              query: ["per_page"],
            },
            {
              name: "vendor_find_items",
              method: "GET",
              path: "/items/search",
              description: "Finds items.",
              query: ["$filter", "$top"],
            },
            {
              name: "vendor_append_row",
              method: "POST",
              path: "/sheets/{range}:append",
              description: "Appends a row.",
              query: [],
            },
          ],
        });
        // The save signed in once, with the client's ID and secret.
        expect(logins).toEqual([`Basic ${Buffer.from(`console:${SECRET}`).toString("base64")}`]);

        const draft = {
          toolsets: ["vendor-reads", "vendor-writes"],
          auth: { platform: true },
          origins: [],
          hosts: [],
        };
        await saveServer("vendor", draft, true);
        const served = await serving("vendor");
        expect(served?.signed).toEqual({
          vendor_list_items: "vendor",
          vendor_find_items: "vendor",
          vendor_append_row: "vendor",
        });
        expect(served?.dollars).toEqual({ vendor_find_items: ["$filter", "$top"] });
        const ctx: RpcContext = {
          slug: "vendor",
          caller,
          serving: served!,
          origin: null,
          agent: null,
          forward: {},
        };
        const ask = async (method: string, params?: object) =>
          (await handleMessage(ctx, { jsonrpc: "2.0", id: 1, method, params })) as {
            result: {
              tools?: { name: string; inputSchema: { properties: object; required?: string[] } }[];
              content?: { text: string }[];
              isError?: boolean;
            };
          };
        const call = (args: object) =>
          ask("tools/call", { name: "vendor_list_items", arguments: args });

        // An agent sees the tool without the header, and Graph's $ names without their $.
        const listed = (await ask("tools/list")).result.tools ?? [];
        const named = (name: string) => listed.find((one) => one.name === name);
        const tool = named("vendor_list_items")!;
        expect(Object.keys(tool.inputSchema.properties)).toEqual(["per_page"]);
        expect(tool.inputSchema.required ?? []).not.toContain("Authorization");
        const finder = named("vendor_find_items")!;
        expect(Object.keys(finder.inputSchema.properties).sort()).toEqual(["filter", "top"]);

        // The API gets the host's token, not the one the caller sent.
        const first = await call({ per_page: "5", Authorization: "Bearer mine" });
        expect(first.result.isError ?? false).toBe(false);
        expect(first.result.content?.map((part) => part.text).join("")).toContain("first");
        expect(seen.at(-1)).toEqual({
          authorization: "Bearer tok-e2e-2",
          url: "/items?per_page=5",
        });

        // The token is kept between calls.
        await call({});
        expect(seen.at(-1)?.authorization).toBe("Bearer tok-e2e-2");
        expect(issued).toBe(2);

        // The API refuses it: the agent reads that, masked, and the next call signs in again.
        refused = "tok-e2e-2";
        const denied = await call({});
        const words = denied.result.content?.map((part) => part.text).join("") ?? "";
        expect(denied.result.isError).toBe(true);
        expect(words).toContain("unexpected status code: 401");
        expect(words).not.toContain("tok-e2e-2");
        await call({});
        expect(seen.at(-1)?.authorization).toBe("Bearer tok-e2e-3");

        // The runtime sends a $ name as Graph's own clients do, %24filter.
        const asked = (url = seen.at(-1)?.url ?? "") => new URL(url, "http://stand-in");
        const found = await ask("tools/call", {
          name: "vendor_find_items",
          arguments: { filter: "name eq 'a'", top: "2" },
        });
        expect(found.result.isError ?? false).toBe(false);
        expect(asked().pathname).toBe("/items/search");
        expect(seen.at(-1)?.url).toContain("%24filter=");
        expect(Object.fromEntries(asked().searchParams)).toEqual({
          $filter: "name eq 'a'",
          $top: "2",
        });

        // A path with Google's ':' verb, its value holding '!' and ':'.
        const appended = await ask("tools/call", {
          name: "vendor_append_row",
          arguments: { range: "Sheet1!A1:C2", body: { values: [["a"]] } },
        });
        expect(appended.result.isError ?? false).toBe(false);
        expect(decodeURIComponent(asked().pathname)).toBe("/sheets/Sheet1!A1:C2:append");

        // Neither a token nor the secret is in a file an admin reads; the secret is in env alone.
        const read = (...parts: string[]) => readFile(homePath(...parts), "utf8");
        const [config, runtimeLog, gatewayLog, env] = await Promise.all([
          read("servers", "vendor", "tools.yaml"),
          read("servers", "vendor", "toolbox.log"),
          read("servers", "vendor", "gateway.log"),
          read("env"),
        ]);
        for (const text of [config, runtimeLog, gatewayLog, env])
          expect(text).not.toContain("tok-e2e");
        for (const text of [config, runtimeLog, gatewayLog]) expect(text).not.toContain(SECRET);
        expect(env).toContain(`VENDOR_OAUTH_CLIENT_SECRET=${SECRET}`);
        expect(gatewayLog).toContain("vendor_list_items");

        // The runtime's own environment holds no OAuth secret: the gateway alone reads them.
        const { pid } = JSON.parse(await read("servers", "vendor", "pid")) as { pid: number };
        // /proc is Linux's; elsewhere the check passes on a stand-in.
        const proc = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => null);
        const environ = proc ?? "PATH=";
        expect(environ).toContain("PATH="); // the control: this is its environment
        expect(environ).not.toContain("VENDOR_OAUTH_CLIENT_SECRET");
        expect(environ).not.toContain(SECRET);
        // The runtime's log, as the console shows it, masks a token it holds.
        await appendFile(homePath("servers", "vendor", "toolbox.log"), "\nechoed tok-e2e-3\n");
        expect((await logTail("vendor", 5)).join("\n")).toContain("echoed ********");
      }),
    60_000,
  );
});
