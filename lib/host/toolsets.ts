// What the host can offer a server: every source, tool and toolset, generated from the engine's
// certified terms, the connected systems, the custom APIs, the hand-written actions and the
// filesystems.

import type { AoColumnAttribute, AoConnectionConfig } from "@/lib/ao-types";
import { apiDocs, listApis, type StoredApi } from "./apis";
import { HostError } from "./errors";
import { envName, homePath, readEnv, readText, slugOf } from "./files";
import { filesNotes, filesToolset, listLocals, type StoredLocal } from "./local";
import { readEngine, type Reading, type ReadTerm } from "./reading";
import { SEMANTIC_NOTES, SEMANTIC_TOOLSET } from "./semantic";
import {
  authDocs,
  dialectOf,
  parseConfig,
  rawDocs,
  sourceDoc,
  sqlToolDoc,
  toolsetDoc,
  whyStatementWrites,
  writingToolsets,
  type Dialect,
  type ToolParam,
  type ToolboxDoc,
} from "./toolbox-config";
import type { HostServerDraft, HostTool, HostToolset } from "./types";

export type Catalog = {
  docs: ToolboxDoc[]; // every source, tool and toolset document
  toolsets: HostToolset[]; // the same toolsets as the builder lists them
  skipped: string[]; // what was left out and why, in plain words
};

export type CatalogInput = {
  reading: Reading;
  apis: StoredApi[];
  actions: ToolboxDoc[]; // the documents of actions.yaml, if there is one
  env: string[]; // secret names present in the env file
  locals?: StoredLocal[]; // the filesystems of locals.yaml
};

type Served = {
  source: string;
  dialect: Dialect;
  connection: AoConnectionConfig;
  passwordEnv: string;
};

// One generated tool and where it belongs.
type Made = { tool: HostTool; term: string; system: string; tags: string[]; metric: boolean };
type Generated = { doc: ToolboxDoc; sig: string; note: string; statement: string };

type Located = { id: string; name: string; schema: string | null; system: string; source: Served };

const SEARCH_LIMIT = 20;

/** Pure: the catalog for one reading of the engine and the host's own files. */
export function catalogFrom({ reading, apis, actions, env, locals = [] }: CatalogInput): Catalog {
  const docs: ToolboxDoc[] = [];
  const toolsets: HostToolset[] = [];
  const skipped: string[] = [];
  const usedToolsets = new Set([SEMANTIC_TOOLSET]);
  const addToolset = (toolset: HostToolset, doc: ToolboxDoc | null) => {
    if (usedToolsets.has(toolset.name)) {
      skipped.push(`The toolset ${toolset.name} was left out: another toolset has that name.`);
      return;
    }
    usedToolsets.add(toolset.name);
    toolsets.push(toolset);
    if (doc) docs.push(doc);
  };

  // 1. One source per connection the runtime serves and the host holds the password of.
  const served = new Map<string, Served>(); // database name → its source
  const sources = new Set<string>();
  for (const { database_name: name, connection } of reading.connections) {
    const dialect = connection ? dialectOf(connection.type) : null;
    const passwordEnv = envName(name, "DB_PASSWORD");
    const source = slugOf(name);
    if (!connection || !dialect) {
      const engine = connection?.type ?? "its";
      skipped.push(`${name} is not served: the runtime has no source for ${engine} connections.`);
    } else if (!env.includes(passwordEnv)) {
      skipped.push(`${name} is not served: the host does not hold its password (${passwordEnv}).`);
    } else if (!source || sources.has(source)) {
      skipped.push(`${name} is not served: its name gives no source name of its own.`);
    } else {
      sources.add(source);
      served.set(name, { source, dialect, connection, passwordEnv });
      docs.push(sourceDoc(source, connection, passwordEnv));
    }
  }

  const apiSets = apis.map((api) => ({ api, docs: apiDocs(api) }));
  const taken = new Set(
    [...apiSets.flatMap((a) => a.docs), ...actions].filter(isTool).map((d) => d.name),
  );
  const made: Made[] = [];
  const addTool = (tool: Generated, where: Omit<Made, "tool">) => {
    const { doc, sig, note, statement } = tool;
    const label = where.metric ? `the metric ${doc.name}` : doc.name;
    const why = whyStatementWrites(statement);
    if (taken.has(doc.name)) {
      skipped.push(`${label} of ${where.term} was left out: another tool has that name.`);
    } else if (why) {
      skipped.push(`${label} of ${where.term} was left out: ${why}.`);
    } else {
      taken.add(doc.name);
      docs.push(doc);
      made.push({ ...where, tool: { name: doc.name, sig, note } });
    }
  };

  // 2 and 3. Tools from each certified term over its first served table, and its metrics.
  for (const read of reading.terms) {
    const { term } = read;
    if (term.name_certified !== true || term.description_certified !== true) continue;
    const display = term.name ?? term.id;
    const tags = (term.tags ?? []).map((t) => t.name);
    const table = locate(reading, read, served);
    if (table) {
      const where = { term: display, system: table.system, tags, metric: false };
      for (const tool of termTools(reading, read, table, skipped)) addTool(tool, where);
    } else {
      skipped.push(`${display} has no table in a served system, so it has no tools.`);
    }
    for (const attr of read.sql) {
      if (attr.certified !== true) continue;
      const name = snake(attr.name ?? "");
      const label = `the metric ${attr.name ?? attr.id} of ${display}`;
      const system = attr.database_name ?? table?.system ?? null;
      const source = system ? served.get(system) : undefined;
      if (!name) skipped.push(`${label} was left out: its name gives no tool name.`);
      else if (!attr.sql?.trim()) skipped.push(`${label} was left out: it has no statement.`);
      else if (!system || !source) {
        skipped.push(`${label} was left out: ${system ?? "its system"} is not served.`);
      } else {
        const statement = attr.sql;
        const doc = sqlToolDoc({
          name,
          source: source.source,
          dialect: source.dialect,
          description: attr.description || `${attr.name} of ${display}.`,
          statement,
          parameters: [],
        });
        const tool = { doc, sig: `${name}()`, note: "metric", statement };
        addTool(tool, { term: display, system, tags, metric: true });
      }
    }
  }

  // 4. Toolsets: one per served system, one per tag, the APIs', semantic, actions, the raw ones,
  // the filesystems'.
  for (const [system, { source }] of served) {
    const own = made.filter((m) => m.system === system);
    if (own.length === 0) {
      skipped.push(`${system} has no certified term with tools yet, so it has no toolset.`);
    } else {
      addToolset(
        termsToolset(source, own),
        toolsetDoc(
          source,
          own.map((m) => m.tool.name),
        ),
      );
    }
  }
  for (const tag of [...new Set(made.flatMap((m) => m.tags))]) {
    const slug = slugOf(tag);
    if (!slug) {
      skipped.push(`The tag ${tag} gives no toolset name, so it has no toolset.`);
      continue;
    }
    const name = sources.has(slug) ? `${slug}-tag` : slug;
    const own = made.filter((m) => m.tags.includes(tag));
    addToolset(
      termsToolset(name, own),
      toolsetDoc(
        name,
        own.map((m) => m.tool.name),
      ),
    );
  }
  for (const { api, docs: own } of apiSets) {
    docs.push(...own.filter((d) => d.kind !== "toolset"));
    for (const doc of own.filter((d) => d.kind === "toolset")) {
      const writes = doc.name.endsWith("-writes");
      const tools = toolsOf(doc).map((name) => ({
        ...toolOf(own, name),
        ...(writes ? {} : { note: "http · live API" }),
      }));
      addToolset(
        {
          name: doc.name,
          summary: `${api.name} API · ${writes ? "writes" : "reads"}`,
          tools,
          defaultOn: !writes,
          ...(writes ? { risk: "writes" as const } : {}),
          kind: "api",
        },
        doc,
      );
    }
  }
  toolsets.push({
    name: SEMANTIC_TOOLSET,
    summary: "glossary · catalog · questions",
    tools: Object.entries(SEMANTIC_NOTES).map(([name, { sig, note }]) => ({ name, sig, note })),
    // Ticked only once there is a semantic layer for its tools to answer from.
    defaultOn: reading.status.calculated,
    kind: "semantic",
  });
  docs.push(...actions.filter((d) => d.kind !== "toolset"));
  for (const doc of actions.filter((d) => d.kind === "toolset")) {
    addToolset(
      {
        name: doc.name,
        summary: "write tools",
        tools: toolsOf(doc).map((name) => toolOf(actions, name)),
        defaultOn: false,
        risk: "writes",
        kind: "actions",
      },
      doc,
    );
  }
  // The raw tools get a source of their own: a writer on a shared source makes its readers write.
  for (const { source, dialect, connection, passwordEnv } of served.values()) {
    const rawSource = `${source}-raw`;
    const raw = rawDocs(rawSource, dialect).filter(isTool);
    docs.push(sourceDoc(rawSource, connection, passwordEnv), ...raw);
    addToolset(
      {
        name: rawSource,
        summary: `prebuilt · ${dialect.engine} · read-only login`,
        tools: raw.map((d) => ({ name: d.name, sig: sigOf(d) })),
        defaultOn: false,
        risk: "unrestricted",
        kind: "raw",
      },
      toolsetDoc(
        rawSource,
        raw.map((d) => d.name),
      ),
    );
  }

  // A filesystem's two tools are the gateway's own: a toolset with no document, added last so a
  // toolset that has one keeps the name.
  for (const local of locals) {
    const name = filesToolset(local.name);
    const tools = filesNotes(name);
    const clash = tools.find((tool) => taken.has(tool.name));
    if (clash) {
      skipped.push(
        `The filesystem ${local.name} was left out: another tool is named ${clash.name}.`,
      );
      continue;
    }
    for (const tool of tools) taken.add(tool.name);
    const summary = `filesystem · ${local.path}`;
    addToolset({ name, summary, tools, defaultOn: true, kind: "files" }, null);
  }

  const writing = new Set(writingToolsets(docs));
  for (const toolset of toolsets) {
    if (writing.has(toolset.name) && toolset.kind !== "raw") toolset.risk = "writes";
  }
  return { docs, toolsets, skipped };
}

/** The catalog as of now: the engine, apis.yaml, actions.yaml, locals.yaml, the env file's names. */
export async function loadCatalog(): Promise<Catalog> {
  const [reading, apis, actions, env, locals] = await Promise.all([
    readEngine(),
    listApis(),
    readText(homePath("actions.yaml")),
    readEnv(),
    listLocals(),
  ]);
  return catalogFrom({
    reading,
    apis,
    actions: actions === null ? [] : parseConfig(actions),
    env: Object.keys(env),
    locals,
  });
}

/**
 * The documents one server gets: the draft's toolsets that the runtime serves, their tools and
 * the sources those need, and one auth service per OIDC option. The gateway's own toolsets (the
 * semantic one, a filesystem's) add no document. Throws HostError 400 naming a toolset that does
 * not exist.
 */
export function serverDocs(catalog: Catalog, draft: HostServerDraft): ToolboxDoc[] {
  const known = new Set(catalog.toolsets.map((t) => t.name));
  const missing = draft.toolsets.filter((name) => !known.has(name));
  if (missing.length > 0) {
    const names = missing.map((name) => `“${name}”`).join(", ");
    throw new HostError(400, `There is no toolset named ${names}.`);
  }
  const chosen = catalog.docs.filter(
    (d) => d.kind === "toolset" && draft.toolsets.includes(d.name),
  );
  const toolNames = new Set(chosen.flatMap(toolsOf));
  const tools = catalog.docs.filter((d) => isTool(d) && toolNames.has(d.name));
  const sourceNames = new Set(tools.map((d) => d.source));
  const sources = catalog.docs.filter((d) => d.kind === "source" && sourceNames.has(d.name));
  return [...sources, ...tools, ...chosen, ...authDocs(draft.auth)];
}

/* ---------- generating a term's tools ---------- */

// The first of the term's tables that sits in a served system.
function locate(reading: Reading, read: ReadTerm, served: Map<string, Served>): Located | null {
  for (const t of read.term.tables) {
    const node = reading.graph.nodes.find((n) => n.id === t.id);
    const system = node?.database_name ?? reading.databases.find((d) => d.id === t.db_id)?.name;
    const schema =
      node?.schema_name ??
      reading.databases.flatMap((d) => d.schemas).find((s) => s.id === t.schema_id)?.schema_name;
    const name = node?.name ?? t.name;
    const source = system ? served.get(system) : undefined;
    if (system && name && source) return { id: t.id, name, schema: schema ?? null, system, source };
  }
  return null;
}

type Column = { column: string; alias: string; datatype: string | null };

function termTools(
  reading: Reading,
  read: ReadTerm,
  table: Located,
  skipped: string[],
): Generated[] {
  const { source, dialect } = table.source;
  const display = read.term.name ?? read.term.id;
  const one = snake(display);
  if (!one) {
    skipped.push(`${display} gives no tool name, so it has no tools.`);
    return [];
  }
  const q = dialect.quote;
  const from = table.schema ? `${q(table.schema)}.${q(table.name)}` : q(table.name);
  const columns = selected(read.columns, table.id);
  const list = columns.length
    ? columns.map((c) => `${q(c.column)} AS ${q(c.alias)}`).join(", ")
    : "*";
  const about = read.term.description ? ` ${display}: ${read.term.description}` : "";
  const tool = (name: string, what: string, statement: string, parameters: ToolParam[]) =>
    sqlToolDoc({ name, source, dialect, description: `${what}${about}`, statement, parameters });
  const out: Generated[] = [];

  // ponytail: the plural only adds "s"; a real inflector when a term reads wrong.
  const many = `search_${one}s`;
  const texts = columns.filter((c) => isText(c.datatype));
  const limit: ToolParam = {
    name: "limit",
    type: "integer",
    description: "The most rows to return.",
    default: SEARCH_LIMIT,
  };
  if (texts.length > 0) {
    const cells = texts.map((c) => `COALESCE(${q(c.column)}, '')`);
    const haystack = cells.length === 1 ? cells[0] : `CONCAT(${cells.join(", ' ', ")})`;
    const needle = contains(dialect, dialect.placeholder(1));
    const statement =
      `SELECT ${list} FROM ${from} WHERE LOWER(${haystack}) LIKE LOWER(${needle})` +
      ` LIMIT ${dialect.placeholder(2)}`;
    const query: ToolParam = {
      name: "query",
      type: "string",
      description: "Text to look for; empty matches every row.",
      default: "",
    };
    out.push({
      doc: tool(many, `Find ${display} rows whose text contains the query.`, statement, [
        query,
        limit,
      ]),
      sig: `${many}(query, limit?)`,
      note: `→ ${display}[]`,
      statement,
    });
  } else {
    skipped.push(`${many} takes no query: ${display} has no certified text column to search.`);
    const statement = `SELECT ${list} FROM ${from} LIMIT ${dialect.placeholder(1)}`;
    out.push({
      doc: tool(many, `List ${display} rows.`, statement, [limit]),
      sig: `${many}(limit?)`,
      note: `→ ${display}[]`,
      statement,
    });
  }

  const key = keyOf(reading, table.id);
  if (!key) {
    skipped.push(
      `get_${one} was left out: no foreign key points at ${table.name} and it has no id column.`,
    );
    return out;
  }
  const keyed = columns.find((c) => c.column === key);
  const param = keyed?.alias ?? snake(key);
  const datatype = keyed?.datatype ?? typeOf(reading, table.id, key);
  const statement = `SELECT ${list} FROM ${from} WHERE ${q(key)} = ${dialect.placeholder(1)}`;
  const id: ToolParam = {
    name: param,
    type: isInteger(datatype) ? "integer" : "string",
    description: `The ${display}’s ${param}.`,
  };
  out.push({
    doc: tool(`get_${one}`, `Fetch one ${display} by ${param}.`, statement, [id]),
    sig: `get_${one}(${param})`,
    note: `→ ${display}`,
    statement,
  });
  return out;
}

// The term's certified column attributes on the table, each as its attribute's name.
function selected(columns: AoColumnAttribute[], tableId: string): Column[] {
  const out: Column[] = [];
  for (const c of columns) {
    const column = c.primary_column?.table_id === tableId ? c.primary_column.column_name : null;
    if (c.certified !== true || !column) continue;
    const alias = snake(c.name ?? "") || snake(column) || column;
    if (!out.some((o) => o.alias === alias)) out.push({ column, alias, datatype: c.datatype });
  }
  return out;
}

// The engine's graph links are stored lowest id first (dal/exploration.py
// fetch_data_exploration_edges), so they do not say which side points at which. A column
// attribute does: its referenced_columns point at its primary_column (dal/attributes.py).
function keyOf(reading: Reading, tableId: string): string | null {
  const known = new Set<string>();
  for (const { columns } of reading.terms) {
    for (const c of columns) {
      const column = c.primary_column?.table_id === tableId ? c.primary_column.column_name : null;
      if (!column) continue;
      const refs = c.referenced_columns ?? [];
      if (refs.some((r) => r.table_id && r.table_id !== tableId)) return column;
      known.add(column);
    }
  }
  for (const link of reading.graph.links) {
    for (const fk of link.foreign_keys) {
      if (link.source === tableId && fk.source_column) known.add(fk.source_column);
      if (link.target === tableId && fk.target_column) known.add(fk.target_column);
    }
  }
  return known.has("id") ? "id" : null;
}

function typeOf(reading: Reading, tableId: string, column: string): string | null {
  for (const { columns } of reading.terms) {
    for (const c of columns) {
      const p = c.primary_column;
      if (p?.table_id === tableId && p.column_name === column && c.datatype) return c.datatype;
    }
  }
  return null;
}

/* ---------- small rules ---------- */

// "HighSchool" → "high_school", "Retention Rate" → "retention_rate".
function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const isText = (datatype: string | null) => /char|text|string|clob/i.test(datatype ?? "");

const isInteger = (datatype: string | null) =>
  /^(nullable\()?(u?int\d*|(big|small|tiny|medium)?int(eger)?|(big)?serial)\b/i.test(
    (datatype ?? "").trim(),
  );

// MySQL reads || as OR unless PIPES_AS_CONCAT; the other three read it as concatenation.
const contains = (dialect: Dialect, placeholder: string) =>
  dialect.engine === "mysql" ? `CONCAT('%', ${placeholder}, '%')` : `'%' || ${placeholder} || '%'`;

const isTool = (doc: ToolboxDoc) => doc.kind === "tool";

const toolsOf = (doc: ToolboxDoc): string[] =>
  Array.isArray(doc.tools) ? doc.tools.filter((t): t is string => typeof t === "string") : [];

function toolOf(docs: ToolboxDoc[], name: string): HostTool {
  const doc = docs.find((d) => isTool(d) && d.name === name);
  return { name, sig: doc ? sigOf(doc) : `${name}()` };
}

type DocParam = { name?: unknown; required?: unknown; default?: unknown; authServices?: unknown };

// A caller's parameters, as the mock writes them: an optional one ends in "?".
function sigOf(doc: ToolboxDoc): string {
  const params = ["parameters", "pathParams", "queryParams", "bodyParams", "headerParams"]
    .flatMap((key) => (Array.isArray(doc[key]) ? (doc[key] as DocParam[]) : []))
    .filter((p) => typeof p.name === "string" && p.authServices === undefined)
    .map((p) => `${p.name}${p.required === false || p.default !== undefined ? "?" : ""}`);
  return `${doc.name}(${params.join(", ")})`;
}

function termsToolset(name: string, made: Made[]): HostToolset {
  const terms = [...new Set(made.map((m) => m.term))].slice(0, 3);
  const summary = [...terms, ...(made.some((m) => m.metric) ? ["metrics"] : [])].join(" · ");
  return { name, summary, tools: made.map((m) => m.tool), defaultOn: true, kind: "terms" };
}
