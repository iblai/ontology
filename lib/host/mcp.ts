// The gateway's JSON-RPC: what a caller may see and call on one server. Ported from the old
// product's mcp_server/handlers.py, toolsets.py and ratelimit.py.

import pkg from "@/package.json";
import { SIGNED_HEADER, listApis } from "./apis";
import type { Caller } from "./dm";
import { HostError } from "./errors";
import { readEnv } from "./files";
import type { Scope } from "./grants";
import { callLocal, filesTools } from "./local";
import { record } from "./log";
import { forget, forgetsOf, liveTokens, tokenFor } from "./oauth";
import { agentName } from "./openapi";
import { SEMANTIC_TOOLS, SEMANTIC_TOOLSET, callSemantic, semanticReady } from "./semantic";
import type { Serving } from "./servers";
import { callTool, ensureRunning, listTools } from "./toolbox";
import type { McpTool, McpToolResult } from "./types";

/** Echoed back unless the client names its own. */
export const PROTOCOL_VERSION = "2025-03-26";

export const RPC = {
  methodNotFound: -32601,
  invalidRequest: -32600,
  outOfScope: -32003,
  runtime: -32000,
} as const;

export type RpcContext = {
  slug: string;
  caller: Caller;
  serving: Serving;
  origin: string | null;
  agent: string | null; // the label the connection's URL carries (?agent=)
  forward: Record<string, string>; // <authService>_token headers to pass to the runtime
};

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const SEMANTIC_NAMES = new Set(SEMANTIC_TOOLS.map((t) => t.name));

/**
 * One JSON-RPC message in, its response out; null for a notification. Handles initialize, ping,
 * tools/list and tools/call. An unknown method is -32601, a tool outside the caller's scope
 * -32003, a runtime error -32000; any other failure of a tool is a result with isError.
 * Every tools/call and every refusal is recorded in the server's gateway log.
 */
export async function handleMessage(ctx: RpcContext, message: unknown): Promise<unknown | null> {
  if (!isObject(message)) {
    return reply(null, undefined, new RpcError(RPC.invalidRequest, "invalid JSON-RPC message"));
  }
  const { method, id } = message;
  const params = isObject(message.params) ? message.params : {};
  if (typeof method === "string" && method.startsWith("notifications/")) return null;
  try {
    if (method === "initialize") {
      const version = params.protocolVersion;
      return reply(id, {
        // Echo the client's revision: this surface is the same under every one.
        protocolVersion: typeof version === "string" && version ? version : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: `ontology-${ctx.slug}`, version: pkg.version },
      });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, await masked({ tools: await listFor(ctx) }));
    if (method === "tools/call") return reply(id, await masked(await callFor(ctx, params)));
    const named = typeof method === "string" ? method : "none";
    throw new RpcError(RPC.methodNotFound, `unknown method: ${named}`);
  } catch (error) {
    if (error instanceof RpcError) return reply(id, undefined, error);
    // The runtime's refusal, or a failure outside a tool; its words may hold a secret.
    const words = error instanceof Error ? error.message : String(error);
    return reply(id, undefined, new RpcError(RPC.runtime, mask(words, await secrets())));
  }
}

/**
 * The server's toolsets this caller may use. A platform admin is lent every one. `allToolsets`
 * lends every toolset that only reads, a filesystem's among them; a toolset that writes is
 * otherwise lent only by name.
 */
export function lentToolsets(scope: Scope, serving: Serving): string[] {
  const offered = Object.keys(serving.members);
  // Served here, so it has no document in tools.yaml.
  if (offersSemantic(serving) && !offered.includes(SEMANTIC_TOOLSET)) {
    offered.push(SEMANTIC_TOOLSET);
  }
  return offered.filter(
    (t) =>
      scope.everything ||
      scope.toolsets.includes(t) ||
      (scope.allToolsets && !serving.writes.includes(t)),
  );
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_TOOL_CALLS = 30;
// ponytail: per-process windows, capped at 10k callers (oldest dropped); a shared store if several
// processes serve one host.
const MAX_CALLERS = 10_000;
const windows = { requests: new Map<string, number[]>(), toolCalls: new Map<string, number[]>() };

/** Counts one request against the caller: 120 a minute, 30 tools/call a minute. HostError 429. */
export function checkRate(callerHash: string, isToolCall: boolean, now = Date.now()): void {
  // As the old limiter did: a tools/call counts against its own window only.
  const seen = isToolCall ? windows.toolCalls : windows.requests;
  const limit = isToolCall ? MAX_TOOL_CALLS : MAX_REQUESTS;
  const times = (seen.get(callerHash) ?? []).filter((t) => now - t < WINDOW_MS);
  seen.delete(callerHash); // re-inserted below, so the map stays ordered oldest caller first
  if (seen.size >= MAX_CALLERS) seen.delete(seen.keys().next().value as string);
  if (times.length >= limit) {
    seen.set(callerHash, times);
    throw new HostError(429, "rate limit exceeded");
  }
  times.push(now);
  seen.set(callerHash, times);
}

/** `text` with every secret of the env file replaced by ********. */
export function mask(text: string, secrets: string[]): string {
  // Longest first, so a secret inside another cannot leave the rest of the longer one showing.
  const kept = secrets.filter((s) => s.length >= 6).sort((a, b) => b.length - a.length);
  return kept.reduce((masked, secret) => masked.split(secret).join("********"), text);
}

/** Whether a Host header's name is on a server's list: a name, `*.name` (any name under it), `*`. */
export function hostAllowed(host: string, allowed: string[]): boolean {
  const asked = host.toLowerCase();
  return allowed.some((entry) => {
    const name = entry.toLowerCase();
    if (name === "*") return true;
    // "*.x.dev" keeps ".x.dev", and something must stand before that dot.
    if (name.startsWith("*."))
      return asked.length > name.length - 1 && asked.endsWith(name.slice(1));
    return asked === name;
  });
}

const LOOPBACK_ORIGINS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether an Origin may call a server: one on its list, or a page served from this machine. */
export function originAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.some((entry) => entry.replace(/\/+$/, "") === origin)) return true;
  return URL.canParse(origin) && LOOPBACK_ORIGINS.has(new URL(origin).hostname);
}

/* ---------- the two tool methods ---------- */

// The caller's tools: each lent toolset's, the gateway's own, then any held by its own name.
async function listFor(ctx: RpcContext): Promise<McpTool[]> {
  const { caller, serving, slug, forward } = ctx;
  const lent = lentToolsets(caller.scope, serving);
  const mine = (t: string) => serving.files.includes(t); // a filesystem's: answered here
  const served = lent.filter(
    (t) => t !== SEMANTIC_TOOLSET && !mine(t) && serving.members[t]?.length,
  );
  const files = lent.filter(mine);
  const held = new Map<string, string[]>(); // toolset → tools held by name from it
  for (const name of caller.scope.tools) {
    const lentAlready = [...served, ...files].some((t) => serving.members[t].includes(name));
    if (SEMANTIC_NAMES.has(name) || lentAlready) continue;
    const toolset = holder(serving, name);
    if (toolset) held.set(toolset, [...(held.get(toolset) ?? []), name]);
  }

  const tools = new Map<string, McpTool>();
  const add = (list: McpTool[], only?: string[]) => {
    for (const tool of list) {
      if (tools.has(tool.name) || (only && !only.includes(tool.name))) continue;
      tools.set(tool.name, forAgent(tool, serving));
    }
  };
  // The runtime is started only for a toolset it serves.
  if (served.length || [...held.keys()].some((t) => !mine(t))) await ensureRunning(slug);
  for (const toolset of served) add(await listTools(slug, toolset, forward));
  for (const toolset of files) add(filesTools(toolset));
  // The gateway's own three tools, only while the engine holds a semantic layer to answer from.
  const all = lent.includes(SEMANTIC_TOOLSET);
  if ((all || offersSemantic(serving)) && (await semanticReady())) {
    add(SEMANTIC_TOOLS, all ? undefined : caller.scope.tools);
  }
  for (const [toolset, names] of held) {
    add(mine(toolset) ? filesTools(toolset) : await listTools(slug, toolset, forward), names);
  }
  return [...tools.values()];
}

async function callFor(ctx: RpcContext, params: Record<string, unknown>): Promise<McpToolResult> {
  const { caller, serving, slug, forward } = ctx;
  const name = params.name;
  if (typeof name !== "string" || !name) {
    throw new RpcError(RPC.invalidRequest, "tools/call needs the tool's name");
  }
  const args = isObject(params.arguments) ? params.arguments : {};
  const lent = lentToolsets(caller.scope, serving);
  const byName = caller.scope.tools.includes(name);

  let toolset: string | null;
  if (SEMANTIC_NAMES.has(name)) {
    const reached = lent.includes(SEMANTIC_TOOLSET) || (byName && offersSemantic(serving));
    toolset = reached ? SEMANTIC_TOOLSET : null;
  } else {
    const lending = lent.find((t) => t !== SEMANTIC_TOOLSET && serving.members[t]?.includes(name));
    toolset = lending ?? (byName ? holder(serving, name) : null);
  }
  if (!toolset) {
    const text = `mcp tools/call ${name} → 404 tool not in toolset "${lent.join(",")}"`;
    await record(slug, "INFO", text);
    throw new RpcError(RPC.outOfScope, `${name} is not in a toolset you hold on ${slug}`);
  }

  const started = Date.now();
  let result: McpToolResult | null = null;
  try {
    if (toolset === SEMANTIC_TOOLSET) {
      result = await callSemantic(name, args);
    } else if (serving.files.includes(toolset)) {
      result = await callLocal(toolset, name, args);
    } else {
      await ensureRunning(slug);
      const api = Object.hasOwn(serving.signed, name) ? serving.signed[name] : undefined;
      const named = withDollars(args, dollarsOf(serving, name));
      // The header is the gateway's to set: what a caller sent in its place is dropped.
      const sent = api ? { ...named, [SIGNED_HEADER]: await bearerOf(api) } : named;
      result = await callTool(slug, toolset, name, sent, forward);
      // The API refused the token: the next call asks for a new one.
      if (api && result.isError && result.content.some((part) => REFUSED.test(part.text))) {
        forget(api);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof HostError) throw error; // the runtime's own refusal: -32000
    // A tool that failed is a result the agent can read, not a failure that drops every tool.
    const words = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    result = { content: [{ type: "text", text: words }], isError: true };
    return result;
  } finally {
    const ms = Date.now() - started;
    const ok = result !== null && !result.isError;
    const text = `mcp tools/call ${name} origin=${ctx.origin ?? "-"} ${ms}ms ${ok ? 200 : 500}`;
    await record(slug, ok ? "INFO" : "ERROR", text, {
      tool: name,
      agent: ctx.agent ?? "—",
      user: caller.username ?? "—",
      session: "—",
      status: ok ? "ok" : "error",
      ms,
    });
  }
}

/* ---------- small parts ---------- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const offersSemantic = (serving: Serving) => serving.draft.toolsets.includes(SEMANTIC_TOOLSET);

// A toolset of this server that holds the tool, for a tool held by its own name.
const holder = (serving: Serving, name: string): string | null =>
  Object.keys(serving.members).find((t) => serving.members[t].includes(name)) ?? null;

function reply(id: unknown, result: unknown, error?: RpcError) {
  const answer = { jsonrpc: "2.0", id: id ?? null };
  return error
    ? { ...answer, error: { code: error.code, message: error.message } }
    : { ...answer, result };
}

// The runtime's words for an API that answered 401.
const REFUSED = /unexpected status code: 401\b/;

// A tool as a caller sees it: without the header the gateway sets, and each $name without its $.
function forAgent(tool: McpTool, serving: Serving): McpTool {
  const signed = Object.hasOwn(serving.signed, tool.name);
  const dollars = dollarsOf(serving, tool.name);
  if (!signed && !dollars.length) return tool;
  const kept = (name: string) => !(signed && name === SIGNED_HEADER);
  const shown = (name: string) => (dollars.includes(name) ? agentName(name) : name);
  const properties = Object.fromEntries(
    Object.entries(tool.inputSchema.properties ?? {})
      .filter(([name]) => kept(name))
      .map(([name, value]) => [shown(name), value]),
  );
  const required = tool.inputSchema.required?.filter(kept).map(shown);
  return {
    ...tool,
    inputSchema: { ...tool.inputSchema, properties, ...(required ? { required } : {}) },
  };
}

// The tool's $ query names, as the server's tools.yaml declares them.
const dollarsOf = (serving: Serving, tool: string) =>
  Object.hasOwn(serving.dollars, tool) ? serving.dollars[tool] : [];

// A caller's arguments with each $name given back its $.
function withDollars(args: Record<string, unknown>, dollars: string[]): Record<string, unknown> {
  const sent = { ...args };
  for (const name of dollars) {
    const shown = agentName(name);
    if (!Object.hasOwn(sent, shown)) continue;
    sent[name] = sent[shown];
    delete sent[shown];
  }
  return sent;
}

// "Bearer <token>" for an OAuth API's tool. A plain Error: the agent reads why there is none.
async function bearerOf(name: string): Promise<string> {
  try {
    // Counted before the API is read: a sign-in changed meanwhile leaves no token kept.
    const since = forgetsOf(name);
    const api = (await listApis()).find((kept) => kept.name === name);
    if (!api?.oauth) {
      throw new Error(`${name} no longer signs in with OAuth: save this server again.`);
    }
    return `Bearer ${await tokenFor({ name, baseUrl: api.baseUrl, oauth: api.oauth, since })}`;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

// The env file's values and the tokens kept, which an answer or the runtime's words may echo.
async function secrets(): Promise<string[]> {
  return [...Object.values(await readEnv()), ...liveTokens()];
}

// Every string in an answer, masked.
async function masked<T>(value: T): Promise<T> {
  const kept = await secrets();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return mask(v, kept);
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
