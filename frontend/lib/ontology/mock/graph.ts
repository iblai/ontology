import type {
  Db,
  GraphData,
  GraphKind,
  GraphLink,
  GraphLinkKind,
  GraphNode,
  GraphRecords,
  McpTool,
  Role,
  SchemaManifestTable,
} from "../types";
import { AUTO_ONTOLOGY } from "../connectable";

/** The terms the mock's Auto Ontology server holds on the seeded tables, with what a term's panel reads. */
export const MOCK_TERMS: {
  id: string;
  name: string;
  description: string;
  synonyms: string[];
  certification: string;
  table: string;
  elsewhere: number;
  /** A business name, then the column that holds it. */
  columns: [string, string][];
  /** A name, then its SQL expression. */
  calculations: [string, string][];
}[] = [
  {
    id: "student",
    name: "Student",
    description: "A person admitted to study here.",
    synonyms: ["learner", "pupil"],
    certification: "certified",
    table: "PS_STDNT_BIO",
    elsewhere: 0,
    columns: [
      ["Student ID", "EMPLID"],
      ["Birth date", "BIRTHDATE"],
    ],
    calculations: [],
  },
  {
    id: "enrollment",
    name: "Enrollment",
    description: "A student’s place in one class of one term.",
    synonyms: ["registration"],
    certification: "partial",
    table: "PS_STDNT_ENRL",
    elsewhere: 1,
    columns: [
      ["Student ID", "EMPLID"],
      ["Class number", "CLASS_NBR"],
      ["Units taken", "UNT_TAKEN"],
    ],
    calculations: [["Units in a term", "SUM(UNT_TAKEN)"]],
  },
  {
    id: "course",
    name: "Course",
    description: "A class offered in a term.",
    synonyms: ["class"],
    certification: "certified",
    table: "PS_CLASS_TBL",
    elsewhere: 0,
    columns: [
      ["Class number", "CLASS_NBR"],
      ["Subject", "SUBJECT"],
    ],
    calculations: [],
  },
  {
    id: "financial-aid-award",
    name: "Financial aid award",
    description: "Money granted to a student for one aid year.",
    synonyms: ["award"],
    certification: "pending",
    table: "PS_FIN_AID_AWD",
    elsewhere: 0,
    columns: [
      ["Aid year", "AID_YEAR"],
      ["Offered amount", "OFFER_AMOUNT"],
    ],
    calculations: [["Total offered", "SUM(OFFER_AMOUNT)"]],
  },
  {
    id: "career-term",
    name: "Career term",
    description: "A student’s standing in one term of a career.",
    synonyms: [],
    certification: "pending",
    table: "PS_STDNT_CAR_TERM",
    elsewhere: 0,
    columns: [
      ["Term", "STRM"],
      ["Academic career", "ACAD_CAREER"],
    ],
    calculations: [],
  },
];
/** A reading of that server: the five above in PeopleSoft's database, three in one no system here holds. */
export const MOCK_READING = {
  terms: 8,
  of: 8,
  databases: [
    { name: "CSPRD", terms: MOCK_TERMS.length },
    { name: "ADMISSIONS", terms: 3 },
  ],
};
/** The join that server inferred and no foreign key declares: enrollments to career terms. */
const MOCK_JOIN = ["PS_STDNT_ENRL", "PS_STDNT_CAR_TERM"];

/** The term the mock's model writes for a table: the one above for a seeded table, else its name in plain words. */
export function generatedTerm(table: string) {
  const known = MOCK_TERMS.find((t) => t.table === table);
  const words = table
    .replace(/^PS_/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const name =
    known?.name ??
    words
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    description: known?.description ?? `One row of ${table}.`,
    synonyms: known?.synonyms ?? [],
    columns: known?.columns ?? [],
  };
}

/** Whether a mock tool can change data: Twenty's operations, an endpoint that is not a GET, a statement that writes. */
export const changesData = (tool: McpTool) =>
  tool.type === "twenty" ||
  (tool.type === "http" && (tool.method ?? "GET") !== "GET") ||
  // A statement that does not start by reading, as the backend's own scan says.
  /^\s*(insert|update|delete|merge)\b/i.test(tool.statement ?? "");

export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const COLUMN_NAMES = [
  "id",
  "name",
  "status",
  "created_at",
  "updated_at",
  "term",
  "amount",
  "code",
  "type",
  "description",
  "owner_id",
  "notes",
  "email",
  "start_date",
  "end_date",
  "score",
];

/** Foreign keys the mock manifests would carry: table -> [column, referenced table]. */
const FOREIGN_KEYS: Record<string, [string, string][]> = {
  PS_STDNT_ENRL: [
    ["EMPLID", "PS_STDNT_BIO"],
    ["CLASS_NBR", "PS_CLASS_TBL"],
  ],
  PS_STDNT_CAR_TERM: [["EMPLID", "PS_STDNT_BIO"]],
  PS_FIN_AID_AWD: [["EMPLID", "PS_STDNT_BIO"]],
  enrollments: [
    ["user_id", "users"],
    ["course_id", "courses"],
  ],
  submissions: [
    ["assignment_id", "assignments"],
    ["user_id", "users"],
  ],
  assignments: [["course_id", "courses"]],
  applications: [["prospect_id", "prospects"]],
  decisions: [["application_id", "applications"]],
  ORDERS: [["CUSTOMER_ID", "CUSTOMERS"]],
};
const SQL_TABLE = /\b(?:from|join|into|update)\s+([A-Za-z_][\w$.]*)/gi;

class Graph {
  nodes = new Map<string, GraphNode>();
  links: GraphLink[] = [];
  node(
    kind: GraphKind,
    name: string,
    label = name,
    group = "",
    meta: Record<string, unknown> = {},
  ) {
    const id = `${kind}:${name}`;
    const existing = this.nodes.get(id);
    if (existing) Object.assign(existing.meta, meta);
    else this.nodes.set(id, { id, kind, label, group, meta, health: null });
    return id;
  }
  link(source: string, target: string, kind: GraphLinkKind, wildcard = false) {
    this.links.push({ source, target, kind, wildcard });
  }
  ref(source: string, kind: GraphLinkKind, targetKind: GraphKind, name: string) {
    const target = `${targetKind}:${name}`;
    if (!this.nodes.has(target)) {
      this.nodes.set(target, {
        id: target,
        kind: "missing",
        label: name,
        group: targetKind,
        meta: { expected: targetKind },
        health: "missing",
      });
      this.nodes.get(source)!.health = "dangling";
    }
    this.link(source, target, kind);
  }
}

const qualified = (t: SchemaManifestTable) =>
  t.schema_name ? `${t.schema_name}.${t.table_name}` : t.table_name;

/** Memory domains are entity groups; file counts are fabricated but stable. */
function domainsOf(db: Db): Map<string, number> {
  const out = new Map<string, number>();
  for (const svc of db.services)
    for (const t of svc.schema_manifest?.tables ?? []) {
      const g = t.entity_group ?? "other";
      if (g !== "other") out.set(g, 120 + (hash(g) % 700));
    }
  return out;
}

function roleDomains(paths: string[], domains: string[]): [string, boolean, boolean][] {
  const out: [string, boolean, boolean][] = [];
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    if (parts.length < 2 || parts[0] !== "ontology") continue;
    if (parts[1] === "*" || parts[1] === "**")
      out.push(...domains.map((d) => [d, true, true] as [string, boolean, boolean]));
    else out.push([parts[1], false, domains.includes(parts[1])]);
  }
  return out;
}

/** The same shape the backend builds, from the mock db. */
export function mockGraph(db: Db, columns: boolean): GraphData {
  const g = new Graph();
  const tablesByService = new Map<string, Map<string, string>>();
  // An Auto Ontology server holds no tables: it is not a system on the map, its terms are.
  const systems = db.services.filter((s) => s.adapter !== AUTO_ONTOLOGY);
  for (const svc of systems) {
    const sid = g.node("service", svc.name, svc.display_name, svc.name, {
      adapter: svc.adapter,
      status: svc.status,
    });
    const lookup = new Map<string, string>();
    const tables = svc.schema_manifest?.tables ?? [];
    for (const t of tables) {
      const q = qualified(t);
      const group = t.entity_group ?? "other";
      const tid = g.node("table", `${svc.name}:${q}`, t.table_name, group, {
        service: svc.name,
        schema: t.schema_name,
        row_count: t.row_count,
        column_count: t.column_count,
      });
      lookup.set(q.toLowerCase(), tid);
      lookup.set(t.table_name.toLowerCase(), tid);
      g.link(sid, tid, "has_table");
      g.link(tid, g.node("entity_group", group, group, group), "in_group");
      // The term generated for it here: no one has certified it.
      if (t.term) {
        const own = generatedTerm(t.table_name);
        const term = g.node("term", `${svc.name}:${own.id}`, own.name, "", {
          service: svc.name,
          description: own.description,
          synonyms: own.synonyms,
          certification: "pending",
          generated: true,
        });
        g.link(tid, term, "represents");
      }
      if (columns) {
        const offset = hash(tid) % COLUMN_NAMES.length;
        for (let i = 0; i < Math.min(t.column_count, 12); i++) {
          const name = COLUMN_NAMES[(offset + i) % COLUMN_NAMES.length];
          g.link(
            tid,
            g.node("column", `${svc.name}:${q}.${name}`, name, group, { table: tid }),
            "has_column",
          );
        }
      }
    }
    tablesByService.set(svc.name, lookup);
    for (const t of tables) {
      const tid = lookup.get(qualified(t).toLowerCase())!;
      for (const [, ref] of FOREIGN_KEYS[t.table_name] ?? []) {
        const target = lookup.get(ref.toLowerCase());
        if (target && target !== tid) g.link(tid, target, "references");
      }
    }
  }
  // The mock's terms stand on the seeded tables by table name; a backend matches database and schema too.
  const tableId = (name: string) =>
    [...tablesByService.values()].map((lookup) => lookup.get(name.toLowerCase())).find(Boolean);
  for (const layer of db.services.filter((s) => s.adapter === AUTO_ONTOLOGY)) {
    for (const term of MOCK_TERMS) {
      const table = tableId(term.table);
      if (!table) continue;
      const id = g.node("term", `${layer.name}:${term.id}`, term.name, "", {
        service: layer.name,
        description: term.description,
        synonyms: term.synonyms,
        certification: term.certification,
        elsewhere: term.elsewhere,
      });
      g.link(table, id, "represents");
    }
    const [from, to] = MOCK_JOIN.map(tableId);
    if (from && to && !g.links.some((l) => l.kind === "joins" && l.source === from))
      g.link(from, to, "joins");
  }
  const domains = domainsOf(db);
  for (const [d, files] of domains) g.node("memory_domain", d, d, d, { files });

  const serviceOfSource = new Map<string, string>();
  for (const src of db.mcp_sources) {
    g.node("source", src.name, src.name, "mcp", { type: src.type, host: src.host ?? "" });
    for (const svc of systems)
      if (src.name === svc.name || src.name.startsWith(`${svc.name}-`)) {
        g.link(`service:${svc.name}`, `source:${src.name}`, "exposes");
        serviceOfSource.set(src.name, svc.name);
      }
  }
  const domainLookup = new Map(
    [...domains.keys()].map((d) => [d.toLowerCase(), `memory_domain:${d}`]),
  );
  for (const tool of db.mcp_tools) {
    const svc = serviceOfSource.get(tool.source);
    const tid = g.node("tool", tool.name, tool.name, "mcp", {
      type: tool.type,
      source: tool.source,
      description: tool.description,
      statement: tool.statement ?? "",
      // What Access switches on: whether it can change data, how, and whose it is.
      write: changesData(tool),
      method: tool.method ?? "",
      service: tool.service ?? svc ?? "",
    });
    if (tool.source) g.ref(tid, "uses_source", "source", tool.source);
    // A tool the gateway runs on the system itself has no source between them.
    else if (tool.service && g.nodes.has(`service:${tool.service}`))
      g.link(`service:${tool.service}`, tid, "exposes");
    const lookup = svc ? (tablesByService.get(svc) ?? new Map<string, string>()) : domainLookup;
    for (const m of (tool.statement ?? "").matchAll(SQL_TABLE)) {
      const name = m[1].toLowerCase();
      const hit = lookup.get(name) ?? lookup.get(name.split(".").pop()!);
      if (hit && !g.links.some((l) => l.source === tid && l.target === hit && l.kind === "queries"))
        g.link(tid, hit, "queries");
    }
  }
  for (const ts of db.mcp_toolsets) {
    const sid = g.node("toolset", ts.name, ts.name, "mcp", { write: Boolean(ts.write) });
    for (const t of ts.tools) g.ref(sid, "contains", "tool", t);
  }

  for (const s of db.sync_schedules) {
    const sid = g.node("schedule", s.name, s.name, "sync", {
      cron: s.cron,
      mode: s.mode,
      enabled: s.enabled,
      description: s.description,
    });
    const svc = systems.find((x) => s.source === x.name || s.source.startsWith(`${x.name}-`));
    if (svc) g.link(sid, `service:${svc.name}`, "syncs_from");
    else g.ref(sid, "syncs_from", "service", s.source);
    g.ref(sid, "runs", "tool", s.tool);
    // Mock schedules carry no output: the tool's first queried table names the domain it fills.
    const queried = g.links.find((l) => l.source === `tool:${s.tool}` && l.kind === "queries");
    const domain = queried ? g.nodes.get(queried.target)?.group : undefined;
    if (domain && domains.has(domain)) g.link(sid, `memory_domain:${domain}`, "writes");
  }

  // `*` reaches the read-only toolsets; one that writes is reached only by name.
  const readOnly = db.mcp_toolsets.filter((ts) => !ts.write).map((ts) => ts.name);
  const domainNames = [...domains.keys()];
  for (const role of db.roles) {
    const rid = g.node("role", role.name, role.display_name, "roles", roleMeta(role));
    // A tool held by its own name, beside what the toolsets lend.
    for (const t of role.mcp_tools ?? []) g.ref(rid, "grants", "tool", t);
    const wild = role.mcp_toolsets.includes("*");
    if (wild) for (const t of readOnly) g.link(rid, `toolset:${t}`, "grants", true);
    for (const t of role.mcp_toolsets)
      if (t !== "*" && !(wild && readOnly.includes(t))) g.ref(rid, "grants", "toolset", t);
    for (const [d, wildcard, exists] of roleDomains(role.memory_paths, domainNames)) {
      if (exists) g.link(rid, `memory_domain:${d}`, "reads", wildcard);
      else g.ref(rid, "reads", "memory_domain", d);
    }
    if (role.cache_tables.includes("*"))
      for (const d of domainNames) g.link(rid, `memory_domain:${d}`, "caches", true);
    else
      for (const c of role.cache_tables) {
        if (domains.has(c)) g.link(rid, `memory_domain:${c}`, "caches");
        else g.ref(rid, "caches", "memory_domain", c);
      }
  }

  const degree = new Map<string, number>();
  for (const l of g.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  for (const n of g.nodes.values()) if (!degree.get(n.id) && !n.health) n.health = "orphan";
  const nodes = [...g.nodes.values()];
  const hubs = [...degree]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id, d]) => ({
      id,
      label: g.nodes.get(id)!.label,
      kind: g.nodes.get(id)!.kind,
      degree: d,
    }));
  return {
    ok: true,
    message: "",
    nodes,
    links: g.links,
    stats: {
      hubs,
      orphans: nodes.filter((n) => n.health === "orphan").length,
      dangling: nodes.filter((n) => n.health === "dangling").length,
    },
  };
}

function roleMeta(role: Role): Record<string, unknown> {
  return {
    admin_dashboard: role.admin_dashboard,
    agents: role.agents,
    memory_paths: role.memory_paths,
    cache_tables: role.cache_tables,
    mcp_toolsets: role.mcp_toolsets,
    mcp_tools: role.mcp_tools ?? [],
  };
}

/** Deterministic records per domain; enrollment records reference students and courses. */
export function mockRecords(db: Db, domain: string, limit: number): GraphRecords {
  const domains = domainsOf(db);
  const total = domains.get(domain);
  if (total === undefined)
    return { ok: false, message: "Unknown domain.", nodes: [], links: [], total: 0 };
  const prefix = domain.slice(0, 1).toUpperCase();
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const add = (d: string, stem: string, fields: Record<string, string>) => {
    const id = `memory_record:${d}:${stem}`;
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({
        id,
        kind: "memory_record",
        label: stem,
        group: d,
        meta: { domain: d, fields },
        health: null,
      });
    }
    return id;
  };
  for (let i = 1; i <= Math.min(total, limit); i++) {
    const stem = `${prefix}${String(i).padStart(4, "0")}`;
    const fields: Record<string, string> = { id: stem };
    if (domain === "enrollment") {
      const student = `S${String(((i * 7) % 120) + 1).padStart(4, "0")}`;
      const course = `C${100 + ((i * 3) % 40) + 1}`;
      fields.user_id = student;
      fields.course_id = course;
      const me = add(domain, stem, fields);
      if (domains.has("students"))
        links.push({ source: me, target: add("students", student, {}), kind: "links" });
      if (domains.has("courses"))
        links.push({ source: me, target: add("courses", course, {}), kind: "links" });
    } else add(domain, stem, fields);
  }
  return { ok: true, message: "", nodes, links, total };
}
