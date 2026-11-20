import type { HostApi, HostSystem, HostToolset } from "@/lib/host/types";
import type { ApiRow, PrebuiltRow, SystemRow } from "@/lib/view/types";
import { catalog, engineKind } from "./catalog";

const n = (v: number | null) => (v === null ? "—" : String(v));
const plural = (v: number | null, one: string) => `${n(v)} ${one}${v === 1 ? "" : "s"}`;

/** "42 tables · 2 PII columns", "3 tables scoped", "3 tables"; "—" where a number is unknown. */
export function systemDetail(s: HostSystem): string {
  if (s.scoped) return `${plural(s.tables, "table")} scoped`;
  if (s.piiColumns === 0) return plural(s.tables, "table");
  return `${plural(s.tables, "table")} · ${plural(s.piiColumns, "PII column")}`;
}

/** What to print for a system: the admin's name for it, else its own. */
export const labelOf = (name: string, systems: HostSystem[]) =>
  systems.find((s) => s.name === name)?.label ?? name;

/** Whether any system is still being read or compiled. */
export const unsettled = (systems: HostSystem[]) => systems.some((s) => s.status !== "ingested");

export function systemRow(s: HostSystem): SystemRow {
  const kind = engineKind(s.engine);
  return {
    key: s.name,
    name: s.label,
    engine: kind.name,
    abbr: kind.abbr,
    color: kind.color,
    url: s.url,
    detail: systemDetail(s),
    status: s.status,
    dissect: catalog.find((c) => c.name === kind.name)?.dissect ?? false,
    serve: s.serve,
    tables: s.tables,
    scoped: s.scoped,
    pii: s.piiColumns,
    terms: s.terms,
  };
}

export function apiRow(a: HostApi): ApiRow {
  return { name: a.name, baseUrl: a.baseUrl, endpoints: a.endpoints.length, tools: a.tools };
}

/** One row per raw toolset (`<system>-raw`), for the Prebuilt tab. */
export function prebuiltRows(toolsets: HostToolset[], systems: HostSystem[]): PrebuiltRow[] {
  return toolsets
    .filter((t) => t.kind === "raw")
    .map((t) => {
      const name = t.name.replace(/-raw$/, "");
      const engine = systems.find((s) => s.name === name)?.engine ?? "—";
      const label = `${labelOf(name, systems)} · ${engine} · execute_sql, list_tables`;
      return { toolset: t.name, label };
    });
}

/** The URL under another scheme: what follows the scheme stays, except to or from `local://`. */
export function withScheme(url: string, scheme: string): string {
  const old = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)?.[0] ?? "";
  if (old === scheme) return url;
  if (old === "local://" || scheme === "local://") return scheme;
  return scheme + url.slice(old.length);
}
