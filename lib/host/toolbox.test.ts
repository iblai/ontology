import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostError } from "./errors";
import { homePath, readText, writeAtomic } from "./files";
import { inPlatform } from "./platform";
import { parseMessage, status, stop } from "./toolbox";
import { renderConfig } from "./toolbox-config";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/ontology-toolbox-test-${process.pid}-${Date.now()}`;
  process.env.ONTOLOGY_HOME = dir;
  return dir;
});

vi.mock("./servers", () => ({
  readFlags: vi.fn<typeof import("./servers").readFlags>(),
  serving: vi.fn<typeof import("./servers").serving>(),
}));
vi.mock("./mcp", () => ({ mask: (text: string) => text }));

describe("parseMessage", () => {
  it("reads a plain JSON answer", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(parseMessage("application/json", body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
  });

  it("reads the last data line of an event stream", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"id\\":7}"}]}}',
      "",
    ].join("\r\n");
    const message = parseMessage("text/event-stream; charset=utf-8", body);
    expect(message.result).toEqual({ content: [{ type: "text", text: '{"id":7}' }] });
  });

  it("keeps the runtime's own error", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "toolset does not exist" },
    });
    expect(parseMessage(null, body).error?.message).toBe("toolset does not exist");
  });

  it("refuses what is not a JSON-RPC message, loudly", () => {
    expect(() => parseMessage("text/plain", "Forbidden")).toThrow(HostError);
    expect(() => parseMessage("application/json", "[1]")).toThrow(HostError);
  });

  it("reads an event stream without data as an empty message", () => {
    expect(parseMessage("text/event-stream", "event: ping\n\n")).toEqual({});
  });
});

describe("a runtime found through its pid file", () => {
  let runtime: Server | null = null;
  const signals: unknown[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    signals.length = 0;
    await new Promise((resolve) => (runtime ? runtime.close(resolve) : resolve(undefined)));
    runtime = null;
    await rm(home, { recursive: true, force: true });
  });

  // Writes sis's tools.yaml and a pid file whose port answers tools/list for its mark, or not.
  async function adopt(answersForMark: boolean): Promise<void> {
    const { yaml, mark } = renderConfig([], "sis · rev 1", "acme");
    const toolset = answersForMark ? mark : "loaded-0123456789ab"; // another server's mark
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        const answer =
          request.url === `/mcp/${toolset}`
            ? { result: { tools: [] } }
            : { error: { message: "toolset does not exist" } };
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, ...answer }));
      });
    });
    runtime = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await writeAtomic(homePath("servers", "sis", "tools.yaml"), yaml);
    const file = { pid: 4242, port, startedAt: new Date().toISOString(), launch: "-" };
    await writeAtomic(homePath("servers", "sis", "pid"), JSON.stringify(file));
    // The pid lives until it is sent a real signal; no real process is signalled.
    let dead = false;
    vi.spyOn(process, "kill").mockImplementation((_pid, sig) => {
      if (sig === 0) {
        if (dead) throw new Error("ESRCH");
        return true;
      }
      signals.push(sig);
      dead = true;
      return true;
    });
  }

  it("calls a port that does not answer for the mark not running, and signals nothing", () =>
    inPlatform("acme", async () => {
      await adopt(false);
      expect(await status("sis")).toEqual({ running: false, pid: null, port: null });
      await stop("sis");
      expect(signals).toEqual([]);
      expect(await readText(homePath("servers", "sis", "pid"))).toBeNull();
      const log = await readText(homePath("servers", "sis", "toolbox.log"));
      expect(log).toContain("left pid 4242 alone");
    }));

  it("adopts a port that answers for the mark, for its own platform only, and stops it", () =>
    inPlatform("acme", async () => {
      await adopt(true);
      expect(await status("sis")).toMatchObject({ running: true, pid: 4242 });
      expect(await inPlatform("other", () => status("sis"))).toMatchObject({ running: false });
      await stop("sis");
      expect(signals).toEqual(["SIGTERM"]);
    }));
});
