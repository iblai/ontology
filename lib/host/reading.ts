// One reading of the engine: its connections, tables, joins, terms and their attributes.
// Kept in memory for a few seconds so the routes a page calls together share one reading.
// Ported from the old product's services/auto_ontology.py (caps, concurrency, error wording).

import type {
  AoColumnAttribute,
  AoConnectionConfig,
  AoData,
  AoDataGraph,
  AoDatabaseSummary,
  AoList,
  AoPage,
  AoPublicConnection,
  AoSchemasPayload,
  AoSemanticGraph,
  AoSemanticStatus,
  AoSqlAttribute,
  AoTag,
  AoTagItem,
  AoTermDetail,
  AoTermsPage,
} from "@/lib/ao-types";
import { aoJson } from "./ao";
import { HostError } from "./errors";
import { envName } from "./files";
import { currentPlatform } from "./platform";
import { dialectOf } from "./toolbox-config";
import type { HostGraph, HostSystem } from "./types";

export type ReadTerm = {
  term: AoTermDetail;
  columns: AoColumnAttribute[];
  sql: AoSqlAttribute[];
};

export type Reading = {
  connections: AoPublicConnection[];
  databases: AoDatabaseSummary[];
  graph: AoDataGraph;
  semantic: AoSemanticGraph;
  terms: ReadTerm[];
  pii: Record<string, number>; // connection name → columns tagged PII
  status: AoSemanticStatus;
};

const CALL_MS = 10_000; // one call
const DEADLINE_MS = 45_000; // one reading
const WORKERS = 8; // calls made at a time
// ponytail: the first TERM_CAP terms by name; a reading per database lifts it.
const TERM_CAP = 1000;
const ROW_CAP = 200; // tables, columns or calculations kept for one term
const TEXT_CAP = 2000; // characters of a description or an expression
const NAME_CAP = 255;
const PAGE = 100; // the engine's largest page (server/pagination.py MAX_PAGE_SIZE)
// ponytail: the engine caps an unscoped graph at 500 nodes; per-database graphs lift it.
const GRAPH_LIMIT = 500;
const KEEP_MS = 15_000;
const ID = /^[A-Za-z0-9-]{1,64}$/; // an id goes into a URL only when it looks like one

// One kept reading per platform, by key: a platform is never served another's.
const kept = new Map<string, { reading: Promise<Reading>; until: number }>();

/** The current platform's engine as it is now, or as it was at most a few seconds ago. */
export async function readEngine(): Promise<Reading> {
  const platform = currentPlatform();
  const held = kept.get(platform);
  if (held && Date.now() < held.until) return held.reading;
  const entry = { reading: read(), until: Number.POSITIVE_INFINITY };
  kept.set(platform, entry);
  entry.reading.then(
    () => {
      entry.until = Date.now() + KEEP_MS;
    },
    () => {
      if (kept.get(platform) === entry) kept.delete(platform);
    },
  );
  return entry.reading;
}

/** Drops the current platform's kept reading. Called after anything is written to its engine. */
export function forgetReading(): void {
  kept.delete(currentPlatform());
}

type Ask = <T>(path: string) => Promise<T>;

const text = (value: string | null | undefined, cap = NAME_CAP) =>
  (value ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, cap);

async function read(): Promise<Reading> {
  const started = Date.now();
  let listedCount = 0;
  let active = 0;
  const queue: (() => void)[] = [];
  // Every call waits for one of WORKERS slots, then at most CALL_MS and the reading's deadline.
  const ask: Ask = async <T>(path: string) => {
    if (active < WORKERS) active++;
    else await new Promise<void>((resume) => queue.push(resume));
    try {
      const left = DEADLINE_MS - (Date.now() - started);
      if (left <= 0) throw late(listedCount);
      return await within(aoJson<T>(path), Math.min(CALL_MS, left), () =>
        left < CALL_MS
          ? late(listedCount)
          : new HostError(504, `The engine did not answer ${path} within 10 seconds.`),
      );
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };

  const [connections, dbs, graph, semantic, status, piiItems, listed] = await Promise.all([
    ask<AoList<AoPublicConnection>>("/connections"),
    ask<AoList<AoDatabaseSummary>>("/datasources/dbs"),
    ask<AoData<AoDataGraph>>(`/exploration/graph?limit=${GRAPH_LIMIT}`),
    ask<AoData<AoSemanticGraph>>(`/exploration/semantic-graph?limit=${GRAPH_LIMIT}`),
    ask<AoSemanticStatus>("/semantic-compilation/status"),
    piiTargets(ask),
    listTerms(ask),
  ]);
  listedCount = listed.length;

  const [databases, terms] = await Promise.all([
    Promise.all(
      dbs.data.map(async (db) => {
        if (!ID.test(db.id)) return db;
        const found = await ask<AoSchemasPayload>(`/schemas/${db.id}`);
        return { ...db, schemas: found?.schemas ?? [] };
      }),
    ),
    Promise.all(listed.map((id) => readTerm(ask, id))),
  ]);

  return {
    connections: connections.data,
    databases,
    graph: graph.data,
    semantic: semantic.data,
    terms,
    pii: piiByConnection(piiItems, databases, connections.data),
    status,
  };
}

function late(terms: number): HostError {
  return new HostError(
    504,
    `Reading ${terms} terms took longer than ${DEADLINE_MS / 1000} seconds: nothing was changed.`,
  );
}

// aoFetch sets its own signal, so a slow call is given up on here rather than aborted.
function within<T>(work: Promise<T>, ms: number, error: () => HostError): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// The engine answers every row without `limit` and at most PAGE with it, so terms are paged.
async function listTerms(ask: Ask): Promise<string[]> {
  const ids: string[] = [];
  for (let skip = 0; skip < TERM_CAP; skip += PAGE) {
    const page = await ask<AoTermsPage>(`/terms?skip=${skip}&limit=${PAGE}`);
    ids.push(...page.terms.map((t) => t.id).filter((id) => ID.test(id)));
    if (page.terms.length < PAGE || skip + PAGE >= page.total) break;
  }
  return ids.slice(0, TERM_CAP);
}

// Without `limit` the engine answers every row; ROW_CAP is applied here.
async function readTerm(ask: Ask, id: string): Promise<ReadTerm> {
  const [term, columns, sql] = await Promise.all([
    ask<AoData<AoTermDetail>>(`/terms/${id}`),
    ask<AoPage<AoColumnAttribute>>(`/terms/${id}/column-attributes`),
    ask<AoPage<AoSqlAttribute>>(`/terms/${id}/sql-attributes`),
  ]);
  const t = term.data;
  return {
    term: {
      ...t,
      name: text(t.name) || t.id,
      description: text(t.description, TEXT_CAP),
      tables: (t.tables ?? []).slice(0, ROW_CAP),
    },
    columns: columns.data.slice(0, ROW_CAP).map((c) => ({
      ...c,
      name: text(c.name) || null,
      description: text(c.description, TEXT_CAP),
    })),
    // The statement itself is never cut: a cut statement would run something else.
    sql: sql.data.slice(0, ROW_CAP).map((s) => ({
      ...s,
      name: text(s.name) || null,
      description: text(s.description, TEXT_CAP),
      expression: s.expression === null ? null : text(s.expression, TEXT_CAP),
    })),
  };
}

// The tag named exactly "PII" and what carries it; null when the engine has no such tag.
async function piiTargets(ask: Ask): Promise<AoTagItem[] | null> {
  const tags = await ask<AoPage<AoTag>>("/tags?query=PII");
  const tag = tags.data.find((t) => t.name === "PII");
  if (!tag || !ID.test(tag.id)) return null;
  return (await ask<AoPage<AoTagItem>>(`/tags/${tag.id}/targets`)).data;
}

// With the PII tag, every ingested connection gets a count; without it, none does ("—").
function piiByConnection(
  items: AoTagItem[] | null,
  databases: AoDatabaseSummary[],
  connections: AoPublicConnection[],
): Record<string, number> {
  const pii: Record<string, number> = {};
  if (!items) return pii;
  for (const { database_name } of connections) {
    const db = databases.find((d) => d.name === database_name);
    if (!db) continue;
    pii[database_name] = items.filter((i) => i.type === "column" && i.database_id === db.id).length;
  }
  return pii;
}

/**
 * The connected systems with what the engine read from each. `env` are the secret names held,
 * `labels` what admins call them.
 */
export function systemsOf(
  reading: Reading,
  env: string[],
  labels: Record<string, string> = {},
): HostSystem[] {
  return reading.connections.map(({ database_name: name, connection }): HostSystem => {
    const db = reading.databases.find((d) => d.name === name);
    const tables = db ? db.schemas.reduce((sum, s) => sum + (s.tables_count ?? 0), 0) : null;
    const engine = connection?.type ?? "";
    const terms = db
      ? reading.terms.filter((t) => t.term.tables.some((x) => x.db_id === db.id)).length
      : null;
    return {
      name,
      label: labels[name] ?? name,
      engine,
      url: connection ? urlOf(connection) : "",
      tables,
      scoped: Boolean(
        connection?.schemas?.length ||
        connection?.schema ||
        connection?.table_allow_regex ||
        connection?.table_deny_regex,
      ),
      piiColumns: reading.pii[name] ?? null,
      terms,
      status: reading.status.running ? "compiling" : tables ? "ingested" : "ingesting",
      serve: dialectOf(engine) !== null && env.includes(envName(name, "DB_PASSWORD")),
    };
  });
}

function urlOf(c: AoConnectionConfig): string {
  if (c.type === "snowflake") return `snowflake://${c.user}@${c.account}/${c.database}`;
  const user = "user" in c && c.user ? `${c.user}@` : "";
  const port = "port" in c && c.port ? `:${c.port}` : "";
  return `${c.type}://${user}${c.host}${port}/${c.database}`;
}

/** The physical and semantic graphs and the compile status, as one answer. */
export function graphOf(reading: Reading): HostGraph {
  const { graph, semantic, status } = reading;
  return {
    systems: reading.connections.map((c) => c.database_name),
    tables: graph.nodes.map((n) => ({
      id: n.id,
      name: n.name ?? n.id,
      system: n.database_name ?? "",
      schema: n.schema_name,
      columns: n.columns_count,
    })),
    foreignKeys: graph.links
      .filter((l) => l.via_foreign_key)
      .map((l): [string, string] => [l.source, l.target]),
    terms: reading.terms.map(({ term, columns, sql }) => ({
      id: term.id,
      name: term.name ?? term.id,
      description: term.description ?? "",
      synonyms: term.synonyms ?? [],
      certified: term.name_certified === true && term.description_certified === true,
      tags: (term.tags ?? []).map((t) => t.name),
      tables: term.tables.map((t) => t.id),
      metrics: sql.map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        certified: s.certified === true,
        expression: s.expression ?? s.sql ?? "",
      })),
      properties: columns.length,
    })),
    termLinks: semantic.links.map((l): [string, string] => [l.source, l.target]),
    compile: {
      calculated: status.calculated,
      running: status.running,
      lastSuccessAt: status.last_success_at,
      lastFailureAt: status.last_failure_at,
    },
  };
}
