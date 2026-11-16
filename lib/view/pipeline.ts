import type { HostGraph, HostGraphTerm, HostSystem, HostToolset } from "@/lib/host/types";
import type { BannerView, LogLine, PipelineView } from "@/lib/view/types";
import { labelOf, unsettled } from "./systems";

const s = (v: number, one: string) => `${v} ${one}${v === 1 ? "" : "s"}`;

/** Which of the six stages the engine's state shows as finished. */
export function stagesDone(g: HostGraph, systems: HostSystem[]) {
  const terms = g.terms.length > 0;
  // A compile that has finished ends every stage from naming on, whatever it found.
  const compiled = g.compile.calculated && !g.compile.running;
  return [
    systems.length > 0 && systems.every((x) => g.tables.some((t) => t.system === x.name)),
    g.tables.length > 0 && g.tables.every((t) => t.columns !== null),
    terms || compiled,
    compiled || (terms && (g.foreignKeys.length > 0 || g.termLinks.length > 0)),
    compiled,
    compiled, // tools are read from certified terms: nothing runs to publish them
  ];
}

const tablesOf = (g: HostGraph, term: HostGraphTerm) =>
  term.tables.flatMap((id) => g.tables.filter((t) => t.id === id));

/** The first uncertified term mapped to tables in two or more systems, else the first certified. */
export function bannerOf(g: HostGraph, systems: HostSystem[] = []): BannerView | null {
  const wide = g.terms.filter((t) => new Set(tablesOf(g, t).map((x) => x.system)).size >= 2);
  const term = wide.find((t) => !t.certified) ?? wide[0];
  if (!term) return null;
  return {
    termId: term.id,
    term: term.name,
    tables: tablesOf(g, term).map((t) => `${labelOf(t.system, systems)}.${t.name}`),
    certified: term.certified,
  };
}

/** Per stage, the log lines in the mocked log's voice, from real numbers and names. */
export function pipelineLines(
  g: HostGraph,
  systems: HostSystem[],
  toolsets: HostToolset[],
): LogLine[][] {
  const names = systems.map((x) => x.label);
  const columns = g.tables.reduce((n, t) => n + (t.columns ?? 0), 0);
  const pii = systems.filter((x) => x.piiColumns !== null);
  const metrics = g.terms.flatMap((t) => t.metrics);
  const mappings = g.terms.reduce((n, t) => n + t.properties, 0);
  const named = g.terms.find((t) => t.tables.length > 0);
  const banner = bannerOf(g, systems);
  const published = toolsets.filter((t) => t.kind === "terms");
  const tools = published.reduce((n, t) => n + t.tools.length, 0);

  const ingest: LogLine[] = [
    { parts: [{ b: "ingest" }, ` ${names.join(", ")} → ${s(names.length, "system")}`] },
    {
      parts: [
        systems
          .map(
            (x) => `${x.label}: ${s(g.tables.filter((t) => t.system === x.name).length, "table")}`,
          )
          .join(" · "),
      ],
    },
  ];
  const profile: LogLine[] = [
    { parts: [`profiling ${s(g.tables.length, "table")} · ${s(columns, "column")}`] },
  ];
  if (pii.length)
    profile.push({
      parts: [
        "PII tags: ",
        pii.map((x) => `${x.name} ${s(x.piiColumns ?? 0, "column")}`).join(" · "),
      ],
      ok: true,
    });
  const name: LogLine[] = [];
  if (named)
    name.push({
      parts: [
        { b: named.name },
        ` ← ${tablesOf(g, named)
          .map((t) => t.name)
          .join(", ")}`,
        named.synonyms.length ? ` · “${named.synonyms.join(", ")}”` : "",
      ],
    });
  name.push({
    parts: [`${s(g.terms.length, "term")} · ${s(mappings, "column mapping")}`],
    ok: true,
  });
  const resolve: LogLine[] = [
    { parts: [`resolving joins: ${s(g.foreignKeys.length, "foreign key")}`] },
  ];
  if (banner) {
    const term = g.terms.find((t) => t.id === banner.termId);
    const systemsOf = term ? new Set(tablesOf(g, term).map((t) => t.system)).size : 0;
    resolve.push({
      parts: [
        { b: banner.term },
        ` mapped to ${s(banner.tables.length, "table")} in ${s(systemsOf, "system")}: `,
        banner.tables.join(", "),
      ],
      ok: true,
    });
  }
  if (metrics.length)
    resolve.push({ parts: [`metrics: ${metrics.map((m) => m.name).join(", ")}`] });
  const compile: LogLine[] = [
    {
      parts: [
        `compiled · ${s(g.terms.length, "term")} · ${s(g.termLinks.length, "relationship")} · ${s(metrics.length, "SQL attribute")}`,
      ],
      ok: true,
    },
  ];
  const publish: LogLine[] = [
    {
      parts: [
        `${s(g.terms.filter((t) => t.certified).length, "object type")} → ${s(tools, "tool")} · ${s(published.length, "toolset")}`,
      ],
      ok: true,
    },
    { parts: [{ b: "ready" }, " → review the ontology, then expose"], ok: true },
  ];
  return [ingest, profile, name, resolve, compile, publish];
}

export function pipelineView(
  g: HostGraph,
  systems: HostSystem[],
  toolsets: HostToolset[],
): PipelineView {
  const done = stagesDone(g, systems);
  const current = done.indexOf(false);
  return {
    current: current === -1 ? 6 : current,
    busy: g.compile.running || unsettled(systems),
    lines: pipelineLines(g, systems, toolsets),
    banner: bannerOf(g, systems),
  };
}
