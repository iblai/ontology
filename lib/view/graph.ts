import type { HostGraph, HostSystem } from "@/lib/host/types";
import type { GraphView } from "@/lib/view/types";
import { engineKind } from "./catalog";
import { labelOf } from "./systems";

/** A system's colour: its engine's catalog colour. */
export function systemColor(name: string, systems: HostSystem[]): string {
  return engineKind(systems.find((s) => s.name === name)?.engine ?? "").color;
}

/** The engine's two graphs as the Map draws them. Rows are unknown and columns load per table. */
export function graphView(g: HostGraph, systems: HostSystem[]): GraphView {
  return {
    sources: g.systems.map((name) => ({
      key: name,
      name: labelOf(name, systems),
      color: systemColor(name, systems),
    })),
    tables: g.tables.map((t) => ({ id: t.id, name: t.name, src: t.system, rows: null, cols: [] })),
    foreignKeys: g.foreignKeys,
    terms: g.terms.map((t) => ({
      id: t.id,
      name: t.name,
      maps: t.tables,
      desc: t.description,
      syn: t.synonyms,
      certified: t.certified,
      tags: t.tags,
    })),
    termLinks: g.termLinks,
    termMetrics: Object.fromEntries(
      g.terms.map((t) => [
        t.id,
        t.metrics.map((m) => ({ id: m.id, name: m.name, certified: m.certified })),
      ]),
    ),
  };
}
