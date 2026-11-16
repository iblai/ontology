// One runtime process (Google MCP Toolbox) per server: start, stop, find again, ask.
// The pid, the port and the log live on disk, so a restarted console adopts a running process.
// Ported from the old product's mcp_server/toolbox_client.py.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { appendFile, mkdir, open, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { dirname } from "node:path";
import { mcpPath } from "@/lib/platform";
import { toolboxBin } from "./env";
import { HostError } from "./errors";
import { homePath, readEnv, readText, writeAtomic } from "./files";
import { mask } from "./mcp";
import { currentPlatform } from "./platform";
import { readFlags, serving } from "./servers";
import { MARK, parseConfig } from "./toolbox-config";
import type { HostServerDraft, McpTool, McpToolResult } from "./types";

export type ProcessStatus = { running: boolean; pid: number | null; port: number | null };

/** One JSON-RPC answer from the runtime. */
export type RpcMessage = { result?: unknown; error?: { code?: number; message?: string } };

type PidFile = { pid: number; port: number; startedAt: string; launch: string };

const READY_MS = 20_000;
const CALL_MS = 30_000;
const NOT_LOADED = "toolset does not exist";

const pidPath = (slug: string) => homePath("servers", slug, "pid");
const logPath = (slug: string) => homePath("servers", slug, "toolbox.log");
const configPath = (slug: string) => homePath("servers", slug, "tools.yaml");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

// By pid file path. ponytail: per module instance; two route bundles could still start twice.
const starting = new Map<string, Promise<ProcessStatus>>();

// Pid file path → the content proven that server's runtime; one map per process, as ./platform.
const shared = globalThis as { ontologyProvenRuntimes?: Map<string, string> };
const proven = (shared.ontologyProvenRuntimes ??= new Map<string, string>());

/** Whether the server's runtime is up: its pid is proven this server's and /healthz answers. */
export async function status(slug: string): Promise<ProcessStatus> {
  const file = await readPid(slug);
  if (!file || !(await owned(slug, file))) return { running: false, pid: null, port: null };
  return { running: await healthy(file.port), pid: file.pid, port: file.port };
}

/**
 * Starts the runtime on the server's tools.yaml, bound to 127.0.0.1 on a free port, with the
 * server's origins and hosts and the env file's secrets, and waits until /healthz answers.
 * Throws HostError 502 with the end of toolbox.log when it exits or never becomes ready.
 */
export function start(slug: string): Promise<ProcessStatus> {
  const key = pidPath(slug);
  const pending = starting.get(key);
  if (pending) return pending;
  const run = launch(slug).finally(() => starting.delete(key));
  starting.set(key, run);
  return run;
}

/** Stops the runtime if it is up and proven this server's; a pid not proven is left alone. */
export async function stop(slug: string): Promise<void> {
  const file = await readPid(slug);
  if (file && alive(file.pid)) {
    if (await owned(slug, file)) {
      signal(file.pid, "SIGTERM");
      for (let waited = 0; waited < 5_000 && alive(file.pid); waited += 100) await sleep(100);
      if (alive(file.pid)) signal(file.pid, "SIGKILL");
    } else {
      const line = `the console left pid ${file.pid} alone: it does not answer as this server`;
      await appendFile(logPath(slug), `--- ${new Date().toISOString()} ${line}\n`);
    }
  }
  proven.delete(pidPath(slug));
  await rm(pidPath(slug), { force: true });
}

/** The port of the running runtime, starting it first when the server is deployed but down. */
export async function ensureRunning(slug: string): Promise<number> {
  if (!(await serving(slug))) {
    throw new HostError(404, `No server is deployed at ${mcpPath(currentPlatform(), slug)}.`);
  }
  const pending = starting.get(pidPath(slug));
  const now = pending ? await pending : await status(slug);
  if (now.running && now.port !== null) return now.port;
  return (await start(slug)).port as number;
}

/** Whether the runtime was started with other origins, hosts, secrets or binary than now. */
export async function launchChanged(slug: string): Promise<boolean> {
  const [file, flags] = await Promise.all([readPid(slug), readFlags(slug)]);
  if (!file || !flags) return true;
  return file.launch !== launchStamp(flags.draft, await readEnv());
}

/**
 * Waits until the runtime answers for the toolset `mark`, which it does only after loading the
 * file that holds it. Throws HostError 502 with the end of toolbox.log when it never does.
 */
export async function confirmLoaded(slug: string, mark: string, waitMs = 10_000): Promise<void> {
  const now = await status(slug);
  if (!now.running || now.port === null) throw await failure(slug, "The runtime is not running");
  const deadline = Date.now() + waitMs;
  let last = "no answer yet";
  for (;;) {
    try {
      const message = await post(now.port, mark, { method: "tools/list" }, {}, 3_000);
      if (message.result !== undefined) return;
      last = message.error?.message ?? "an answer with neither a result nor an error";
    } catch (error) {
      last = reason(error);
    }
    if (Date.now() >= deadline) {
      const why = last.includes(NOT_LOADED) ? "it kept the file before" : last;
      throw await failure(slug, `The runtime did not load the new file (${mark}): ${why}`);
    }
    await sleep(250);
  }
}

/** The runtime's tools/list for one toolset. `forward` are headers to pass on, e.g. entra_token. */
export async function listTools(
  slug: string,
  toolset: string,
  forward: Record<string, string> = {},
): Promise<McpTool[]> {
  const result = await rpc(slug, toolset, "tools/list", undefined, forward);
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) throw new HostError(502, "The runtime’s tools/list held no tools.");
  return tools as McpTool[];
}

/** The runtime's tools/call for one tool of one toolset. A runtime error is a HostError 502. */
export async function callTool(
  slug: string,
  toolset: string,
  name: string,
  args: Record<string, unknown>,
  forward: Record<string, string> = {},
): Promise<McpToolResult> {
  const result = await rpc(slug, toolset, "tools/call", { name, arguments: args }, forward);
  if (!Array.isArray((result as { content?: unknown }).content)) {
    throw new HostError(502, `The runtime’s answer for ${name} held no content.`);
  }
  return result as McpToolResult;
}

/** The last `lines` lines of the runtime's own output. */
export async function logTail(slug: string, lines: number): Promise<string[]> {
  const handle = await open(logPath(slug), "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return [];
  try {
    // ponytail: reads the last 64 KiB only; a longer tail needs a backwards line reader.
    const { size } = await handle.stat();
    const length = Math.min(size, 65_536);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = mask(buffer.toString("utf8"), Object.values(await readEnv()));
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(-lines);
  } finally {
    await handle.close();
  }
}

/** The JSON-RPC message of a runtime answer, plain JSON or an event stream (old _parse_message). */
export function parseMessage(contentType: string | null, body: string): RpcMessage {
  let text = body;
  if (contentType?.includes("text/event-stream")) {
    const data = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    text = data.at(-1) ?? "{}";
  }
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch (error) {
    throw new HostError(502, `The runtime’s answer is not JSON: ${reason(error)}`);
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new HostError(502, "The runtime’s answer is not a JSON-RPC message.");
  }
  return message as RpcMessage;
}

/* ---------- inside ---------- */

async function launch(slug: string): Promise<ProcessStatus> {
  const flags = await readFlags(slug);
  if (!flags || (await readText(configPath(slug))) === null) {
    throw new HostError(404, `There is no saved server “${slug}”.`);
  }
  await stop(slug); // a hung or dead runtime leaves its pid file behind
  const env = await readEnv();
  const bin = toolboxBin();
  const port = await freePort();
  const { origins, hosts } = flags.draft;
  // A pattern such as *.x.dev is the gateway's to match; the runtime is only called from here.
  const exact = hosts.filter((host) => !host.includes("*"));
  const args = [
    "--config",
    configPath(slug),
    "--address",
    "127.0.0.1",
    "--port",
    String(port),
    // The host calls it as 127.0.0.1:<port>; the bare name too, in case it compares without one.
    `--allowed-hosts=${[...exact, `127.0.0.1:${port}`, "127.0.0.1"].join(",")}`,
    "--disable-version-check",
  ];
  if (origins.length > 0) args.push(`--allowed-origins=${origins.join(",")}`);

  await mkdir(dirname(logPath(slug)), { recursive: true });
  const child = spawnLogged(bin, args, env, logPath(slug), port);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => {
      reject(new HostError(502, `The runtime could not be run (${bin}): ${error.message}`));
    });
  });
  const where = pidPath(slug);
  const state: { exited: string | null; proof: string | null } = { exited: null, proof: null };
  child.once("exit", (code, sig) => {
    state.exited = code === null ? `it was stopped by ${sig}` : `it exited with code ${code}`;
    if (state.proof !== null && proven.get(where) === state.proof) proven.delete(where);
  });
  child.unref();
  const pid = child.pid as number;
  const file: PidFile = {
    pid,
    port,
    startedAt: new Date().toISOString(),
    launch: launchStamp(flags.draft, env),
  };
  await writeAtomic(where, JSON.stringify(file), 0o600);
  // Spawned here, so this pid is this server's for as long as the child lives.
  state.proof = proofOf(file);
  if (!state.exited) proven.set(where, state.proof);

  const deadline = Date.now() + READY_MS;
  while (!state.exited && Date.now() < deadline) {
    if (await healthy(port)) return { running: true, pid, port };
    await sleep(250);
  }
  const why = state.exited ?? `/healthz did not answer within ${READY_MS / 1000} s`;
  await stop(slug);
  throw await failure(slug, `The runtime did not start: ${why}`);
}

// Only PATH, HOME and the env file: the console's own environment holds the engine's key.
function spawnLogged(
  bin: string,
  args: string[],
  env: Record<string, string>,
  log: string,
  port: number,
): ChildProcess {
  const out = openSync(log, "a");
  try {
    writeSync(out, `--- ${new Date().toISOString()} the console starts the runtime on ${port}\n`);
    // The runtime pastes a value into a double-quoted YAML string before it parses its file.
    const childEnv: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
      childEnv[name] = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
    if (process.env.PATH) childEnv.PATH = process.env.PATH;
    if (process.env.HOME) childEnv.HOME = process.env.HOME;
    // Next's types require NODE_ENV in an environment; the runtime does not.
    const given = childEnv as NodeJS.ProcessEnv;
    return spawn(bin, args, { detached: true, stdio: ["ignore", out, out], env: given });
  } finally {
    closeSync(out); // the child holds its own copy
  }
}

// Changes when anything the runtime reads only at start changes; the pid file is 0600 for it.
function launchStamp(draft: HostServerDraft, env: Record<string, string>): string {
  const secrets = Object.entries(env).sort(([a], [b]) => (a < b ? -1 : 1));
  const input = JSON.stringify([toolboxBin(), draft.origins, draft.hosts, secrets]);
  return createHash("sha256").update(input).digest("hex");
}

async function rpc(
  slug: string,
  toolset: string,
  method: string,
  params: unknown,
  forward: Record<string, string>,
): Promise<object> {
  const port = await ensureRunning(slug);
  const message = await post(port, toolset, { method, params }, forward, CALL_MS);
  if (message.error) {
    throw new HostError(502, message.error.message ?? `The runtime refused ${method}.`);
  }
  if (!message.result || typeof message.result !== "object") {
    throw new HostError(502, `The runtime answered ${method} without a result.`);
  }
  return message.result;
}

async function post(
  port: number,
  toolset: string,
  call: { method: string; params?: unknown },
  forward: Record<string, string>,
  timeoutMs: number,
): Promise<RpcMessage> {
  const url = `http://127.0.0.1:${port}/mcp/${encodeURIComponent(toolset)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...forward,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new HostError(502, `The runtime does not answer on port ${port}: ${reason(error)}`);
  }
  const body = await response.text();
  try {
    return parseMessage(response.headers.get("content-type"), body);
  } catch {
    const words = body.trim().slice(0, 200) || "an empty body";
    throw new HostError(502, `The runtime answered ${response.status}: ${words}`);
  }
}

async function failure(slug: string, why: string): Promise<HostError> {
  const tail = await logTail(slug, 20);
  const end = tail.length > 0 ? tail.join("\n") : "(toolbox.log is empty)";
  return new HostError(502, `${why}. The end of toolbox.log:\n${end}`);
}

async function readPid(slug: string): Promise<PidFile | null> {
  const text = await readText(pidPath(slug));
  return text === null ? null : (JSON.parse(text) as PidFile);
}

const proofOf = (file: PidFile) => `${file.pid}:${file.port}:${file.startedAt}`;

// Spawned here, or its port answers for the mark in this server's tools.yaml; kept per pid file
// content, so a deploy's new mark does not un-prove it.
async function owned(slug: string, file: PidFile): Promise<boolean> {
  const where = pidPath(slug);
  if (!alive(file.pid)) {
    proven.delete(where);
    return false;
  }
  if (proven.get(where) === proofOf(file)) return true;
  const mark = await markOf(slug);
  if (mark === null) return false;
  try {
    const message = await post(file.port, mark, { method: "tools/list" }, {}, 2_000);
    if (message.result === undefined) return false;
  } catch {
    return false;
  }
  proven.set(where, proofOf(file));
  return true;
}

// The mark toolset tools.yaml ends with (renderConfig), or null without one.
async function markOf(slug: string): Promise<string | null> {
  const text = await readText(configPath(slug));
  const last = text === null ? undefined : parseConfig(text).at(-1);
  return last?.kind === "toolset" && last.name.startsWith(MARK) ? last.name : null;
}

// ponytail: a pid reused by another process looks alive; a proof already kept for the same pid
// file is not asked again, so reuse between two looks needs the process start time to catch.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The runtime leads its own process group (detached), so a wrapper and its child both go.
function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  }
}

async function healthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ponytail: the port is free only as this closes; another process may take it first, and the
// start then fails loudly with the runtime's bind error. A retry picks another.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
