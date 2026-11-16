import type { AoColumnAttribute, AoSqlAttribute, AoTermDetail } from "@/lib/ao-types";
import type { HostGraph, HostSystem, HostToolset } from "@/lib/host/types";
import type { ObjectTypeView, OntologyTree, Status } from "@/lib/view/types";
import { systemColor } from "./graph";
import { labelOf } from "./systems";

/** "HighSchool" → "high_school", "Course Section" → "course_section". */
export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

export const linkName = (a: string, b: string) => `${snake(a)}_${snake(b)}`;

const status = (on: boolean | null | undefined): Status => (on ? "certified" : "suggested");
const byName = (a: string, b: string) => a.localeCompare(b);
const unique = (xs: string[]) => [...new Set(xs)].sort(byName);

function systemsOf(g: HostGraph, tableIds: string[]): Set<string> {
  return new Set(g.tables.filter((t) => tableIds.includes(t.id)).map((t) => t.system));
}

/** The Ontology page's tree and pills. */
export function ontologyTree(g: HostGraph, toolsets: HostToolset[]): OntologyTree {
  const nameOf = (id: string) => g.terms.find((t) => t.id === id)?.name ?? id;
  const certified = g.terms.filter((t) => t.certified).length;
  return {
    objectTypes: g.terms.map((t) => ({
      id: t.id,
      name: t.name,
      systems: systemsOf(g, t.tables).size,
      status: status(t.certified),
    })),
    linkTypes: g.termLinks.map(([a, b]) => linkName(nameOf(a), nameOf(b))),
    metrics: unique(g.terms.flatMap((t) => t.metrics.map((m) => m.name))),
    actions: toolsets
      .filter((t) => t.kind === "actions")
      .flatMap((t) => t.tools.map((x) => x.name)),
    tags: unique(g.terms.flatMap((t) => t.tags)),
    certified,
    suggested: g.terms.length - certified,
  };
}

const hasPii = (tags: { name: string }[] | null) =>
  (tags ?? []).some((t) => t.name.toUpperCase() === "PII");

/** One term in full: the engine's detail and attributes, placed on the graph. */
export function objectTypeView(input: {
  detail: AoTermDetail;
  columns: AoColumnAttribute[];
  sql: AoSqlAttribute[];
  graph: HostGraph;
  systems: HostSystem[];
  toolsets: HostToolset[];
}): ObjectTypeView {
  const { detail, columns, sql, graph: g, systems, toolsets } = input;
  const name = detail.name ?? "—";
  const own = g.terms.find((t) => t.id === detail.id);
  const tableIds = own?.tables ?? detail.tables.map((t) => t.id);
  const tables = tableIds.flatMap((id) => g.tables.filter((t) => t.id === id));
  const where = (id: string) => tables.find((t) => t.id === id);
  const keyName = `${snake(name)}_id`;

  return {
    id: detail.id,
    name,
    description: detail.description ?? "",
    tags: detail.tags.map((t) => t.name),
    systems: new Set(tables.map((t) => t.system)).size,
    status: status(detail.name_certified && detail.description_certified),
    synonyms: detail.synonyms ?? [],
    backing: tables.map((t, i) => ({
      color: systemColor(t.system, systems),
      name: `${labelOf(t.system, systems)}.${t.name}`,
      note: i === 0 ? "primary" : "shared key",
    })),
    properties: columns.map((c) => {
      const column = c.source_column ?? c.primary_column?.column_name ?? "—";
      const table = (c.table_id && where(c.table_id)) || null;
      const path = table
        ? `${labelOf(table.system, systems)}.${table.name}.${column}`
        : `${c.primary_column?.table_name ?? "—"}.${column}`;
      return {
        id: c.id,
        name: c.name ?? column,
        key: column === "id" || column === keyName || undefined,
        type: c.datatype ?? "—",
        column: path,
        pii: hasPii(c.tags),
        status: status(c.certified),
      };
    }),
    links: detail.related_terms.map((r) => {
      const other = g.terms.find((t) => t.id === r.id);
      const shared = tables.filter((t) => other?.tables.includes(t.id));
      return {
        name: linkName(name, r.name ?? "—"),
        dir: "→" as const,
        target: r.name ?? "—",
        via: shared.length
          ? shared.map((t) => `${labelOf(t.system, systems)}.${t.name}`).join(", ")
          : "—",
      };
    }),
    metrics: sql.map((m) => ({
      id: m.id,
      name: m.name ?? "—",
      expr: m.expression ?? m.sql ?? "—",
      grain: name,
      status: status(m.certified),
    })),
    actions: toolsets
      .filter((t) => t.kind === "actions")
      .flatMap((t) =>
        t.tools
          .filter((x) => `${x.name} ${x.sig}`.toLowerCase().includes(snake(name)))
          .map((x) => ({
            name: x.name,
            sig: x.sig.startsWith(x.name) ? x.sig.slice(x.name.length) : x.sig,
            via: `toolset ${t.name}`,
          })),
      ),
  };
}
