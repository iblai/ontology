// The runtime's config file (tools.yaml): flat documents, one per source, tool, toolset or
// auth service. Everything that knows the runtime's document format lives here. Pure: no I/O.
// Ported from toolbox_compat.py and toolbox_config.py.

import { createHash } from "node:crypto";
import { Document, parseAllDocuments, Scalar, visit } from "yaml";
import type { AoConnectionConfig } from "@/lib/ao-types";
import { HostError } from "./errors";
import type { HostAuth } from "./types";

/** One document of the file, as the runtime reads it. */
export type ToolboxDoc = { kind: string; name: string; type?: string; [key: string]: unknown };

/** An empty toolset named MARK + <id> proves which file the runtime has loaded. */
export const MARK = "loaded-";

const MARK_RE = /^loaded-[0-9a-f]{12}$/;
// The runtime's rule for a name (tools.IsValidName), kept for every kind.
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
// What a statement that only reads starts with; EXPLAIN is absent, EXPLAIN ANALYZE runs the query.
const READ_LEAD_RE = /^[\s(]*(SELECT|WITH|SHOW|DESCRIBE|DESC|VALUES|TABLE)\b/i;
// Any of these words anywhere makes a statement a write: a CTE, SELECT INTO and a batch hide them.
const WRITE_WORD_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|INTO|TRUNCATE|DROP|ALTER|CREATE|RENAME|GRANT|REVOKE|CALL|EXEC|EXECUTE|COPY|LOCK)\b/i;
// Keys whose values are secrets (config/reader.py).
const SECRET_KEY_RE =
  /(password|secret|api_key|api-key|token|client_secret|key|authorization|cookie)$/i;
// ${NAME}, or a scheme word and ${NAME} as an Authorization header is written.
const ENV_REF_RE = /^(?:[A-Za-z][A-Za-z0-9-]* )?\$\{[A-Z0-9_]+\}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/* ---------- the file ---------- */

/** The documents in a config file's text. Throws HostError 400 on text that is not such a file. */
export function parseConfig(text: string): ToolboxDoc[] {
  const docs: ToolboxDoc[] = [];
  for (const [i, parsed] of parseAllDocuments(text).entries()) {
    if (parsed.errors.length) {
      throw new HostError(400, `document ${i + 1} is not YAML: ${parsed.errors[0].message}`);
    }
    const value: unknown = parsed.toJS();
    if (value === null || value === undefined) continue;
    if (!isRecord(value) || typeof value.kind !== "string" || typeof value.name !== "string") {
      throw new HostError(400, `document ${i + 1} is not a mapping with a kind and a name`);
    }
    docs.push(value as ToolboxDoc);
  }
  return docs;
}

/**
 * The file's text for `docs`, ending with the mark toolset. `id` is twelve hex characters of the
 * sha256 of `owner` and the text before the mark; `mark` is MARK + id. `title` goes into the
 * first comment; `owner` is not printed, and gives two owners of one text different marks.
 */
export function renderConfig(
  docs: ToolboxDoc[],
  title: string,
  owner = "",
): { yaml: string; mark: string; id: string } {
  // The runtime expands ${…} in comments too, and a line break would end the comment.
  if (/[\r\n]|\$\{/.test(title)) throw new HostError(400, "A config’s title is one plain line.");
  const text = `# generated · ${title} · do not edit by hand\n` + docs.map(toYaml).join("---\n");
  const hashed = owner ? `${owner}\n${text}` : text;
  const id = createHash("sha256").update(hashed).digest("hex").slice(0, 12);
  const mark = MARK + id;
  return { yaml: `${text}---\n${toYaml(toolsetDoc(mark, []))}`, mark, id };
}

/** Toolset name → its tools' names, without the mark toolset. */
export function members(docs: ToolboxDoc[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const doc of docs) {
    if (doc.kind !== "toolset" || MARK_RE.test(doc.name)) continue;
    found[doc.name] = Array.isArray(doc.tools) ? doc.tools.map(String) : [];
  }
  return found;
}

/* ---------- does it write? ---------- */

/** Why a SQL statement cannot be shown to only read, or null when it only reads. */
export function whyStatementWrites(statement: string): string | null {
  if (typeof statement !== "string" || !statement.trim()) {
    return "it has no statement of its own, so the caller writes the SQL";
  }
  const body = statement.trim().replace(/;+$/, "").trimEnd();
  if (body.includes(";")) return "its statement holds a ';', so more than one statement";
  if (!READ_LEAD_RE.test(body)) {
    return "its statement does not start with SELECT, WITH, SHOW, DESCRIBE, VALUES or TABLE";
  }
  const word = WRITE_WORD_RE.exec(body);
  return word ? `its statement holds ${word[0].toUpperCase()}` : null;
}

/** Per tool that changes data, why. Fails closed: what cannot be shown to only read, writes. */
export function writingTools(docs: ToolboxDoc[]): Record<string, string> {
  const tools = docs.filter((doc) => doc.kind === "tool");
  const why: Record<string, string> = {};
  for (const tool of tools) {
    const type = typeof tool.type === "string" ? tool.type : "";
    let reason: string | null;
    if (type === "http") {
      const method = String(tool.method ?? "").toUpperCase();
      reason =
        method === "GET" || method === "HEAD" ? null : `its method is ${method || "not given"}`;
    } else if (!type.endsWith("-sql") || type.endsWith("-execute-sql")) {
      reason = `its type (${type || "none"}) does not run one fixed statement`;
    } else if (Array.isArray(tool.templateParameters) && tool.templateParameters.length) {
      reason = "its templateParameters let the caller change the SQL";
    } else {
      reason = whyStatementWrites(tool.statement as string);
    }
    if (reason) why[tool.name] = reason;
  }
  // A source one tool writes through is a write account: every tool on it counts.
  const through = new Map<string, string>();
  for (const tool of tools) {
    const source = tool.source;
    if (tool.name in why && typeof source === "string" && source && !through.has(source)) {
      through.set(source, tool.name);
    }
  }
  for (const tool of tools) {
    const source = typeof tool.source === "string" ? tool.source : "";
    const writer = through.get(source);
    if (!(tool.name in why) && writer) {
      why[tool.name] = `it shares the source '${source}' with '${writer}'`;
    }
  }
  return why;
}

/** The toolsets that hold a tool that writes. A caller reaches these only by name. */
export function writingToolsets(docs: ToolboxDoc[]): string[] {
  const writing = writingTools(docs);
  return Object.entries(members(docs))
    .filter(([, tools]) => tools.some((tool) => tool in writing))
    .map(([name]) => name);
}

/* ---------- validation ---------- */

const PARAM_TYPES = new Set(["string", "integer", "float", "boolean", "array", "map"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const TOOL_BASE = ["kind", "name", "type", "source", "description", "authRequired", "annotations"];
const SQL_TOOL = [...TOOL_BASE, "statement", "parameters", "templateParameters"];
const HTTP_TOOL = [
  ...TOOL_BASE,
  ...["method", "path", "headers", "requestBody"],
  ...["pathParams", "queryParams", "bodyParams", "headerParams"],
];
const SOURCE_BASE = ["kind", "name", "type"];
// Every key a document of each proven type may carry (runtime 1.16.0 decodes strictly).
const SOURCE_KEYS: Record<string, string[]> = {
  postgres: [...SOURCE_BASE, "host", "port", "user", "password", "database", "queryParams"],
  mysql: [...SOURCE_BASE, "host", "port", "user", "password", "database", "queryParams"],
  clickhouse: [...SOURCE_BASE, "host", "port", "user", "password", "database", "protocol"],
  snowflake: [
    ...SOURCE_BASE,
    ...["account", "user", "password", "database", "schema", "warehouse", "role"],
  ],
  http: [
    ...SOURCE_BASE,
    ...["baseUrl", "timeout", "headers", "queryParams", "returnFullError"],
    ...["allowedIpRanges", "customBlockedIpRanges"],
  ],
};
const TOOL_KEYS: Record<string, string[]> = {
  "postgres-sql": SQL_TOOL,
  "mysql-sql": SQL_TOOL,
  "clickhouse-sql": SQL_TOOL,
  "snowflake-sql": SQL_TOOL,
  "postgres-execute-sql": TOOL_BASE,
  "mysql-execute-sql": TOOL_BASE,
  "clickhouse-execute-sql": TOOL_BASE,
  "snowflake-execute-sql": TOOL_BASE,
  http: HTTP_TOOL,
};
const AUTH_KEYS: Record<string, string[]> = {
  generic: ["kind", "name", "type", "audience", "authorizationServer", "mcpEnabled"],
  google: ["kind", "name", "type", "clientId"],
};
const AUTH_NEEDS: Record<string, string[]> = {
  generic: ["audience", "authorizationServer"],
  google: ["clientId"],
};

/**
 * Refuses what the runtime would refuse and what the host must never write: an unknown kind or
 * type, a tool whose source is missing, a toolset naming a missing tool, a bad name, a literal
 * secret where only ${NAME} may stand. Throws HostError 400 listing every finding.
 */
export function validateDocs(docs: ToolboxDoc[]): void {
  const found: string[] = [];
  const seen = new Set<string>();
  const named = (kind: string) =>
    new Set(docs.filter((doc) => doc.kind === kind).map((doc) => doc.name));
  const sources = named("source");
  const tools = named("tool");
  const auths = named("authService");
  const used = new Set(docs.filter((doc) => doc.kind === "tool").map((doc) => doc.source));

  docs.forEach((doc, i) => {
    const label = `${doc.kind} '${doc.name}'`;
    if (typeof doc.name !== "string" || !NAME_RE.test(doc.name)) {
      found.push(`document ${i + 1}: '${doc.name}' is not a name: letters, digits, _ and - only`);
    }
    if (seen.has(`${doc.kind}/${doc.name}`)) found.push(`two ${doc.kind}s are named '${doc.name}'`);
    seen.add(`${doc.kind}/${doc.name}`);
    const type = typeof doc.type === "string" ? doc.type : "";
    let keys: string[] | undefined;
    if (doc.kind === "source") {
      keys = SOURCE_KEYS[type];
      if (!keys) found.push(`${label} has a type this runtime has no source for: '${type}'`);
      // The runtime opens every source at start, and one it cannot open stops it whole.
      if (!used.has(doc.name)) found.push(`${label} is used by no tool`);
    } else if (doc.kind === "tool") {
      keys = TOOL_KEYS[type];
      if (!keys) found.push(`${label} has a type this runtime has no tool for: '${type}'`);
      found.push(...toolFindings(doc, label, type, sources, auths));
    } else if (doc.kind === "toolset") {
      keys = ["kind", "name", "tools"];
      if (MARK_RE.test(doc.name)) found.push(`${label} is named as the host’s mark`);
      if (!Array.isArray(doc.tools)) found.push(`${label} has no list of tools`);
      for (const tool of Array.isArray(doc.tools) ? doc.tools : []) {
        if (!tools.has(String(tool)))
          found.push(`${label} names '${tool}', which is not a tool here`);
      }
    } else if (doc.kind === "authService") {
      keys = AUTH_KEYS[type];
      if (!keys) found.push(`${label} has a type this runtime has no auth service for: '${type}'`);
      for (const need of AUTH_NEEDS[type] ?? []) {
        if (!nonEmpty(doc[need])) found.push(`${label} has no '${need}'`);
      }
      // Switched on for the MCP endpoint, it would refuse every caller the gateway forwards.
      if (doc.mcpEnabled === true) found.push(`${label} is switched on for the whole endpoint`);
    } else {
      found.push(`document ${i + 1} has a kind the runtime does not take: '${doc.kind}'`);
    }
    for (const key of Object.keys(doc)) {
      if (keys && !keys.includes(key)) found.push(`${label} has a key the runtime refuses: ${key}`);
    }
    for (const where of literalSecrets(doc)) {
      found.push(`${label} holds a literal secret at ${where}: write \${NAME} instead`);
    }
    // Only a source's value may be an env reference; the runtime expands ${ anywhere else too.
    for (const where of strayRefs(doc, "", doc.kind === "source")) {
      found.push(`${label} holds '\${' at ${where}, which the runtime reads as a setting`);
    }
  });
  if (found.length) throw new HostError(400, found.join("\n"));
}

function toolFindings(
  doc: ToolboxDoc,
  label: string,
  type: string,
  sources: Set<string>,
  auths: Set<string>,
): string[] {
  const found: string[] = [];
  if (!nonEmpty(doc.source)) found.push(`${label} has no source`);
  else if (!sources.has(doc.source as string)) {
    found.push(`${label} names the source '${doc.source}', which is not here`);
  }
  if (!nonEmpty(doc.description)) found.push(`${label} has no description`);
  if (type.endsWith("-sql") && !type.endsWith("-execute-sql") && !nonEmpty(doc.statement)) {
    found.push(`${label} has no statement`);
  }
  if (type === "http") {
    if (!HTTP_METHODS.has(String(doc.method))) found.push(`${label} has no method the host takes`);
    if (!nonEmpty(doc.path)) found.push(`${label} has no path`);
    else if (String(doc.path).startsWith("/")) {
      found.push(`${label} has a path that starts with /, which leaves its address’s path`);
    }
  }
  for (const key of ["parameters", "pathParams", "queryParams", "bodyParams", "headerParams"]) {
    const params = doc[key];
    if (params === undefined) continue;
    if (!Array.isArray(params)) {
      found.push(`${label} has ${key} that is not a list`);
      continue;
    }
    for (const param of params) {
      const ok =
        isRecord(param) &&
        nonEmpty(param.name) &&
        PARAM_TYPES.has(String(param.type)) &&
        nonEmpty(param.description);
      if (!ok) found.push(`${label} has a parameter without a name, a known type or a description`);
    }
  }
  const required = doc.authRequired;
  if (required !== undefined) {
    for (const name of Array.isArray(required) ? required : [required]) {
      if (!auths.has(String(name)))
        found.push(`${label} requires '${name}', which is not an auth service`);
    }
  }
  return found;
}

// The paths of secret-looking keys, at any depth, whose value is not a ${NAME} reference.
function literalSecrets(value: unknown, where = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((inner) => literalSecrets(inner, where));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const path = where ? `${where}.${key}` : key;
    const typed = typeof inner === "string" || typeof inner === "number";
    if (typed && SECRET_KEY_RE.test(key)) return ENV_REF_RE.test(String(inner)) ? [] : [path];
    return literalSecrets(inner, path);
  });
}

// The paths of strings holding "${" where it may not stand: anywhere unless `refs`, and then
// anywhere but a whole ${NAME} reference.
function strayRefs(value: unknown, where: string, refs: boolean): string[] {
  if (typeof value === "string") {
    return value.includes("${") && !(refs && ENV_REF_RE.test(value)) ? [where] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((inner, i) => strayRefs(inner, `${where}[${i}]`, refs));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const path = where ? `${where}.${key}` : key;
    return [...(key.includes("${") ? [path] : []), ...strayRefs(inner, path, refs)];
  });
}

/* ---------- building documents ---------- */

/** How one SQL engine is served: its document types, its placeholders and its quoting. */
export type Dialect = {
  engine: string; // display name, "postgres"
  source: string; // the source document's type
  sqlTool: string; // the type of a tool that runs one fixed statement
  executeTool: string; // the type of the raw execute-sql tool
  placeholder(index: number): string; // 1-based: "$1", "?", ":1"
  quote(identifier: string): string;
};

const doubleQuoted = (id: string) => `"${id.replaceAll('"', '""')}"`;
const backQuoted = (id: string) => `\`${id.replaceAll("`", "``")}\``;
const dialect = (
  engine: string,
  placeholder: (index: number) => string,
  quote: (id: string) => string,
): Dialect => ({
  engine,
  source: engine,
  sqlTool: `${engine}-sql`,
  executeTool: `${engine}-execute-sql`,
  placeholder,
  quote,
});
const POSTGRES = dialect("postgres", (i) => `$${i}`, doubleQuoted);
const MYSQL = dialect("mysql", () => "?", backQuoted);
const CLICKHOUSE = dialect("clickhouse", () => "?", backQuoted);
const SNOWFLAKE = dialect("snowflake", (i) => `:${i}`, doubleQuoted);
const DIALECTS: Record<string, Dialect> = {
  postgresql: POSTGRES,
  postgres: POSTGRES,
  mysql: MYSQL,
  clickhouse: CLICKHOUSE,
  snowflake: SNOWFLAKE,
};
// The statement of a source's list_tables tool, per engine.
const LIST_TABLES: Record<string, string> = {
  postgres:
    "SELECT table_schema, table_name, table_type FROM information_schema.tables " +
    "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
    "ORDER BY table_schema, table_name",
  mysql:
    "SELECT table_schema, table_name, table_type FROM information_schema.tables " +
    "WHERE table_schema = DATABASE() ORDER BY table_name",
  clickhouse:
    "SELECT database AS table_schema, name AS table_name, engine AS table_type " +
    "FROM system.tables WHERE database = currentDatabase() ORDER BY name",
  snowflake:
    "SELECT table_schema, table_name, table_type FROM information_schema.tables " +
    "WHERE table_schema <> 'INFORMATION_SCHEMA' ORDER BY table_schema, table_name",
};

/** The dialect for an engine connector type ("postgresql", "mysql", …); null when not served. */
export function dialectOf(engineType: string): Dialect | null {
  return Object.hasOwn(DIALECTS, engineType) ? DIALECTS[engineType] : null;
}

/**
 * The source document for an engine connection, its password written as ${passwordEnv}.
 * Throws HostError 400 naming an engine the runtime has no source for.
 */
export function sourceDoc(
  name: string,
  connection: AoConnectionConfig,
  passwordEnv: string,
): ToolboxDoc {
  const served = dialectOf(connection.type);
  if (!served)
    throw new HostError(400, `The runtime has no source for ${connection.type} systems.`);
  if (!ENV_NAME_RE.test(passwordEnv)) {
    throw new HostError(400, `${passwordEnv} is not an env name: capitals, digits and _.`);
  }
  const password = `\${${passwordEnv}}`;
  const base = { kind: "source", name, type: served.source };
  switch (connection.type) {
    case "postgresql":
    case "postgres":
    case "mysql": {
      const port = connection.port || (served === POSTGRES ? "5432" : "3306");
      const { host, user, database } = connection;
      return { ...base, host, port, database, user, password };
    }
    case "clickhouse": {
      // The engine's own rule: port 8123 by default, TLS on 443 and 8443 unless the URL says.
      const port = connection.port || "8123";
      const tls = port === "443" || port === "8443";
      const protocol = connection.http_scheme || (tls ? "https" : "http");
      if (protocol !== "http" && protocol !== "https") {
        throw new HostError(
          400,
          `The runtime reaches ClickHouse over http or https, not ${protocol}.`,
        );
      }
      const { host, database } = connection;
      const user = connection.user || "default";
      return { ...base, host, port, database, user, password, protocol };
    }
    case "snowflake": {
      const schema = connection.schema || connection.schemas?.[0];
      if (!schema) throw new HostError(400, "The runtime’s Snowflake source needs one schema.");
      const { account, user, database, warehouse } = connection;
      return { ...base, account, user, password, database, schema, warehouse };
    }
    default:
      throw new HostError(400, `The runtime has no source for ${connection.type} systems.`);
  }
}

export type ToolParam = {
  name: string;
  type: "string" | "integer" | "float" | "boolean";
  description: string;
  default?: string | number | boolean; // a parameter with a default is optional
};

/** A tool that runs one fixed statement with bound parameters. */
export function sqlToolDoc(input: {
  name: string;
  source: string;
  dialect: Dialect;
  description: string;
  statement: string;
  parameters: ToolParam[];
}): ToolboxDoc {
  const doc: ToolboxDoc = {
    kind: "tool",
    name: input.name,
    type: input.dialect.sqlTool,
    source: input.source,
    description: input.description,
    statement: input.statement,
  };
  if (input.parameters.length) {
    // The runtime treats a parameter with a default as optional (CheckParamRequired).
    doc.parameters = input.parameters.map((param) => ({
      name: param.name,
      type: param.type,
      description: param.description,
      ...(param.default === undefined ? {} : { default: param.default }),
    }));
  }
  return doc;
}

/** The raw tools of a source: execute_sql and list_tables, named `<source>_execute_sql` etc. */
export function rawDocs(source: string, dialect: Dialect): ToolboxDoc[] {
  return [
    {
      kind: "tool",
      name: `${source}_execute_sql`,
      type: dialect.executeTool,
      source,
      description: `Runs any SQL statement on ${source}: it can read and change data.`,
    },
    sqlToolDoc({
      name: `${source}_list_tables`,
      source,
      dialect,
      description: `Lists the tables of ${source}, with their schema and type.`,
      statement: LIST_TABLES[dialect.engine],
      parameters: [],
    }),
  ];
}

/** A toolset document. */
export function toolsetDoc(name: string, tools: string[]): ToolboxDoc {
  return { kind: "toolset", name, tools: [...tools] };
}

/**
 * One auth service document per OIDC option of a server (Entra, Google, custom issuer).
 * Throws HostError 400 naming an option this runtime cannot verify.
 */
export function authDocs(auth: HostAuth): ToolboxDoc[] {
  const docs: ToolboxDoc[] = [];
  // Off for the MCP endpoint: only a tool naming it in authRequired checks <name>_token.
  const generic = (name: string, server: string, audience: string): ToolboxDoc => ({
    kind: "authService",
    name,
    type: "generic",
    audience,
    authorizationServer: server,
    mcpEnabled: false,
  });
  if (auth.entra) {
    const directory = plain("Microsoft Entra", "directory", auth.entra.tenant);
    if (!/^[A-Za-z0-9.-]+$/.test(directory)) {
      throw new HostError(400, "Microsoft Entra: the directory is its ID or its domain name.");
    }
    const audience = plain("Microsoft Entra", "audience", auth.entra.audience);
    docs.push(generic("entra", `https://login.microsoftonline.com/${directory}/v2.0`, audience));
  }
  if (auth.google) {
    const clientId = plain("Google", "audience", auth.google.audience);
    docs.push({ kind: "authService", name: "google", type: "google", clientId });
  }
  if (auth.oidc) {
    const issuer = plain("OIDC", "issuer", auth.oidc.issuer);
    if (!URL.canParse(issuer) || new URL(issuer).protocol !== "https:") {
      throw new HostError(400, "OIDC: the issuer is an https:// address.");
    }
    docs.push(generic("oidc", issuer, plain("OIDC", "audience", auth.oidc.audience)));
  }
  return docs;
}

/* ---------- helpers ---------- */

// One option's value as the file may hold it, or a 400 naming the option.
function plain(option: string, field: string, value: string | undefined): string {
  const kept = (value ?? "").trim();
  if (!kept || /[\s"\\]|\$\{/.test(kept)) {
    throw new HostError(400, `${option}: the ${field} is empty or holds a character it cannot.`);
  }
  return kept;
}

// One document's YAML: kind, name, type first; a ${NAME} reference double-quoted, so whatever
// the runtime puts in its place stays one scalar.
function toYaml(doc: ToolboxDoc): string {
  const { kind, name, type, ...rest } = doc;
  const document = new Document({ kind, name, ...(type === undefined ? {} : { type }), ...rest });
  visit(document, {
    Scalar(_, node) {
      if (typeof node.value === "string" && node.value.includes("${")) {
        node.type = Scalar.QUOTE_DOUBLE;
      }
    },
  });
  return document.toString({ lineWidth: 0 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}
