import { beforeEach, describe, expect, it, vi } from "vitest";

import { listApis, type StoredApi } from "./apis";
import type { Caller } from "./dm";
import { HostError } from "./errors";
import type { Scope } from "./grants";
import { callLocal } from "./local";
import {
  PROTOCOL_VERSION,
  RPC,
  checkRate,
  handleMessage,
  hostAllowed,
  lentToolsets,
  mask,
  originAllowed,
  type RpcContext,
} from "./mcp";
import { forget, liveTokens, tokenFor } from "./oauth";
import { semanticReady } from "./semantic";
import type { Serving } from "./servers";
import { callTool, ensureRunning, listTools } from "./toolbox";

vi.mock("./apis", async (actual) => ({
  ...(await actual<typeof import("./apis")>()),
  listApis: vi.fn<typeof import("./apis").listApis>(async () => []),
}));
vi.mock("./oauth", async (actual) => ({
  ...(await actual<typeof import("./oauth")>()),
  tokenFor: vi.fn<typeof import("./oauth").tokenFor>(),
  forget: vi.fn<typeof import("./oauth").forget>(),
  forgetsOf: vi.fn<typeof import("./oauth").forgetsOf>(() => 0),
  liveTokens: vi.fn<typeof import("./oauth").liveTokens>(() => []),
}));
vi.mock("./semantic", async (actual) => ({
  ...(await actual<typeof import("./semantic")>()),
  semanticReady: vi.fn<typeof import("./semantic").semanticReady>(),
}));
vi.mock("./local", async (actual) => ({
  ...(await actual<typeof import("./local")>()),
  callLocal: vi.fn<typeof import("./local").callLocal>(async () => ({
    content: [{ type: "text", text: "{}" }],
  })),
}));
vi.mock("./toolbox", () => ({
  ensureRunning: vi.fn<typeof import("./toolbox").ensureRunning>(),
  listTools: vi.fn<typeof import("./toolbox").listTools>(async () => []),
  callTool: vi.fn<typeof import("./toolbox").callTool>(),
}));
vi.mock("./log", () => ({
  record: vi.fn<typeof import("./log").record>(async () => undefined),
}));
vi.mock("./files", async (actual) => ({
  ...(await actual<typeof import("./files")>()),
  readEnv: vi.fn<typeof import("./files").readEnv>(async () => ({})),
}));

const serving: Serving = {
  draft: {
    toolsets: ["sis", "sis-raw", "semantic"],
    auth: { platform: true },
    origins: [],
    hosts: [],
  },
  members: { sis: ["list_students"], "sis-raw": ["sis_execute_sql", "sis_list_tables"] },
  writes: ["sis-raw"],
  files: [],
  signed: {},
  dollars: {},
};

const scope = (held: Partial<Scope>): Scope => ({
  everything: false,
  allToolsets: false,
  toolsets: [],
  tools: [],
  console: false,
  ...held,
});

const caller: Caller = {
  platform: "main",
  scheme: "Token",
  subject: "ibl:ada",
  username: "ada",
  admin: false,
  scope: scope({ allToolsets: true }),
  hash: "0".repeat(64),
};

const ctx: RpcContext = { slug: "sis", caller, serving, origin: null, agent: null, forward: {} };

describe("lentToolsets", () => {
  it("lends every read toolset through allToolsets, the semantic one included", () => {
    expect(lentToolsets(scope({ allToolsets: true }), serving)).toEqual(["sis", "semantic"]);
  });

  it("lends a writing toolset only when it is named", () => {
    expect(lentToolsets(scope({ toolsets: ["sis-raw"] }), serving)).toEqual(["sis-raw"]);
    expect(lentToolsets(scope({ allToolsets: true, toolsets: ["sis-raw"] }), serving)).toEqual([
      "sis",
      "sis-raw",
      "semantic",
    ]);
  });

  it("lends a platform admin every toolset the server offers, those that write too", () => {
    expect(lentToolsets(scope({ everything: true }), serving)).toEqual([
      "sis",
      "sis-raw",
      "semantic",
    ]);
  });

  it("lends no toolset for a single tool held by name, nor one the server lacks", () => {
    expect(lentToolsets(scope({ tools: ["sis_execute_sql"] }), serving)).toEqual([]);
    expect(lentToolsets(scope({ toolsets: ["crm"] }), serving)).toEqual([]);
  });

  it("offers the semantic toolset only when the draft has it", () => {
    const without = { ...serving, draft: { ...serving.draft, toolsets: ["sis"] } };
    expect(lentToolsets(scope({ allToolsets: true }), without)).toEqual(["sis"]);
  });
});

describe("handleMessage without the runtime", () => {
  it("echoes the client's protocol version on initialize, else its own", async () => {
    const asked = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "x" } };
    expect(await handleMessage(ctx, asked)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "x",
        capabilities: { tools: {} },
        serverInfo: { name: "ontology-sis" },
      },
    });
    const bare = await handleMessage(ctx, { jsonrpc: "2.0", id: 2, method: "initialize" });
    expect(bare).toMatchObject({ result: { protocolVersion: PROTOCOL_VERSION } });
  });

  it("answers ping with an empty result", async () => {
    const pong = await handleMessage(ctx, { jsonrpc: "2.0", id: "a", method: "ping" });
    expect(pong).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
  });

  it("refuses an unknown method with -32601", async () => {
    const answer = await handleMessage(ctx, { jsonrpc: "2.0", id: 3, method: "resources/list" });
    expect(answer).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: RPC.methodNotFound, message: "unknown method: resources/list" },
    });
  });

  it("answers a notification with nothing, and a non-object as an invalid request", async () => {
    const note = { jsonrpc: "2.0", method: "notifications/initialized" };
    expect(await handleMessage(ctx, note)).toBeNull();
    expect(await handleMessage(ctx, 7)).toMatchObject({
      id: null,
      error: { code: RPC.invalidRequest },
    });
  });
});

describe("checkRate", () => {
  const refused = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return error instanceof HostError ? error.status : -1;
    }
    return 0;
  };

  it("allows 120 requests a minute, then 429 until the window slides", () => {
    const t = 1_000_000;
    for (let i = 0; i < 120; i++) checkRate("requests", false, t + i);
    expect(refused(() => checkRate("requests", false, t + 200))).toBe(429);
    expect(refused(() => checkRate("requests", false, t + 60_001))).toBe(0);
  });

  it("allows 30 tools/call a minute, counted apart from the other requests", () => {
    const t = 2_000_000;
    for (let i = 0; i < 30; i++) checkRate("calls", true, t + i);
    expect(refused(() => checkRate("calls", true, t + 100))).toBe(429);
    expect(refused(() => checkRate("calls", false, t + 100))).toBe(0);
    expect(refused(() => checkRate("other", true, t + 100))).toBe(0);
  });
});

describe("mask", () => {
  it("hides every secret of six characters or more, longest first", () => {
    const secrets = ["s3cret-pass", "s3cret-pass-and-more", "short"];
    const text = "a s3cret-pass-and-more b s3cret-pass c short";
    expect(mask(text, secrets)).toBe("a ******** b ******** c short");
  });

  it("leaves text without secrets as it is", () => {
    expect(mask("nothing here", [])).toBe("nothing here");
  });
});

describe("hostAllowed", () => {
  it("takes a name as itself, whatever its case", () => {
    expect(hostAllowed("ontology.acme.edu", ["Ontology.Acme.edu"])).toBe(true);
    expect(hostAllowed("other.acme.edu", ["ontology.acme.edu"])).toBe(false);
  });

  it("takes every name under *.name, at any depth, and not the name itself", () => {
    const allowed = ["localhost", "*.ngrok-free.app"];
    expect(hostAllowed("ab12.ngrok-free.app", allowed)).toBe(true);
    expect(hostAllowed("a.b.ngrok-free.app", allowed)).toBe(true);
    expect(hostAllowed("ngrok-free.app", allowed)).toBe(false);
    expect(hostAllowed("evilngrok-free.app", allowed)).toBe(false);
    expect(hostAllowed("ab12.ngrok-free.app.evil.dev", allowed)).toBe(false);
  });

  it("takes any host for *, and none for an empty list", () => {
    expect(hostAllowed("anything.dev", ["*"])).toBe(true);
    expect(hostAllowed("anything.dev", [])).toBe(false);
  });
});

describe("originAllowed", () => {
  it("takes an origin on the list, with or without its last slash", () => {
    expect(originAllowed("https://os.ibl.ai", ["https://os.ibl.ai/"])).toBe(true);
    expect(originAllowed("https://evil.dev", ["https://os.ibl.ai"])).toBe(false);
  });

  it.each(["http://localhost:6274", "http://127.0.0.1:3000", "http://[::1]:8080"])(
    "takes %s, a page served from this machine, on no list",
    (origin) => {
      expect(originAllowed(origin, [])).toBe(true);
    },
  );

  it.each(["https://localhost.evil.dev", "http://10.0.0.5:3000", "null", ""])(
    "refuses %s on no list",
    (origin) => {
      expect(originAllowed(origin, [])).toBe(false);
    },
  );
});

describe("a filesystem’s toolset", () => {
  const withFiles: Serving = {
    draft: { toolsets: ["sis", "docs-files"], auth: { platform: true }, origins: [], hosts: [] },
    members: { sis: ["list_students"], "docs-files": ["docs_list_files", "docs_read_file"] },
    writes: [],
    files: ["docs-files"],
    signed: {},
    dollars: {},
  };
  const ask = (held: Partial<Scope>, message: object) =>
    handleMessage(
      { ...ctx, serving: withFiles, caller: { ...caller, scope: scope(held) } },
      message,
    );
  const listed = async (held: Partial<Scope>) => {
    const reply = await ask(held, { id: 1, method: "tools/list" });
    return (reply as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  };

  it("lists its two tools without the runtime, and one of them held by name", async () => {
    expect(await listed({ toolsets: ["docs-files"] })).toEqual([
      "docs_list_files",
      "docs_read_file",
    ]);
    expect(await listed({ tools: ["docs_read_file"] })).toEqual(["docs_read_file"]);
    expect(ensureRunning).not.toHaveBeenCalled();
  });

  it("answers a call itself and never asks the runtime", async () => {
    const call = { name: "docs_read_file", arguments: { path: "a.txt" } };
    const reply = await ask({ allToolsets: true }, { id: 2, method: "tools/call", params: call });
    expect(callLocal).toHaveBeenCalledWith("docs-files", "docs_read_file", { path: "a.txt" });
    expect(callTool).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ id: 2, result: { content: [{ type: "text", text: "{}" }] } });
  });
});

describe("tools/list", () => {
  const own: Serving = {
    draft: { toolsets: ["semantic"], auth: { platform: true }, origins: [], hosts: [] },
    members: {},
    writes: [],
    files: [],
    signed: {},
    dollars: {},
  };
  const names = async () => {
    const reply = await handleMessage({ ...ctx, serving: own }, { id: 1, method: "tools/list" });
    return (reply as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  };

  it("offers the semantic tools only while the engine holds a semantic layer", async () => {
    vi.mocked(semanticReady).mockResolvedValue(false);
    expect(await names()).toEqual([]);
    vi.mocked(semanticReady).mockResolvedValue(true);
    expect(await names()).toEqual(["ask_question", "search_terms", "describe_table"]);
  });
});

describe("an OAuth API’s tool", () => {
  const signed: Serving = {
    draft: { toolsets: ["canvas-reads"], auth: { platform: true }, origins: [], hosts: [] },
    members: { "canvas-reads": ["canvas_list_courses"] },
    writes: [],
    files: [],
    signed: { canvas_list_courses: "canvas" },
    dollars: {},
  };
  const api: StoredApi = {
    name: "canvas",
    baseUrl: "https://canvas.example/",
    authHeader: "",
    endpoints: [],
    tools: 1,
    secretEnv: null,
    private: false,
    local: false,
    oauth: {
      grant: "client_credentials",
      tokenUrl: "/login/oauth2/token",
      clientId: "console",
      clientAuth: "basic",
      scope: "",
    },
  };
  const ask = (message: object) => handleMessage({ ...ctx, serving: signed }, message);
  const call = (args: object) =>
    ask({ id: 1, method: "tools/call", params: { name: "canvas_list_courses", arguments: args } });
  const said = (reply: unknown) =>
    (reply as { result: { content: { text: string }[]; isError?: boolean } }).result;

  beforeEach(() => {
    vi.mocked(callTool).mockReset();
    vi.mocked(forget).mockClear();
    vi.mocked(tokenFor).mockClear();
    vi.mocked(listApis).mockResolvedValue([api]);
    vi.mocked(tokenFor).mockResolvedValue("tok-123456");
    vi.mocked(liveTokens).mockReturnValue([]);
    vi.mocked(callTool).mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
  });

  it("is listed without the header the gateway sets", async () => {
    vi.mocked(listTools).mockResolvedValueOnce([
      {
        name: "canvas_list_courses",
        inputSchema: {
          type: "object",
          properties: { per_page: { type: "string" }, Authorization: { type: "string" } },
          required: ["Authorization"],
        },
      },
    ]);
    const reply = await ask({ id: 1, method: "tools/list" });
    expect((reply as { result: { tools: unknown[] } }).result.tools).toEqual([
      {
        name: "canvas_list_courses",
        inputSchema: { type: "object", properties: { per_page: { type: "string" } }, required: [] },
      },
    ]);
  });

  it("is called with the API’s token, whatever the caller sent in its place", async () => {
    await call({ per_page: "5", Authorization: "Bearer mine" });
    expect(tokenFor).toHaveBeenCalledWith({
      name: "canvas",
      baseUrl: api.baseUrl,
      oauth: api.oauth,
      since: 0,
    });
    expect(callTool).toHaveBeenCalledWith(
      "sis",
      "canvas-reads",
      "canvas_list_courses",
      { per_page: "5", Authorization: "Bearer tok-123456" },
      {},
    );
  });

  it("answers a sign-in that failed as a result the agent reads, and calls nothing", async () => {
    vi.mocked(tokenFor).mockRejectedValue(new Error("canvas.example refused the sign-in (401)"));
    const result = said(await call({}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("canvas.example refused the sign-in (401)");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("says to save the server again when the API no longer signs in with OAuth", async () => {
    vi.mocked(listApis).mockResolvedValue([{ ...api, oauth: undefined }]);
    const result = said(await call({}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("canvas no longer signs in with OAuth");
  });

  it("forgets the token when the API answers 401, and only then", async () => {
    await call({});
    expect(forget).not.toHaveBeenCalled();
    const refused = "unexpected status code: 401, response body: {}";
    vi.mocked(callTool).mockResolvedValue({
      content: [{ type: "text", text: refused }],
      isError: true,
    });
    await call({});
    expect(forget).toHaveBeenCalledWith("canvas");
  });

  it("masks a kept token an answer echoes", async () => {
    vi.mocked(liveTokens).mockReturnValue(["tok-123456"]);
    vi.mocked(callTool).mockResolvedValue({ content: [{ type: "text", text: "saw tok-123456" }] });
    expect(said(await call({})).content[0].text).toBe("saw ********");
  });

  it("leaves another tool’s arguments as they came", async () => {
    const plain = { ...signed, signed: {} };
    const params = { name: "canvas_list_courses", arguments: { Authorization: "Bearer mine" } };
    await handleMessage({ ...ctx, serving: plain }, { id: 1, method: "tools/call", params });
    expect(tokenFor).not.toHaveBeenCalled();
    expect(vi.mocked(callTool).mock.calls[0][3]).toEqual({ Authorization: "Bearer mine" });
  });
});

describe("a tool whose query names start with $", () => {
  const graph: Serving = {
    draft: { toolsets: ["outlook-reads"], auth: { platform: true }, origins: [], hosts: [] },
    members: { "outlook-reads": ["outlook_list_messages"] },
    writes: [],
    files: [],
    signed: { outlook_list_messages: "outlook" },
    dollars: { outlook_list_messages: ["$filter", "$top"] },
  };
  const api: StoredApi = {
    name: "outlook",
    baseUrl: "https://graph.example/v1.0/",
    authHeader: "",
    endpoints: [],
    tools: 1,
    secretEnv: null,
    private: false,
    local: false,
    oauth: {
      grant: "client_credentials",
      tokenUrl: "https://login.example/token",
      clientId: "console",
      clientAuth: "body",
      scope: "https://graph.example/.default",
    },
  };
  const ask = (message: object, serving = graph) => handleMessage({ ...ctx, serving }, message);
  const call = (args: object, serving = graph) =>
    ask(
      { id: 1, method: "tools/call", params: { name: "outlook_list_messages", arguments: args } },
      serving,
    );

  beforeEach(() => {
    vi.mocked(callTool).mockReset();
    vi.mocked(tokenFor).mockClear();
    vi.mocked(listApis).mockResolvedValue([api]);
    vi.mocked(tokenFor).mockResolvedValue("tok-123456");
    vi.mocked(callTool).mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
  });

  it("is listed with each such name without its $, and without the header", async () => {
    const text = { type: "string" };
    vi.mocked(listTools).mockResolvedValueOnce([
      {
        name: "outlook_list_messages",
        inputSchema: {
          type: "object",
          properties: { user_id: text, $filter: text, $top: text, Authorization: text },
          required: ["user_id", "$filter", "Authorization"],
        },
      },
    ]);
    const reply = await ask({ id: 1, method: "tools/list" });
    expect((reply as { result: { tools: unknown[] } }).result.tools).toEqual([
      {
        name: "outlook_list_messages",
        inputSchema: {
          type: "object",
          properties: { user_id: text, filter: text, top: text },
          required: ["user_id", "filter"],
        },
      },
    ]);
  });

  it("is called with each name given its $ back, and the token set", async () => {
    await call({ user_id: "ada", filter: "isRead eq false", top: "5" });
    expect(vi.mocked(callTool).mock.calls[0][3]).toEqual({
      user_id: "ada",
      $filter: "isRead eq false",
      $top: "5",
      Authorization: "Bearer tok-123456",
    });
  });

  it("signs no tool named like an object's own property", async () => {
    const own = {
      ...graph,
      members: { "outlook-reads": ["constructor"] },
      signed: {},
      dollars: {},
    };
    const params = { name: "constructor", arguments: { a: "1" } };
    await handleMessage({ ...ctx, serving: own }, { id: 1, method: "tools/call", params });
    expect(tokenFor).not.toHaveBeenCalled();
    expect(vi.mocked(callTool).mock.calls[0][3]).toEqual({ a: "1" });
  });

  it("renames only the names the server’s tools.yaml declares", async () => {
    const plain = { ...graph, signed: {}, dollars: {} };
    await call({ filter: "x", $top: "2" }, plain);
    expect(vi.mocked(callTool).mock.calls[0][3]).toEqual({ filter: "x", $top: "2" });
  });
});
