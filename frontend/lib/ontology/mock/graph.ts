import type {
  Db,
  GraphData,
  GraphKind,
  GraphLink,
  GraphLinkKind,
  GraphNode,
  GraphRecords,
  Role,
  SchemaManifestTable,
} from "../types";

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
  for (const svc of db.services) {
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
  const domains = domainsOf(db);
  for (const [d, files] of domains) g.node("memory_domain", d, d, d, { files });

  const serviceOfSource = new Map<string, string>();
  for (const src of db.mcp_sources) {
    g.node("source", src.name, src.name, "mcp", { type: src.type, host: src.host ?? "" });
    for (const svc of db.services)
      if (src.name === svc.name || src.name.startsWith(`${svc.name}-`)) {
        g.link(`service:${svc.name}`, `source:${src.name}`, "exposes");
        serviceOfSource.set(src.name, svc.name);
      }
  }
  const domainLookup = new Map(
    [...domains.keys()].map((d) => [d.toLowerCase(), `memory_domain:${d}`]),
  );
  for (const tool of db.mcp_tools) {
    const tid = g.node("tool", tool.name, tool.name, "mcp", {
      type: tool.type,
      source: tool.source,
      description: tool.description,
      statement: tool.statement ?? "",
    });
    g.ref(tid, "uses_source", "source", tool.source);
    const svc = serviceOfSource.get(tool.source);
    const lookup = svc ? (tablesByService.get(svc) ?? new Map<string, string>()) : domainLookup;
    for (const m of (tool.statement ?? "").matchAll(SQL_TABLE)) {
      const name = m[1].toLowerCase();
      const hit = lookup.get(name) ?? lookup.get(name.split(".").pop()!);
      if (hit && !g.links.some((l) => l.source === tid && l.target === hit && l.kind === "queries"))
        g.link(tid, hit, "queries");
    }
  }
  for (const ts of db.mcp_toolsets) {
    const sid = g.node("toolset", ts.name, ts.name, "mcp");
    for (const t of ts.tools) g.ref(sid, "contains", "tool", t);
  }

  for (const s of db.sync_schedules) {
    const sid = g.node("schedule", s.name, s.name, "sync", {
      cron: s.cron,
      mode: s.mode,
      enabled: s.enabled,
      description: s.description,
    });
    const svc = db.services.find((x) => s.source === x.name || s.source.startsWith(`${x.name}-`));
    if (svc) g.link(sid, `service:${svc.name}`, "syncs_from");
    else g.ref(sid, "syncs_from", "service", s.source);
    g.ref(sid, "runs", "tool", s.tool);
    // Mock schedules carry no output: the tool's first queried table names the domain it fills.
    const queried = g.links.find((l) => l.source === `tool:${s.tool}` && l.kind === "queries");
    const domain = queried ? g.nodes.get(queried.target)?.group : undefined;
    if (domain && domains.has(domain)) g.link(sid, `memory_domain:${domain}`, "writes");
  }

  const toolsetIds = [...g.nodes.keys()].filter((id) => id.startsWith("toolset:"));
  const domainNames = [...domains.keys()];
  for (const role of db.roles) {
    const rid = g.node("role", role.name, role.display_name, "roles", roleMeta(role));
    if (role.mcp_toolsets.includes("*")) for (const t of toolsetIds) g.link(rid, t, "grants", true);
    else for (const t of role.mcp_toolsets) g.ref(rid, "grants", "toolset", t);
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
