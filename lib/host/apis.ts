// Custom HTTP APIs: rules, the documents they become, and apis.yaml. Ported from http_api.py.

import { parse, stringify } from "yaml";
import { apiAddress } from "./address";
import { HostError } from "./errors";
import { assertName, envName, homePath, readText, setEnv, writeAtomic } from "./files";
import { SEMANTIC_TOOLS } from "./semantic";
import { toolsetDoc, type ToolboxDoc } from "./toolbox-config";
import type { HostApi, HostApiEndpoint, HostApiInput, HostApiMethod, HostSpec } from "./types";

/** An API as kept in apis.yaml. The secret itself is in the env file under `secretEnv`. */
export type StoredApi = HostApi & { secretEnv: string | null; private: boolean; local: boolean };

export const METHODS: HostApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const BODIES = ["POST", "PUT", "PATCH"]; // the methods a JSON body goes with
const TIMEOUT = "20s"; // the runtime's, under the gateway's own wait for a call
export const TOOL_NAME_MAX = 64; // what an agent's model takes for a tool's name
const NOTE_MAX = 300; // characters of what a parameter means
// The private networks an API inside one may reach; loopback is LOOPBACK, link-local in neither.
const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];
// This machine, which an API on it may reach (when apiAddress takes it: see its rule).
const LOOPBACK = ["127.0.0.0/8", "::1/128"];
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
// The request's own headers, never a key's.
const OWN_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "connection",
  "transfer-encoding",
  "user-agent",
]);
const ENV_REF = /^(?:([A-Za-z][A-Za-z0-9-]*) )?\$\{([A-Z0-9_]+)\}$/;
const SCHEME = /^([A-Za-z][A-Za-z0-9-]*) +(\S.*)$/;
const TOOL = /^[a-z][a-z0-9_-]*$/;
// A value in a path as it is entered, `{id}`.
const PLACE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const SEGMENT = /^(?:[A-Za-z0-9._~-]|\{[A-Za-z][A-Za-z0-9_]*\})+$/;
const QUERY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

const bad = (message: string) => new HostError(400, message);

/**
 * Checks an API against the old product's rules (name, address, header, each endpoint) and
 * splits the secret out of the auth header. Throws HostError 400 with the rule's own words.
 */
export async function checkApi(
  input: HostApiInput,
): Promise<{ api: StoredApi; secret: string | null }> {
  const name = assertName(input.name.trim());
  const { address, private: inside, local } = await apiAddress(input.baseUrl);
  const header = splitHeader(input.authHeader, envName(name, "API_KEY"));
  const endpoints = input.endpoints.map(checkEndpoint);
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.name)) throw bad(`Two endpoints are named ${endpoint.name}.`);
    seen.add(endpoint.name);
  }
  const api: StoredApi = {
    name,
    baseUrl: address,
    authHeader: header.stored,
    endpoints,
    tools: endpoints.length,
    secretEnv: header.env,
    private: inside,
    local,
  };
  return { api, secret: header.secret };
}

/**
 * The header Fetch Spec sends with the document's request: the API's auth header, only when the
 * document is on the base URL's origin, a ${NAME} read from `env`. `withheld`: given, not sent.
 * Throws HostError 400 by the save's rules, or naming a ${NAME} that `env` lacks.
 */
export function specHeader(
  url: string,
  baseUrl: string,
  authHeader: string,
  env: Record<string, string>,
): { headers: Record<string, string>; withheld: boolean } {
  if (!authHeader.trim()) return { headers: {}, withheld: false };
  const origin = originOf(url);
  if (!origin || origin !== originOf(baseUrl)) return { headers: {}, withheld: true };
  const full = fullHeader(authHeader);
  splitHeader(full, "KEY");
  const colon = full.indexOf(":");
  const value = full.slice(colon + 1).trim();
  const ref = ENV_REF.exec(value);
  const secret = ref ? env[ref[2]] : value;
  if (ref && !secret) throw bad(`${ref[2]} is not in this platform’s secrets.`);
  const sent = ref?.[1] ? `${ref[1]} ${secret}` : secret;
  return { headers: { [full.slice(0, colon).trim()]: sent }, withheld: false };
}

// A value alone is the value of Authorization, as entered.
const fullHeader = (header: string) =>
  header.includes(":") ? header : `Authorization: ${header.trim()}`;

function originOf(address: string): string | null {
  try {
    const { origin } = new URL(address.trim());
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** Why a request for a document came to nothing: its status, or why there was no answer. */
export type SpecMiss = { status: number } | { reason: string };

const SPEC_TRIES = 3; // with the auth header: once, then twice more

/**
 * Asks for a document with the auth header up to three times, then once without it. `withAuth`
 * is why the header's requests failed, when the last word came from the request without it.
 */
export async function askForSpec(
  get: (headers: Record<string, string>) => Promise<Response | SpecMiss>,
  headers: Record<string, string>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<{ got: Response | SpecMiss; withAuth: SpecMiss | null }> {
  let withAuth: SpecMiss | null = null;
  if (Object.keys(headers).length > 0) {
    for (let n = 0; n < SPEC_TRIES; n++) {
      if (n > 0) await pause(300 * n);
      const got = await get(headers);
      if (got instanceof Response) return { got, withAuth: null };
      withAuth = got;
    }
  }
  return { got: await get({}), withAuth };
}

// "Name: [Scheme ]<secret>" → "Name: [Scheme ]${ENV}" and the secret; a ${NAME} is kept as is.
function splitHeader(
  header: string,
  env: string,
): { stored: string; secret: string | null; env: string | null } {
  if (!header.trim()) return { stored: "", secret: null, env: null };
  const full = fullHeader(header);
  const colon = full.indexOf(":");
  const name = full.slice(0, colon).trim();
  const value = full.slice(colon + 1).trim();
  if (!HEADER.test(name) || OWN_HEADERS.has(name.toLowerCase())) {
    throw bad(`“${name}” is not a header a key goes in.`);
  }
  if (!value) throw bad(`The ${name} header has no key.`);
  const ref = ENV_REF.exec(value);
  if (ref) return { stored: `${name}: ${value}`, secret: null, env: ref[2] };
  if (value.includes("${")) throw bad("A key is written as itself or as ${NAME}, nothing between.");
  const scheme = SCHEME.exec(value);
  const secret = scheme ? scheme[2] : value;
  // The runtime puts the key inside a double-quoted value of its file.
  const unfit = [...secret].some((c) => c < " " || c === "\u007f" || c === '"' || c === "\\");
  if (unfit) {
    throw bad("The key holds a character no header carries, a quote or a backslash.");
  }
  const stored = `${name}: ${scheme ? `${scheme[1]} ` : ""}\${${env}}`;
  return { stored, secret, env };
}

// An endpoint as it is kept, or why not: one wrong entry stops the whole runtime.
function checkEndpoint(entered: HostApiEndpoint): HostApiEndpoint {
  const name = entered.name.trim();
  if (!TOOL.test(name) || name.length > TOOL_NAME_MAX) {
    throw bad(
      "An endpoint’s name is lowercase letters, digits, _ and -, starting with a letter, " +
        `${TOOL_NAME_MAX} characters at most: ${name || "(none)"}`,
    );
  }
  if (SEMANTIC_TOOLS.some((tool) => tool.name === name)) {
    throw bad(`A tool named ${name} exists already: name the endpoint something else.`);
  }
  const method = entered.method.toUpperCase() as HostApiMethod;
  if (!METHODS.includes(method)) throw bad(`An endpoint’s method is one of ${METHODS.join(", ")}.`);
  // The form has no description field: an endpoint says its request line.
  const description = words(entered.description) || `${method} ${entered.path.trim()}`;
  if (description.includes("${")) {
    throw bad(
      `Say what ${name} does, without '\${': the runtime reads that as a setting of its own.`,
    );
  }
  const path = entered.path.trim();
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  if (
    !path.startsWith("/") ||
    !segments.every((segment) => SEGMENT.test(segment)) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw bad(
      "A path starts with / and holds plain segments and {name} for a value: " +
        "/invoices/{invoice_id}/notes",
    );
  }
  const query = entered.query.map((q) => q.trim()).filter(Boolean);
  const names = [
    ...new Set(placesOf(path)),
    ...query,
    ...(BODIES.includes(method) ? ["body"] : []),
  ].map((n) => n.toLowerCase());
  if (!query.every((q) => QUERY.test(q)) || new Set(names).size !== names.length) {
    throw bad(
      "A query name is letters, digits, '_', '.' and '-', and repeats no name in the path " +
        "or 'body'.",
    );
  }
  const notes: Record<string, string> = {};
  for (const [param, said] of Object.entries(entered.notes ?? {})) {
    const kept = noteOf(said);
    // Kept for a parameter this endpoint has; a note for any other is dropped.
    if (kept && (query.includes(param) || placesOf(path).includes(param))) notes[param] = kept;
  }
  return {
    name,
    method,
    path,
    description,
    query,
    ...(Object.keys(notes).length ? { notes } : {}),
  };
}

const placesOf = (path: string) => [...path.matchAll(PLACE)].map((match) => match[1]);

/**
 * The documents one API becomes: sources `<name>-reads` and `<name>-writes`, one tool per
 * endpoint, and the toolsets `<name>-reads` and `<name>-writes` (only those that have tools).
 */
export function apiDocs(api: StoredApi): ToolboxDoc[] {
  // One address twice, so a read never runs where a change does.
  const sides = [`${api.name}-reads`, `${api.name}-writes`];
  const tools = api.endpoints.map((endpoint) =>
    toolOf(endpoint, endpoint.method === "GET" ? sides[0] : sides[1]),
  );
  const colon = api.authHeader.indexOf(":");
  const headers =
    colon < 0
      ? undefined
      : { [api.authHeader.slice(0, colon).trim()]: api.authHeader.slice(colon + 1).trim() };
  const ranges = [...(api.private ? PRIVATE : []), ...(api.local ? LOOPBACK : [])];
  const sources: ToolboxDoc[] = [];
  const toolsets: ToolboxDoc[] = [];
  for (const side of sides) {
    const mine = tools.filter((tool) => tool.source === side).map((tool) => tool.name);
    if (!mine.length) continue;
    sources.push({
      kind: "source",
      name: side,
      type: "http",
      baseUrl: api.baseUrl,
      timeout: TIMEOUT,
      // A refusal reaches the agent in the API's own words.
      returnFullError: true,
      ...(headers ? { headers } : {}),
      ...(ranges.length ? { allowedIpRanges: ranges } : {}),
    });
    toolsets.push(toolsetDoc(side, mine));
  }
  return [...sources, ...tools, ...toolsets];
}

// An endpoint as the runtime's http tool on the API's source for its kind.
function toolOf(endpoint: HostApiEndpoint, source: string): ToolboxDoc {
  const doc: ToolboxDoc = {
    kind: "tool",
    name: endpoint.name,
    type: "http",
    source,
    description: endpoint.description,
    method: endpoint.method,
    // Under the address, and each value escaped: a "/" in one stays part of the value.
    path: endpoint.path.replace(/^\/+/, "").replace(PLACE, "{{pathEscape .$1}}"),
  };
  const values = [...new Set(placesOf(endpoint.path))];
  if (values.length) {
    doc.pathParams = values.map((v) => ({
      name: v,
      type: "string",
      description: endpoint.notes?.[v] ?? v.replaceAll("_", " "),
    }));
  }
  if (endpoint.query.length) {
    doc.queryParams = endpoint.query.map((q) => ({
      name: q,
      type: "string",
      description: endpoint.notes?.[q] ?? q.replaceAll("_", " "),
      required: false,
    }));
  }
  if (BODIES.includes(endpoint.method)) {
    // The runtime sends no content type by itself.
    doc.headers = { "Content-Type": "application/json" };
    doc.bodyParams = [
      { name: "body", type: "map", description: "The JSON body to send, as one object." },
    ];
    doc.requestBody = "{{json .body}}";
  }
  return doc;
}

/** Every API in apis.yaml; an absent file is none. */
export async function listApis(): Promise<StoredApi[]> {
  const text = await readText(homePath("apis.yaml"));
  if (text === null) return [];
  const value: unknown = parse(text);
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HostError(500, "apis.yaml is not a list of APIs.");
  // An API saved before `local` was kept is not on this machine.
  return (value as StoredApi[]).map((api) => ({ ...api, local: api.local === true }));
}

/** Checks, writes the secret to the env file and the API to apis.yaml (replacing its name). */
export async function saveApi(input: HostApiInput): Promise<HostApi> {
  const { api, secret } = await checkApi(input);
  const apis = await listApis();
  const taken = new Set(
    apis.filter((other) => other.name !== api.name).flatMap((o) => o.endpoints.map((e) => e.name)),
  );
  const clash = api.endpoints.find((endpoint) => taken.has(endpoint.name));
  if (clash)
    throw bad(`A tool named ${clash.name} exists already: name the endpoint something else.`);
  if (secret !== null && api.secretEnv) await setEnv(api.secretEnv, secret);
  const at = apis.findIndex((other) => other.name === api.name);
  const next = at < 0 ? [...apis, api] : apis.map((other, i) => (i === at ? api : other));
  await writeAtomic(homePath("apis.yaml"), stringify(next));
  const { name, baseUrl, authHeader, endpoints, tools } = api;
  return { name, baseUrl, authHeader, endpoints, tools };
}

/** The operations of a parsed OpenAPI 3 or Swagger 2 document, as endpoints to choose from. */
export function endpointsFromSpec(doc: unknown): HostSpec {
  const openapi = isRecord(doc) && typeof doc.openapi === "string" && doc.openapi.startsWith("3.");
  const swagger = isRecord(doc) && doc.swagger === "2.0";
  if (!isRecord(doc) || !(openapi || swagger) || !isRecord(doc.paths)) {
    throw bad("That is not an OpenAPI 3 or Swagger 2 document with paths.");
  }
  const title = isRecord(doc.info) && typeof doc.info.title === "string" ? doc.info.title : "";
  const taken = new Set<string>();
  const endpoints: HostApiEndpoint[] = [];
  for (const [path, item] of Object.entries(doc.paths as Record<string, unknown>)) {
    if (!isRecord(item)) continue;
    const shared = paramsOf(doc, item.parameters);
    for (const [key, op] of Object.entries(item)) {
      const method = key.toUpperCase() as HostApiMethod;
      if (!METHODS.includes(method) || !isRecord(op)) continue;
      const id = typeof op.operationId === "string" ? op.operationId.trim() : "";
      const params = [...shared, ...paramsOf(doc, op.parameters)].filter(
        (param) => typeof param.name === "string",
      );
      const query = params.filter((p) => p.in === "query").map((p) => p.name as string);
      const notes: Record<string, string> = {};
      for (const param of params) {
        const said = noteOf(param.description);
        if (said && (param.in === "query" || param.in === "path")) {
          notes[param.name as string] = said;
        }
      }
      endpoints.push({
        name: unique(snake(id || `${key} ${path}`), taken),
        method,
        path,
        description: words(op.summary) || words(op.description) || `${method} ${path}`,
        query: [...new Set(query)],
        ...(Object.keys(notes).length ? { notes } : {}),
      });
    }
  }
  return { title, endpoints };
}

// A list of parameters, each a local $ref resolved once.
function paramsOf(root: Record<string, unknown>, value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((param) => resolve(root, param)).filter(isRecord);
}

function resolve(root: Record<string, unknown>, value: unknown): unknown {
  const ref = isRecord(value) ? value.$ref : undefined;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return value;
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(node)) return null;
    node = node[part.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return node;
}

// Lowercase snake_case, starting with a letter, TOOL_NAME_MAX characters at most.
function snake(text: string): string {
  const name = text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  const lead = /^[a-z]/.test(name) ? name : `op_${name}`;
  return lead.slice(0, TOOL_NAME_MAX).replace(/_+$/, "");
}

function unique(name: string, taken: Set<string>): string {
  let kept = name;
  for (let n = 2; taken.has(kept); n++) {
    kept = `${name.slice(0, TOOL_NAME_MAX - String(n).length - 1)}_${n}`;
  }
  taken.add(kept);
  return kept;
}

const words = (value: unknown) =>
  typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ") : "";

// One line a tool can carry: the runtime would read "${" as a setting of its own.
const noteOf = (value: unknown) => words(value).replaceAll("${", "$ {").slice(0, NOTE_MAX);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
