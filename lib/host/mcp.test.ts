import { describe, expect, it, vi } from "vitest";

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
import { semanticReady } from "./semantic";
import type { Serving } from "./servers";
import { callTool, ensureRunning } from "./toolbox";

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
