// The engine (NVIDIA auto-ontology), reached only through its Next API with the service key.

import type { AoConnectionConfig, AoValidationIssue } from "@/lib/ao-types";
import { engine } from "./engine";
import { dropEngineKey } from "./engine-key";
import { HostError } from "./errors";
import type { HostSystemInput } from "./types";

/**
 * One call to the current platform's engine, `${url}/api${path}` with `x-api-key`. `path` starts
 * with "/". Throws HostError 502 when the engine does not answer, 503 when it is not configured.
 */
export async function aoFetch(path: string, init?: RequestInit): Promise<Response> {
  const { url, key } = await engine();
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", key);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    // No redirect is followed: the key goes to the configured address, nowhere else.
    response = await fetch(`${url}/api${path}`, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new HostError(502, `The engine did not answer: ${reason}`);
  }
  // A key the engine no longer knows: if this server made it, the next call makes another.
  if (response.status === 401) await dropEngineKey(key);
  return response;
}

/** An engine's error answer as a HostError in its own words; a refused key is the host's fault. */
export async function aoError(response: Response): Promise<HostError> {
  const words = wordsOf(await response.text()) || response.statusText || `${response.status}`;
  if (response.status === 401 || response.status === 403) {
    return new HostError(
      502,
      `The engine refused this host’s key (${response.status}): ${words.replace(/\.$/, "")}. ` +
        "Check engine.json or AO_API_KEY, and the role of the user who minted the key. " +
        "A key this server made itself is made again on the next call.",
    );
  }
  const { status } = response;
  return new HostError(status >= 400 && status < 500 ? status : 502, words);
}

function wordsOf(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return "";
  }
  if (!body || typeof body !== "object") return "";
  const { detail, error } = body as { detail?: unknown; error?: unknown };
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return (detail as AoValidationIssue[])
      .map((issue) => {
        const where = (issue.loc ?? []).filter((part) => part !== "body").join(".");
        return where ? `${where}: ${issue.msg}` : issue.msg;
      })
      .join("; ");
  }
  return typeof error === "string" ? error : "";
}

/** The parsed body of a successful call; an error status is a HostError with the engine's words. */
export async function aoJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await aoFetch(path, init);
  if (!response.ok) throw await aoError(response);
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HostError(502, "The engine did not answer as auto-ontology does.");
  }
}

const ID = "[A-Za-z0-9-]{1,64}";
const SWITCHES = "/configurations/(?:semantic-compilation|pii-detection|distinct-value-probing)";
const anyOf = (paths: string[]) => new RegExp(`^(?:${paths.join("|")})$`);
// Connections carry passwords: they never pass through the proxy.
const ALLOWED: Record<string, RegExp> = {
  GET: anyOf([
    `/columns/${ID}`,
    `/terms/${ID}`,
    `/terms/${ID}/column-attributes`,
    `/terms/${ID}/sql-attributes`,
    `/exploration/tables/${ID}/details`,
    `/exploration/terms/${ID}/details`,
    SWITCHES,
    "/semantic-compilation/status",
    "/tags",
  ]),
  PATCH: anyOf([`/terms/${ID}`, `/terms/${ID}/column-attributes/${ID}`, `/sql-attributes/${ID}`]),
  PUT: anyOf([SWITCHES]),
  POST: anyOf(["/model/export"]),
};

/** Whether the browser may reach this method and path through /api/host/ao. Fails closed. */
export function aoAllowed(method: string, path: string): boolean {
  return Object.hasOwn(ALLOWED, method) && ALLOWED[method].test(path);
}

type Kind = "postgresql" | "mysql" | "snowflake" | "clickhouse" | "trino" | "databricks";
const KINDS: Record<string, Kind> = {
  "postgres:": "postgresql",
  "postgresql:": "postgresql",
  "mysql:": "mysql",
  "snowflake:": "snowflake",
  "clickhouse:": "clickhouse",
  "trino:": "trino",
  "databricks:": "databricks",
};

function decode(part: string, what: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new HostError(400, `The URL’s ${what} has a % that is not percent-encoding.`);
  }
}

const literal = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A system's URL and scope as the engine's connection; `url` is the address without the
 * password, as HostSystem shows it. Throws HostError 400 in plain words.
 */
export function connectionOf(input: HostSystemInput): {
  connection: AoConnectionConfig;
  database: string;
  password: string;
  url: string;
} {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new HostError(
      400,
      "The connection URL is not a URL: it reads like postgresql://user:password@host:5432/database.",
    );
  }
  const type = KINDS[url.protocol];
  if (!type) {
    throw new HostError(
      400,
      `The engine does not connect to “${url.protocol.slice(0, -1)}”: use postgresql, mysql, snowflake, clickhouse, trino or databricks.`,
    );
  }
  const user = decode(url.username, "user");
  const password = decode(url.password, "password");
  const segment = url.pathname.split("/")[1] ?? "";
  const database = decode(segment, "database");
  if (!database) {
    throw new HostError(400, "The URL names no database: put it after the host, as …/database.");
  }
  if (!password) {
    throw new HostError(400, "The URL holds no password: write it as user:password@host.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new HostError(400, "The URL names no host.");
  const port = url.port || undefined;
  const option = (name: string) => url.searchParams.get(name) || undefined;
  const needed = (name: string) => {
    const value = option(name);
    if (!value) throw new HostError(400, `A ${type} URL needs ?${name}=… after the database.`);
    return value;
  };
  const login = () => {
    if (!user) throw new HostError(400, "The URL names no user: write it as user:password@host.");
    return user;
  };

  const schemas: string[] = [];
  const tables: string[] = [];
  let whole = false;
  for (const raw of input.scope) {
    const entry = raw.trim();
    if (!entry) continue;
    const dot = entry.indexOf(".");
    const schema = dot < 0 ? entry : entry.slice(0, dot);
    const table = dot < 0 ? null : entry.slice(dot + 1);
    if (!schema || table === "") {
      throw new HostError(400, `“${entry}” is not SCHEMA or SCHEMA.TABLE.`);
    }
    if (!schemas.includes(schema)) schemas.push(schema);
    if (table === null) whole = true;
    else if (!tables.includes(table)) tables.push(table);
  }
  // The engine applies one table pattern to every schema, so it would cut a whole schema down.
  if (whole && tables.length) {
    throw new HostError(
      400,
      "Name whole schemas or single tables, not both: the engine applies one table list to every schema.",
    );
  }
  const shared = {
    database,
    password,
    ...(schemas.length ? { schemas } : {}),
    ...(tables.length ? { table_allow_regex: `^(?:${tables.map(literal).join("|")})$` } : {}),
  };

  let connection: AoConnectionConfig;
  switch (type) {
    case "postgresql":
    case "mysql":
      connection = { type, host, user: login(), port, ...shared };
      break;
    case "snowflake":
      connection = {
        type,
        account: host,
        warehouse: needed("warehouse"),
        user: login(),
        ...shared,
      };
      break;
    case "databricks":
      connection = { type, host, http_path: needed("http_path"), ...shared };
      break;
    case "trino":
      connection = {
        type,
        host,
        user: login(),
        port,
        http_scheme: option("http_scheme"),
        ...shared,
      };
      break;
    case "clickhouse":
      connection = {
        type,
        host,
        user: user || undefined,
        port,
        http_scheme: option("http_scheme"),
        ...shared,
      };
      break;
  }
  const shown = `${url.protocol}//${url.username ? `${url.username}@` : ""}${url.host}/${segment}`;
  return { connection, database, password, url: shown };
}
