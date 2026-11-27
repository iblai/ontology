// Custom HTTP APIs: rules, the documents they become, and apis.yaml. Ported from http_api.py.

import { parse, stringify } from "yaml";
import { apiAddress } from "./address";
import { HostError } from "./errors";
import {
  assertName,
  envName,
  homePath,
  inTurn,
  readEnv,
  readText,
  setEnv,
  writeAtomic,
} from "./files";
import { forget, requestToken, tokenUrlOf } from "./oauth";
import {
  BODIES,
  METHODS,
  PLACE,
  QUERY,
  TOOL_NAME_MAX,
  agentName,
  endpointsFromSpec as fromSpec,
  namesApart,
  noteOf,
  pathFits,
  placesOf,
  words,
} from "./openapi";
import { SEMANTIC_TOOLS } from "./semantic";
import { toolsetDoc, type ToolboxDoc } from "./toolbox-config";
import type {
  HostApi,
  HostApiEndpoint,
  HostApiInput,
  HostApiMethod,
  HostApiOAuth,
  HostApiOAuthInput,
  HostSpec,
} from "./types";

export { METHODS, TOOL_NAME_MAX };

/** An API as kept in apis.yaml. The secret itself is in the env file under `secretEnv`. */
export type StoredApi = HostApi & { secretEnv: string | null; private: boolean; local: boolean };

/** What an OAuth API's secrets are, as entered: "" keeps the one the env file holds. */
type OAuthSecrets = { clientSecret: string; refreshToken: string };

const TIMEOUT = "20s"; // the runtime's, under the gateway's own wait for a call
/** The header the gateway sets on every call of an OAuth API's tool. */
export const SIGNED_HEADER = "Authorization";
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
const GRANTS = ["client_credentials", "refresh_token"];
// A client ID or a scope: one line of printable characters.
const ONE_LINE = /^[\x20-\x7e]*$/;

const bad = (message: string) => new HostError(400, message);

/**
 * Checks an API against the old product's rules (name, address, header or OAuth, each endpoint)
 * and splits its secrets out. Throws HostError 400 with the rule's own words.
 */
export async function checkApi(
  input: HostApiInput,
): Promise<{ api: StoredApi; secret: string | null; oauth: OAuthSecrets | null }> {
  const name = assertName(input.name.trim());
  const { address, private: inside, local } = await apiAddress(input.baseUrl);
  if (input.oauth && input.authHeader.trim()) {
    throw bad("An API signs in with a header or with OAuth, not with both.");
  }
  const header = splitHeader(input.authHeader, envName(name, "API_KEY"));
  const endpoints = input.endpoints.map(checkEndpoint);
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.name)) throw bad(`Two endpoints are named ${endpoint.name}.`);
    seen.add(endpoint.name);
  }
  const oauth = input.oauth ? await checkOAuth(input.oauth, address, endpoints) : null;
  const api: StoredApi = {
    name,
    baseUrl: address,
    authHeader: header.stored,
    endpoints,
    tools: endpoints.length,
    secretEnv: header.env,
    private: inside,
    local,
    ...(oauth ? { oauth } : {}),
  };
  const secrets = input.oauth
    ? { clientSecret: input.oauth.clientSecret, refreshToken: input.oauth.refreshToken }
    : null;
  return { api, secret: header.secret, oauth: secrets };
}

// An OAuth sign-in as it is kept, without its secrets.
async function checkOAuth(
  entered: HostApiOAuth,
  baseUrl: string,
  endpoints: HostApiEndpoint[],
): Promise<HostApiOAuth> {
  const clientId = entered.clientId.trim();
  const scope = words(entered.scope);
  if (!GRANTS.includes(entered.grant) || !["basic", "body"].includes(entered.clientAuth)) {
    throw bad("OAuth signs in with client credentials or a refresh token, by header or body.");
  }
  if (!clientId) throw bad("OAuth needs a client ID.");
  if (!ONE_LINE.test(clientId) || !ONE_LINE.test(scope)) {
    throw bad("A client ID and a scope are plain text on one line.");
  }
  const tokenUrl = entered.tokenUrl.trim();
  await apiAddress(tokenUrlOf(tokenUrl, baseUrl));
  const named = endpoints.find((endpoint) =>
    [...endpoint.query.map(agentName), ...placesOf(endpoint.path)].some(
      (param) => param.toLowerCase() === SIGNED_HEADER.toLowerCase(),
    ),
  );
  if (named) {
    throw bad(
      `With OAuth the gateway sets ${SIGNED_HEADER} itself: ${named.name} cannot have a ` +
        "parameter of that name.",
    );
  }
  return { grant: entered.grant, tokenUrl, clientId, clientAuth: entered.clientAuth, scope };
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

/**
 * The same for an OAuth API: a token the host signs in for, sent to the base URL's origin alone.
 * With a refresh token, which a sign-in may use up before the API is saved, no token is sent.
 * Throws HostError 400 with the token endpoint's own words.
 */
export async function specToken(
  url: string,
  baseUrl: string,
  oauth: HostApiOAuthInput,
): Promise<{ headers: Record<string, string>; withheld: boolean }> {
  const origin = originOf(url);
  if (!origin || origin !== originOf(baseUrl)) return { headers: {}, withheld: true };
  if (oauth.grant !== "client_credentials") return { headers: {}, withheld: false };
  const { address } = await apiAddress(baseUrl);
  const { clientSecret, refreshToken, ...kept } = oauth;
  try {
    const { token } = await requestToken({
      oauth: kept,
      baseUrl: address,
      clientSecret,
      refreshToken,
    });
    return { headers: { [SIGNED_HEADER]: `Bearer ${token}` }, withheld: false };
  } catch (error) {
    throw error instanceof HostError
      ? error
      : bad(error instanceof Error ? error.message : String(error));
  }
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
  if (!pathFits(path)) {
    throw bad(
      "A path starts with / and holds plain segments and {name} for a value: " +
        "/invoices/{invoice_id}/notes",
    );
  }
  const query = entered.query.map((q) => q.trim()).filter(Boolean);
  if (!query.every((q) => QUERY.test(q))) {
    throw bad(
      `A query name of ${name} is letters, digits, '_', '.' and '-', after an optional '$'.`,
    );
  }
  if (!namesApart(method, path, query)) {
    throw bad(
      `${name} has two parameters an agent would see alike: its path’s values, its query names ` +
        "(without '$') and 'body' must differ, whatever their case.",
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

/**
 * The documents one API becomes: sources `<name>-reads` and `<name>-writes`, one tool per
 * endpoint, and the toolsets `<name>-reads` and `<name>-writes` (only those that have tools).
 * An OAuth API's sources carry no key: each of its tools takes the header from the gateway.
 */
export function apiDocs(api: StoredApi): ToolboxDoc[] {
  // One address twice, so a read never runs where a change does.
  const sides = [`${api.name}-reads`, `${api.name}-writes`];
  const signed = Boolean(api.oauth);
  const tools = api.endpoints.map((endpoint) =>
    toolOf(endpoint, endpoint.method === "GET" ? sides[0] : sides[1], signed),
  );
  const colon = api.authHeader.indexOf(":");
  const headers =
    signed || colon < 0
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

/** The tools of a config the gateway signs, each by the API it calls. */
export function signedTools(docs: ToolboxDoc[]): Record<string, string> {
  // No prototype: a tool may be named "constructor".
  const found: Record<string, string> = Object.create(null);
  for (const doc of docs) {
    if (doc.kind !== "tool" || doc.type !== "http" || !Array.isArray(doc.headerParams)) continue;
    const side = /^(.+)-(?:reads|writes)$/.exec(String(doc.source ?? ""));
    const takes = doc.headerParams.some((param) => isRecord(param) && param.name === SIGNED_HEADER);
    if (side && takes) found[doc.name] = side[1];
  }
  return found;
}

/** The query names of a config's tools that start with $ (Graph's $filter), by tool. */
export function dollarQueries(docs: ToolboxDoc[]): Record<string, string[]> {
  // No prototype: a tool may be named "constructor".
  const found: Record<string, string[]> = Object.create(null);
  for (const doc of docs) {
    if (doc.kind !== "tool" || doc.type !== "http" || !Array.isArray(doc.queryParams)) continue;
    const named = doc.queryParams
      .map((param) => (isRecord(param) && typeof param.name === "string" ? param.name : ""))
      .filter((name) => name.startsWith("$"));
    if (named.length) found[doc.name] = named;
  }
  return found;
}

// An endpoint as the runtime's http tool on the API's source for its kind.
function toolOf(endpoint: HostApiEndpoint, source: string, signed: boolean): ToolboxDoc {
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
  // Own notes only: a parameter may be named "constructor".
  const said = (param: string) =>
    endpoint.notes && Object.hasOwn(endpoint.notes, param) ? endpoint.notes[param] : undefined;
  const values = [...new Set(placesOf(endpoint.path))];
  if (values.length) {
    doc.pathParams = values.map((v) => ({
      name: v,
      type: "string",
      description: said(v) ?? v.replaceAll("_", " "),
    }));
  }
  if (endpoint.query.length) {
    doc.queryParams = endpoint.query.map((q) => ({
      name: q,
      type: "string",
      description: said(q) ?? q.replaceAll("_", " "),
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
  if (signed) {
    doc.headerParams = [
      { name: SIGNED_HEADER, type: "string", description: "Set by the gateway." },
    ];
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

/**
 * Checks, signs in once when the API uses OAuth, writes the secrets to the env file and the API
 * to apis.yaml (replacing its name).
 */
export async function saveApi(input: HostApiInput): Promise<HostApi> {
  const { api, secret, oauth } = await checkApi(input);
  const refuseClash = (apis: StoredApi[]) => {
    const taken = new Set(
      apis
        .filter((other) => other.name !== api.name)
        .flatMap((o) => o.endpoints.map((e) => e.name)),
    );
    const clash = api.endpoints.find((endpoint) => taken.has(endpoint.name));
    if (clash) {
      throw bad(`A tool named ${clash.name} exists already: name the endpoint something else.`);
    }
  };
  const seen = await listApis();
  refuseClash(seen);
  // Signed in outside the file's turn: a token request may take seconds.
  const before = seen.find((other) => other.name === api.name);
  const signed =
    api.oauth && oauth ? await keepOAuth(api.name, api.baseUrl, api.oauth, oauth, before) : false;
  await inTurn("apis", async () => {
    // Read again: another save may have written since.
    const apis = await listApis();
    refuseClash(apis);
    if (secret !== null && api.secretEnv) await setEnv(api.secretEnv, secret);
    const at = apis.findIndex((other) => other.name === api.name);
    const next = at < 0 ? [...apis, api] : apis.map((other, i) => (i === at ? api : other));
    await writeAtomic(homePath("apis.yaml"), stringify(next));
  });
  // After the write: a token asked for from here on is asked with the new sign-in.
  if (signed) forget(api.name);
  const { name, baseUrl, authHeader, endpoints, tools } = api;
  return {
    name,
    baseUrl,
    authHeader,
    endpoints,
    tools,
    ...(api.oauth ? { oauth: api.oauth } : {}),
  };
}

// Proves an OAuth sign-in with one token request, then keeps its secrets; whether it signed in.
// A save that changes neither the sign-in nor a secret asks for no token, so it spends no
// refresh token.
async function keepOAuth(
  name: string,
  baseUrl: string,
  oauth: HostApiOAuth,
  entered: OAuthSecrets,
  before: StoredApi | undefined,
): Promise<boolean> {
  const env = await readEnv();
  const [secretEnv, refreshEnv] = [
    envName(name, "OAUTH_CLIENT_SECRET"),
    envName(name, "OAUTH_REFRESH_TOKEN"),
  ];
  const clientSecret = entered.clientSecret || env[secretEnv] || "";
  const refreshToken = entered.refreshToken || env[refreshEnv] || "";
  if (oauth.grant === "client_credentials" && !clientSecret) {
    throw bad("OAuth needs the client secret.");
  }
  if (oauth.grant === "refresh_token" && !refreshToken) {
    throw bad("This sign-in needs a refresh token.");
  }
  const typed = Boolean(entered.clientSecret || entered.refreshToken);
  if (!typed && before?.oauth && before.baseUrl === baseUrl && sameSignIn(before.oauth, oauth)) {
    return false;
  }
  // A held secret goes to the token address it was entered for, and no other.
  const tokenOrigin = (o: HostApiOAuth, base: string) => originOf(tokenUrlOf(o.tokenUrl, base));
  const moved =
    before?.oauth && tokenOrigin(before.oauth, before.baseUrl) !== tokenOrigin(oauth, baseUrl);
  const held =
    (!entered.clientSecret && env[secretEnv]) ||
    (oauth.grant === "refresh_token" && !entered.refreshToken && env[refreshEnv]);
  if (moved && held) {
    throw bad("The token address moved to another host: type the client secret and token again.");
  }
  let answer: Awaited<ReturnType<typeof requestToken>>;
  try {
    answer = await requestToken({ oauth, baseUrl, clientSecret, refreshToken });
  } catch (error) {
    throw bad(error instanceof Error ? error.message : String(error));
  }
  if (clientSecret) await setEnv(secretEnv, clientSecret);
  if (oauth.grant === "refresh_token") {
    // One read from the env file is replaced only while it is still there: the gateway may have
    // renewed it meanwhile.
    const only = entered.refreshToken ? undefined : refreshToken;
    await setEnv(refreshEnv, answer.refreshToken ?? refreshToken, only);
  }
  return true;
}

const sameSignIn = (a: HostApiOAuth, b: HostApiOAuth) =>
  a.grant === b.grant &&
  a.tokenUrl === b.tokenUrl &&
  a.clientId === b.clientId &&
  a.clientAuth === b.clientAuth &&
  a.scope === b.scope;

/** The operations of a parsed OpenAPI 3, Swagger 2 or Google Discovery document, as endpoints. */
export function endpointsFromSpec(doc: unknown): HostSpec {
  try {
    return fromSpec(doc);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : String(error));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
