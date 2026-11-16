"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import {
  OntologyGraph,
  type GraphHandle,
  type GraphNode,
  type Layer,
} from "@/components/graph/ontology-graph";
import { QueryState } from "@/components/query-state";
import { useActions, useEngine, useGraph, usePipeline, useTableColumns } from "@/lib/data";
import { isDemo } from "@/lib/iblai/session";
import type { BannerView, GraphView, LogLine, TableRow, TermRow } from "@/lib/view/types";
import { cn } from "@/lib/utils";

const stages = [
  ["Ingest", "schemas · columns · samples per connection"],
  ["Profile columns", "types · PII tags · distinct values"],
  ["Name entities", "terms per table → columns"],
  ["Resolve relationships", "joins · metrics · cross-system"],
  ["Compile", "semantic layer · vector index"],
  ["Publish tools", "object types → tools.yaml"],
];
type Printed = { t: string; line: LogLine };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toTimeString().slice(0, 8);
// The scripted map's pacing: the wait after a stage's first line, and after the rest.
const GAP = [500, 500, 0, 600, 700, 400];
const TAIL = [0, 500, 0, 500, 0, 0];
const STALE = new Error("replay restarted");
const WORDS = "zero one two three four five six seven eight nine ten eleven twelve".split(" ");
const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type CertifyError = { id: string; at: "banner" | "term"; text: string };

export default function MapPage() {
  const gq = useGraph();
  const pq = usePipeline();
  const actions = useActions();
  const graph = useRef<GraphHandle>(null);
  const [layer, setLayer] = useState<Layer>("both");
  const [stage, setStage] = useState(-1); // index running; 6 = all done
  const [log, setLog] = useState<Printed[]>([]);
  const [counts, setCounts] = useState({ t: 0, s: 0, e: 0 });
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [banner, setBanner] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [certified, setCertified] = useState<Record<string, true>>({}); // demo writes no data
  const [certifying, setCertifying] = useState<string | null>(null);
  const [certifyError, setCertifyError] = useState<CertifyError | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const played = useRef(0); // stages replayed so far
  const target = useRef(0); // the engine's current stage
  const gen = useRef(0); // a restart bumps it, which stops the replay in flight
  const busy = useRef(false);
  const started = useRef(false);
  const latest = useRef({ graph: gq.data, pipeline: pq.data });
  latest.current = { graph: gq.data, pipeline: pq.data };

  const push = useCallback((line: LogLine) => setLog((l) => [...l, { t: now(), line }]), []);
  const tick = useCallback(() => graph.current && setCounts({ ...graph.current.counts() }), []);

  const drive = useCallback(async () => {
    const g = graph.current;
    if (!g || busy.current) return;
    busy.current = true;
    const my = gen.current;
    const wait = async (p: Promise<unknown>) => {
      await p;
      if (gen.current !== my) throw STALE;
    };
    const reveal = async (p: (n: GraphNode) => boolean, ms: number) => {
      await wait(g.reveal(p, ms));
      tick();
    };
    try {
      do {
        while (played.current < target.current) {
          const i = played.current;
          const view = latest.current.graph;
          const [first, ...rest] = latest.current.pipeline?.lines[i] ?? [];
          setStage(i);
          if (first) push(first);
          if (i === 2) {
            const lead = new Set(view?.terms.slice(0, 5).map((t) => t.id));
            await reveal((n) => n.kind === "s" && lead.has(n.id), 240);
            rest.slice(0, -1).forEach((l) => push(l));
            await reveal((n) => n.kind === "s", 220);
            rest.slice(-1).forEach((l) => push(l));
          } else {
            await wait(sleep(GAP[i]));
            rest.forEach((l) => push(l));
            if (i === 0) {
              for (const s of view?.sources ?? [])
                await reveal((n) => n.kind === "t" && n.src === s.key, 70);
              await reveal((n) => n.kind === "t", 70);
            }
            if (i === 3) setBanner(true);
            await wait(sleep(TAIL[i]));
          }
          played.current = i + 1;
        }
        // nodes that arrived after their stage had played
        if (played.current > 0) await reveal((n) => n.kind === "t", 70);
        if (played.current > 2) await reveal((n) => n.kind === "s", 220);
      } while (played.current < target.current);
      played.current = Math.min(played.current, target.current);
      setStage(target.current);
    } catch (e) {
      if (e !== STALE) throw e;
    } finally {
      if (gen.current === my) busy.current = false;
    }
  }, [push, tick]);

  const restart = useCallback(() => {
    const g = graph.current;
    if (!g) return;
    gen.current++;
    busy.current = false;
    started.current = true;
    played.current = 0;
    g.reset();
    setLog([]);
    setSel(null);
    setBanner(false);
    tick();
    void drive();
  }, [drive, tick]);
  const stop = useCallback(() => {
    gen.current++;
  }, []);

  const compile = useCallback(async () => {
    setCompiling(true);
    setCompileError(null);
    try {
      await actions.compile();
    } catch (e) {
      setCompileError(message(e));
    } finally {
      setCompiling(false);
    }
  }, [actions]);

  const certify = async (id: string, at: CertifyError["at"]) => {
    setCertifying(id);
    setCertifyError(null);
    try {
      await actions.certifyTerm(id, true);
      setCertified((c) => ({ ...c, [id]: true }));
    } catch (e) {
      setCertifyError({ id, at, text: message(e) });
    } finally {
      setCertifying(null);
    }
  };

  const ready = gq.data !== undefined && pq.data !== undefined;
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(restart, 250);
    return () => clearTimeout(id);
  }, [ready, restart]);
  useEffect(() => {
    if (!pq.data) return;
    target.current = pq.data.current;
    if (started.current) void drive();
  }, [pq.data, gq.data, drive]);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const selTable = sel?.kind === "t" ? gq.data?.tables.find((t) => t.id === sel.id) : undefined;
  const selTerm = sel?.kind === "s" ? gq.data?.terms.find((t) => t.id === sel.id) : undefined;
  const b = banner ? pq.data?.banner : null;

  return (
    <>
      <PageHeader
        eyebrow="Step 2 · Dissect"
        title="Map"
        description="The engine ingests each database, profiles columns, names business terms and resolves joins, then compiles the semantic layer. The semantic layer is drawn over the physical one so you can see where each definition came from."
        className="mb-3"
        actions={
          <>
            <div className="flex flex-col">
              <Button
                size="lg"
                variant="outline"
                disabled={compiling}
                onClick={() => (isDemo() ? restart() : void compile())}
              >
                Re-run
              </Button>
              {compileError && (
                <div className="mt-1 max-w-[40ch] text-xs text-red-600">{compileError}</div>
              )}
            </div>
            <Button size="lg" className="ibl-button-primary" render={<Link href="/ontology" />}>
              Review Model
            </Button>
          </>
        }
      />
      <Suspense fallback={null}>
        <DissectOnArrival graph={gq.data} onCompile={compile} />
      </Suspense>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:h-[calc(100dvh-56px-32px-50px-110px)] 2xl:min-h-[560px] 2xl:grid-cols-[290px_minmax(0,1fr)_320px]">
        <Card className="order-last flex flex-col overflow-hidden lg:col-span-2 2xl:order-none 2xl:col-span-1">
          <div className="eyebrow mb-1.5">Pipeline</div>
          <QueryState query={pq}>
            {() => (
              <>
                <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
                  {stages.map(([name, s], i) => {
                    // The stage in hand spins while it is replayed or something runs; else it waits.
                    const going = stage < (pq.data?.current ?? 0) || pq.data?.busy;
                    const here = going ? "run" : "idle";
                    const st = stage >= 6 || i < stage ? "done" : i === stage ? here : "idle";
                    return (
                      <div
                        key={name}
                        className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5 border-b border-[var(--border-color)] py-2 2xl:last:border-b-0"
                      >
                        <span
                          className={cn(
                            "grid size-[18px] place-items-center rounded-full border-2 border-gray-300 text-[10px] text-transparent",
                            st === "run" && "animate-spin border-[#0058cc] border-t-transparent",
                            st === "done" && "border-emerald-500 bg-emerald-500 text-white",
                          )}
                        >
                          ✓
                        </span>
                        <div>
                          <b className="text-[13.5px] font-semibold text-gray-900">{name}</b>
                          <div className="text-xs text-gray-600">{s}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  ref={logRef}
                  className="mono mt-2.5 h-44 overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[11.5px] leading-relaxed text-gray-600 2xl:h-auto 2xl:min-h-[120px] 2xl:flex-1"
                  aria-live="polite"
                >
                  {log.map((l, i) => (
                    <div key={i}>
                      <span className="text-gray-400">{l.t}</span>{" "}
                      <span
                        className={cn(
                          l.line.ok && "text-emerald-600",
                          "[&_b]:font-semibold [&_b]:text-gray-900",
                        )}
                      >
                        {l.line.parts.map((p, j) =>
                          typeof p === "string" ? (
                            <Fragment key={j}>{p}</Fragment>
                          ) : (
                            <b key={j}>{p.b}</b>
                          ),
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </QueryState>
        </Card>

        <div className="relative h-[460px] lg:h-[580px] 2xl:h-auto 2xl:min-h-[460px]">
          <QueryState query={gq} className="absolute inset-0">
            {(data) => (
              <OntologyGraph
                ref={graph}
                data={data}
                layer={layer}
                onSelect={setSel}
                className="absolute inset-0"
              />
            )}
          </QueryState>
          <div className="pointer-events-none absolute top-3 right-3 left-3 flex flex-wrap items-center justify-between gap-2">
            <div className="pointer-events-auto inline-flex overflow-hidden rounded-md border border-[var(--border-color)] bg-white">
              {(["both", "data", "sem"] as Layer[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayer(l)}
                  className={cn(
                    "h-[30px] px-2.5 text-[13px] text-gray-600",
                    layer === l && "bg-[#eef6fc] font-medium text-[#0058cc]",
                  )}
                >
                  {l === "both" ? "Both Layers" : l === "data" ? "Data" : "Semantic"}
                </button>
              ))}
            </div>
            <div className="pointer-events-auto flex flex-wrap gap-1.5">
              <Pill>{counts.t} tables</Pill>
              <Pill tone="blue">{counts.s} terms</Pill>
              <Pill>{counts.e} links</Pill>
            </div>
          </div>
          <div className="absolute right-3 bottom-3 left-3 flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-0.5 rounded-md border border-[var(--border-color)] bg-white px-2.5 py-1 text-[11.5px] text-gray-600">
            <span>
              <i className="mr-1.5 inline-block size-2.5 rounded-sm border-[1.5px] border-slate-500 bg-white align-[-1px]" />
              table
            </span>
            <span>
              <i className="mr-1.5 inline-block size-2.5 rounded-full bg-[#0058cc] align-[-1px]" />
              business term
            </span>
            <span className="text-gray-400">drag · hover · click</span>
          </div>
        </div>

        <Card className="flex max-h-[580px] flex-col gap-3 overflow-auto 2xl:max-h-none">
          {gq.data && selTable ? (
            <TableDetail t={selTable} data={gq.data} />
          ) : gq.data && selTerm ? (
            <TermDetail
              t={selTerm}
              data={gq.data}
              certified={selTerm.certified || selTerm.id in certified}
              busy={certifying === selTerm.id}
              error={
                certifyError?.at === "term" && certifyError.id === selTerm.id
                  ? certifyError.text
                  : null
              }
              onCertify={() => void certify(selTerm.id, "term")}
            />
          ) : (
            <div className="py-10 text-center text-sm text-gray-600">
              Select a table or term
              <br />
              <span className="text-xs">to see what was inferred</span>
            </div>
          )}
        </Card>
      </div>

      {b && (
        <Banner
          b={b}
          certified={b.certified || b.termId in certified}
          busy={certifying === b.termId}
          error={certifyError?.at === "banner" ? certifyError.text : null}
          onCertify={() => void certify(b.termId, "banner")}
        />
      )}
    </>
  );
}

/** The Systems page sends a new system here with ?dissect=1: compile once if nothing has. */
function DissectOnArrival(props: { graph: GraphView | undefined; onCompile: () => void }) {
  const dissect = useSearchParams().get("dissect") === "1";
  if (!dissect || !props.graph) return null;
  return <CompileOnce graph={props.graph} onCompile={props.onCompile} />;
}

function CompileOnce({ graph, onCompile }: { graph: GraphView; onCompile: () => void }) {
  const engine = useEngine();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || !engine.data || engine.data.running) return;
    if (graph.tables.length === 0 || graph.terms.length > 0) return;
    fired.current = true;
    onCompile();
  }, [engine.data, graph, onCompile]);
  return null;
}

function Banner({
  b,
  certified,
  busy,
  error,
  onCertify,
}: {
  b: BannerView;
  certified: boolean;
  busy: boolean;
  error: string | null;
  onCertify: () => void;
}) {
  const systems = new Set(b.tables.map((t) => t.split(".")[0])).size;
  return (
    <div className="mt-3.5 flex flex-wrap items-start gap-3 rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] p-3.5">
      <div className="grid size-7 place-items-center rounded-md border border-[var(--border-color)] bg-white text-[#0058cc]">
        ⧉
      </div>
      <div className="min-w-[240px] flex-1 text-[13px] text-gray-700">
        <b className="text-gray-900">
          Same {b.term.toLowerCase()}, {WORDS[systems] ?? systems} systems.
        </b>{" "}
        The term <b>{b.term}</b> maps to{" "}
        {b.tables.map((t, i) => (
          <Fragment key={t}>
            {i === 0 ? "" : i === b.tables.length - 1 ? " and " : ", "}
            <code className="mono">{t}</code>
          </Fragment>
        ))}
        . It is one object type; certify its name and description to publish it.
      </div>
      <div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            render={<Link href={`/ontology?term=${encodeURIComponent(b.termId)}`} />}
          >
            Open Term
          </Button>
          <Button
            size="sm"
            className="ibl-button-primary"
            disabled={certified || busy}
            onClick={onCertify}
          >
            {certified ? `✓ ${b.term} certified` : `Certify ${b.term}`}
          </Button>
        </div>
        {error && <div className="mt-1 max-w-[40ch] text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 border-b border-[var(--border-color)] py-1.5 text-[12.5px] break-all last:border-b-0">
      {l}
      {r}
    </div>
  );
}

function TableDetail({ t, data }: { t: TableRow; data: GraphView }) {
  const columns = useTableColumns(t.id);
  const src = data.sources.find((s) => s.key === t.src);
  const name = (id: string) => data.tables.find((x) => x.id === id)?.name ?? id;
  const mapped = data.terms.filter((x) => x.maps.includes(t.id));
  const fk = data.foreignKeys.filter((f) => f[0] === t.id || f[1] === t.id);
  return (
    <>
      <div>
        <div className="eyebrow">
          Table · <span style={{ color: src?.color }}>{src?.name ?? t.src}</span>
        </div>
        <h3 className="mono mt-1 text-sm font-semibold text-gray-900">{t.name}</h3>
      </div>
      <div className="flex gap-4">
        {[
          [t.rows === null ? "—" : t.rows.toLocaleString(), "rows profiled"],
          [columns.data?.length ?? "—", "columns"],
          [fk.length, "joins"],
        ].map(([v, l]) => (
          <div key={l}>
            <div className="text-[22px] leading-none font-semibold text-gray-900 tabular-nums">
              {v}
            </div>
            <div className="text-xs text-gray-600">{l}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="eyebrow mb-1">Maps to term</div>
        <div className="flex flex-wrap gap-1.5">
          {mapped.length ? (
            mapped.map((x) => (
              <Pill key={x.id} tone="blue">
                {x.name}
              </Pill>
            ))
          ) : (
            <span className="text-xs text-gray-600">none yet</span>
          )}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-1">Columns</div>
        <QueryState query={columns}>
          {(cols) =>
            cols.map((c) => (
              <Row
                key={c.name}
                l={<span className="mono">{c.name}</span>}
                r={
                  c.pii ? (
                    <Tag tone="red">PII</Tag>
                  ) : (
                    <code className="mono text-gray-500">{c.kind}</code>
                  )
                }
              />
            ))
          }
        </QueryState>
      </div>
      <div>
        <div className="eyebrow mb-1">Joins</div>
        {fk.map((f) => (
          <Row
            key={f.join()}
            l={<span className="mono">{name(f[0])}</span>}
            r={<span className="mono text-gray-500">→ {name(f[1])}</span>}
          />
        ))}
      </div>
      <Button size="sm" variant="outline" render={<Link href="/ontology" />}>
        Open in Ontology
      </Button>
    </>
  );
}

function TermDetail({
  t,
  data,
  certified,
  busy,
  error,
  onCertify,
}: {
  t: TermRow;
  data: GraphView;
  certified: boolean;
  busy: boolean;
  error: string | null;
  onCertify: () => void;
}) {
  const m = data.termMetrics[t.id] ?? [];
  const maps = t.maps
    .map((id) => data.tables.find((x) => x.id === id))
    .filter((x) => x !== undefined);
  const systems = new Set(maps.map((x) => x.src)).size;
  const tool = snake(t.name);
  return (
    <>
      <div>
        <div className="eyebrow text-[#0058cc]">Business term</div>
        <h3 className="mt-1 text-lg font-semibold text-gray-900">{t.name}</h3>
        <div className="mt-1 text-[12.5px] text-gray-600">{t.desc}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {t.syn.map((s) => (
          <span
            key={s}
            className="mono rounded-full bg-[var(--hover-bg)] px-2.5 py-1 text-gray-700"
          >
            {s}
          </span>
        ))}
      </div>
      <div>
        <div className="eyebrow mb-1">Mapped columns</div>
        {maps.map((tb) => {
          const src = data.sources.find((s) => s.key === tb.src);
          return (
            <Row
              key={tb.id}
              l={
                <span className="mono" style={{ color: src?.color }}>
                  {src?.name ?? tb.src}.{tb.name}
                </span>
              }
              r={
                <code className="mono text-gray-500">
                  {tb.rows === null ? "—" : `${tb.rows.toLocaleString()} rows`}
                </code>
              }
            />
          );
        })}
      </div>
      {systems > 1 && (
        <div className="rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] px-2.5 py-2 text-xs text-gray-700">
          Resolved across {systems} systems. Exposed as <b>one object type</b>.
        </div>
      )}
      <div>
        <div className="eyebrow mb-1">Metrics</div>
        {m.length ? (
          m.map((x) => (
            <Row
              key={x.id}
              l={<span className="mono">{x.name}</span>}
              r={
                <Tag tone={x.certified ? "green" : "amber"}>
                  {x.certified ? "certified" : "suggested"}
                </Tag>
              }
            />
          ))
        ) : (
          <div className="text-xs text-gray-600">none inferred</div>
        )}
      </div>
      <div>
        <div className="eyebrow mb-1">Will become tools</div>
        <Row
          l={<span className="mono">get_{tool}</span>}
          r={<code className="mono text-gray-500">(id)</code>}
        />
        <Row
          l={<span className="mono">search_{tool}s</span>}
          r={<code className="mono text-gray-500">(query)</code>}
        />
        {m.map((x) => (
          <Row
            key={x.id}
            l={<span className="mono">{x.name}</span>}
            r={<code className="mono text-gray-500">(term?)</code>}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="ibl-button-primary"
          disabled={certified || busy}
          onClick={onCertify}
        >
          {certified ? "✓ certified" : "Certify"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/ontology?term=${encodeURIComponent(t.id)}`} />}
        >
          Edit in Ontology
        </Button>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </>
  );
}
