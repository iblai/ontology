// Checks one MCP server from the outside, as an agent would call it:
//   MCP_AUTHORIZATION="Api-Token <key>" node scripts/mcp-smoke.mjs https://<host>/<platform>/<slug>/mcp
//
// --insecure   accept a certificate this machine does not trust (Caddy's own, on localhost)
// --origin=…   an Origin the server allows, sent on every call (default: none, as a native client)
//
// Without MCP_AUTHORIZATION only the refusals are checked. With it: the handshake, tools/list, and
// every search_… tool with the get_… that goes with it. It reads and never writes: the raw tools
// get `SELECT 1` and nothing else. Exits 1 if a check fails.

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
if (!url) {
  console.error(
    "usage: node scripts/mcp-smoke.mjs <server's /mcp address> [--insecure] [--origin=…]",
  );
  process.exit(2);
}
if (flag("insecure")) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const origin = flag("origin")?.split("=")[1] ?? null;
const authorization = process.env.MCP_AUTHORIZATION ?? null;

// The gateway allows 30 tool calls a minute per caller: stay under it.
const PACE_MS = 2100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let id = 0;
let lastCall = 0;
async function post(body, { auth = authorization, from = origin } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  if (from) headers.origin = from;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // an empty 202, or a refusal that is not JSON
  }
  return { status: response.status, json, text };
}
const rpc = (method, params) => post({ jsonrpc: "2.0", id: ++id, method, params });
async function call(name, toolArgs = {}) {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  return rpc("tools/call", { name, arguments: toolArgs });
}

// One content per row, each a JSON text.
function rows(answer) {
  const content = answer.json?.result?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    try {
      const value = JSON.parse(part.text);
      return Array.isArray(value) ? value : [value];
    } catch {
      return [];
    }
  });
}
const failure = (answer) =>
  answer.status !== 200
    ? `HTTP ${answer.status} ${answer.text.slice(0, 120)}`
    : answer.json?.error
      ? `error ${answer.json.error.code}: ${answer.json.error.message}`
      : answer.json?.result?.isError
        ? answer.json.result.content
            .map((c) => c.text)
            .join(" ")
            .slice(0, 160)
        : null;

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
}

const list = { jsonrpc: "2.0", id: 0, method: "tools/list" };

// 1. The refusals, which need no credential.
const bare = await post(list, { auth: null });
check("no credential is refused", bare.status === 401, `HTTP ${bare.status}`);
const bogus = await post(list, { auth: "Api-Token not-a-key" });
check("a made-up key is refused", bogus.status === 401, `HTTP ${bogus.status}`);
const stranger = await post(list, { auth: null, from: "https://not-allowed.invalid" });
check("an origin off the list is refused", stranger.status === 403, `HTTP ${stranger.status}`);
const get = await fetch(url);
check("GET is not allowed", get.status === 405, `HTTP ${get.status}`);

if (!authorization) {
  console.log("\nMCP_AUTHORIZATION is not set: the handshake and the tools were not checked.");
  process.exit(failed ? 1 : 0);
}

// 2. The handshake.
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1" },
});
const server = init.json?.result?.serverInfo?.name;
check("initialize", !failure(init) && !!server, failure(init) ?? server);
const ready = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
check("a notification gets 202", ready.status === 202, `HTTP ${ready.status}`);
const unknown = await rpc("no/such/method");
check("an unknown method is -32601", unknown.json?.error?.code === -32601);

// 3. The tools this credential reaches.
const listed = await rpc("tools/list");
const tools = listed.json?.result?.tools ?? [];
check(
  "tools/list",
  !failure(listed) && tools.length > 0,
  failure(listed) ?? `${tools.length} tools`,
);
const shaped = tools.filter((t) => t.inputSchema?.type === "object" && t.description);
check("every tool has a description and a schema", shaped.length === tools.length);
const names = new Set(tools.map((t) => t.name));
const takes = (tool, key) => Object.hasOwn(tool.inputSchema?.properties ?? {}, key);

// 4. Each search_… tool, then the get_… of the same term on the first row it returned.
for (const tool of tools.filter((t) => t.name.startsWith("search_") && takes(t, "limit"))) {
  const found = await call(tool.name, { limit: 3 });
  const got = rows(found);
  check(tool.name, !failure(found), failure(found) ?? `${got.length} rows`);
  const one = `get_${tool.name.slice("search_".length).replace(/s$/, "")}`;
  if (!names.has(one) || got.length === 0 || got[0].id === undefined) continue;
  const fetched = await call(one, { id: got[0].id });
  const same = rows(fetched).length === 1 && String(rows(fetched)[0].id) === String(got[0].id);
  check(one, !failure(fetched) && same, failure(fetched) ?? `id ${got[0].id}`);
}

// 5. The gateway's own tools and the raw ones, read-only.
if (names.has("search_terms")) {
  const terms = await call("search_terms", { query: "id" });
  check("search_terms", !failure(terms), failure(terms) ?? `${rows(terms).length} terms`);
}
for (const tool of tools.filter((t) => t.name.endsWith("_list_tables"))) {
  const tables = await call(tool.name);
  check(tool.name, !failure(tables), failure(tables) ?? `${rows(tables).length} tables`);
}
for (const tool of tools.filter((t) => t.name.endsWith("_execute_sql"))) {
  const one = await call(tool.name, { sql: "SELECT 1 AS one" });
  check(tool.name, !failure(one) && rows(one).length === 1, failure(one) ?? "SELECT 1");
}

// 6. What a caller may not do.
const outside = await call("no_such_tool");
check("a tool it does not hold is -32003", outside.json?.error?.code === -32003);

console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check passed.");
process.exit(failed ? 1 : 0);
