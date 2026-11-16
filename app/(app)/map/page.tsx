"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import {
  OntologyGraph,
  type GraphHandle,
  type GraphNode,
  type Layer,
} from "@/components/graph/ontology-graph";
import { SOURCE_COLORS, foreignKeys, tables, termMetrics, terms } from "@/lib/mock";
import { cn } from "@/lib/utils";

const stages = [
  ["Ingest", "schemas · columns · samples per connection"],
  ["Profile columns", "types · PII tags · distinct values"],
  ["Name entities", "terms per table → columns"],
  ["Resolve relationships", "joins · metrics · cross-system"],
  ["Compile", "semantic layer · vector index"],
  ["Publish tools", "object types → tools.yaml"],
];
type LogLine = { t: string; html: string; ok?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toTimeString().slice(0, 8);

export default function MapPage() {
  const graph = useRef<GraphHandle>(null);
  const [layer, setLayer] = useState<Layer>("both");
  const [stage, setStage] = useState(-1); // index running; 6 = all done
  const [log, setLog] = useState<LogLine[]>([]);
  const [counts, setCounts] = useState({ t: 0, s: 0, e: 0 });
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [banner, setBanner] = useState(false);
  const [merged, setMerged] = useState(false);
  const running = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback(
    (html: string, ok?: boolean) => setLog((l) => [...l, { t: now(), html, ok }]),
    [],
  );
  const tick = useCallback(() => graph.current && setCounts({ ...graph.current.counts() }), []);

  const run = useCallback(async () => {
    const g = graph.current;
    if (!g || running.current) return;
    running.current = true;
    g.reset();
    setLog([]);
    setSel(null);
    setBanner(false);
    setMerged(false);
    tick();
    const reveal = async (p: (n: GraphNode) => boolean, ms: number) => {
      await g.reveal(p, ms);
      tick();
    };
    setStage(0);
    push("<b>ingest</b> sis, lms, crm, finance → 202 accepted");
    await sleep(500);
    push("sis: 42 tables · lms: 61 tables (scoped 5) · crm: 3 · finance: 3");
    await reveal((n) => n.kind === "t" && n.src === "sis", 70);
    await reveal((n) => n.kind === "t" && n.src === "lms", 70);
    await reveal((n) => n.kind === "t" && (n.src === "crm" || n.src === "fin"), 70);
    setStage(1);
    push("profiling 109 tables · sampling 500 rows each");
    await sleep(500);
    push(
      "PII tags: <b>students.email</b>, <b>students.first_name</b>, <b>auth_user.email</b>, <b>person.email</b> · samples masked",
      true,
    );
    push("distinct probing: enrollments.status {REGISTERED, DROPPED, WAITLIST, WITHDRAWN}");
    await sleep(500);
    setStage(2);
    push("naming business terms per table…");
    await reveal(
      (n) =>
        n.kind === "s" &&
        ["Student", "Course", "Section", "Enrollment", "Instructor"].includes(n.id),
      240,
    );
    push('Student ← students (0.96) · "learner, enrollee"');
    await reveal(
      (n) => n.kind === "s" && ["Program", "Department", "Term", "Grade"].includes(n.id),
      220,
    );
    await reveal((n) => n.kind === "s", 220);
    push("14 terms · 41 column mappings · vector index written", true);
    setStage(3);
    push("resolving joins: 19 FKs confirmed, 3 inferred (no constraint)");
    await sleep(600);
    push("Student mapped to 3 tables in 3 databases: students, auth_user, person", true);
    push(
      "metrics: at_risk, retention_rate, dfw_rate, yield_rate, outstanding_balance, credit_load",
    );
    setBanner(true);
    await sleep(500);
    setStage(4);
    push("<b>POST /semantic/compile</b> → 202 · polling /semantic/status");
    await sleep(700);
    push("compiled · 14 terms · 11 relationships · 6 SQL attributes", true);
    setStage(5);
    push("14 object types → 22 tools · 3 toolsets · tools.yaml 9.8 KB", true);
    await sleep(400);
    setStage(6);
    push("<b>ready</b> → review the ontology, then expose", true);
    running.current = false;
  }, [push, tick]);

  useEffect(() => {
    const id = setTimeout(run, 250);
    return () => clearTimeout(id);
  }, [run]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  return (
    <>
      <PageHeader
        eyebrow="Step 2 · Dissect"
        title="Map"
        description="The engine ingests each database, profiles columns, names business terms and resolves joins, then compiles the semantic layer. The semantic layer is drawn over the physical one so you can see where each definition came from."
        className="mb-3"
        actions={
          <>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                running.current = false;
                run();
              }}
            >
              Re-run
            </Button>
            <Button size="lg" className="ibl-button-primary" render={<Link href="/ontology" />}>
              Review Model
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:h-[calc(100dvh-56px-32px-50px-110px)] 2xl:min-h-[560px] 2xl:grid-cols-[290px_minmax(0,1fr)_320px]">
        <Card className="order-last flex flex-col overflow-hidden lg:col-span-2 2xl:order-none 2xl:col-span-1">
          <div className="eyebrow mb-1.5">Pipeline</div>
          <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
            {stages.map(([b, s], i) => {
              const st = stage >= 6 || i < stage ? "done" : i === stage ? "run" : "idle";
              return (
                <div
                  key={b}
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
                    <b className="text-[13.5px] font-semibold text-gray-900">{b}</b>
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
                    l.ok && "text-emerald-600",
                    "[&_b]:font-semibold [&_b]:text-gray-900",
                  )}
                  dangerouslySetInnerHTML={{ __html: l.html }}
                />
              </div>
            ))}
          </div>
        </Card>

        <div className="relative h-[460px] lg:h-[580px] 2xl:h-auto 2xl:min-h-[460px]">
          <OntologyGraph ref={graph} layer={layer} onSelect={setSel} className="absolute inset-0" />
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
          {!sel ? (
            <div className="py-10 text-center text-sm text-gray-600">
              Select a table or term
              <br />
              <span className="text-xs">to see what was inferred</span>
            </div>
          ) : sel.kind === "t" ? (
            <TableDetail n={sel} />
          ) : (
            <TermDetail n={sel} />
          )}
        </Card>
      </div>

      {banner && (
        <div className="mt-3.5 flex flex-wrap items-start gap-3 rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] p-3.5">
          <div className="grid size-7 place-items-center rounded-md border border-[var(--border-color)] bg-white text-[#0058cc]">
            ⧉
          </div>
          <div className="min-w-[240px] flex-1 text-[13px] text-gray-700">
            <b className="text-gray-900">Same student, three systems.</b> The term <b>Student</b>{" "}
            maps to <code className="mono">sis.students</code>,{" "}
            <code className="mono">lms.auth_user</code> and <code className="mono">crm.person</code>
            . It is one object type; certify its name and description to publish it.
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" render={<Link href="/ontology" />}>
              Open Term
            </Button>
            <Button
              size="sm"
              className="ibl-button-primary"
              disabled={merged}
              onClick={() => setMerged(true)}
            >
              {merged ? "✓ Student certified" : "Certify Student"}
            </Button>
          </div>
        </div>
      )}
    </>
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

function TableDetail({ n }: { n: GraphNode }) {
  const t = terms.filter((x) => x.maps.includes(n.id)).map((x) => x.id);
  const fk = foreignKeys.filter((f) => f[0] === n.id || f[1] === n.id);
  const rows = tables.find((x) => x.id === n.id)?.rows ?? 0;
  const cols = n.cols ?? [];
  return (
    <>
      <div>
        <div className="eyebrow">
          Table · <span style={{ color: SOURCE_COLORS[n.src] }}>{n.src}</span>
        </div>
        <h3 className="mono mt-1 text-sm font-semibold text-gray-900">{n.id}</h3>
      </div>
      <div className="flex gap-4">
        {[
          [rows.toLocaleString(), "rows profiled"],
          [cols.length, "columns"],
          [fk.length, "joins"],
        ].map(([v, l]) => (
          <div key={l as string}>
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
          {t.length ? (
            t.map((x) => (
              <Pill key={x} tone="blue">
                {x}
              </Pill>
            ))
          ) : (
            <span className="text-xs text-gray-600">none yet</span>
          )}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-1">Columns</div>
        {cols.map((c) => (
          <Row
            key={c}
            l={<span className="mono">{c}</span>}
            r={
              /email|name/.test(c) ? (
                <Tag tone="red">PII</Tag>
              ) : (
                <code className="mono text-gray-500">
                  {/id$|_id|code/.test(c)
                    ? "key"
                    : /gpa|amount|balance|credits|percent|points/.test(c)
                      ? "numeric"
                      : /term|login|modified|posted|start|end/.test(c)
                        ? "temporal"
                        : "text"}
                </code>
              )
            }
          />
        ))}
      </div>
      <div>
        <div className="eyebrow mb-1">Joins</div>
        {fk.map((f) => (
          <Row
            key={f.join()}
            l={<span className="mono">{f[0]}</span>}
            r={<span className="mono text-gray-500">→ {f[1]}</span>}
          />
        ))}
      </div>
      <Button size="sm" variant="outline" render={<Link href="/ontology" />}>
        Open in Ontology
      </Button>
    </>
  );
}

function TermDetail({ n }: { n: GraphNode }) {
  const m = termMetrics[n.id] ?? [];
  const maps = n.maps ?? [];
  return (
    <>
      <div>
        <div className="eyebrow text-[#0058cc]">Business term</div>
        <h3 className="mt-1 text-lg font-semibold text-gray-900">{n.id}</h3>
        <div className="mt-1 text-[12.5px] text-gray-600">{n.desc}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(n.syn ?? []).map((s) => (
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
        {maps.map((t) => {
          const tb = tables.find((x) => x.id === t)!;
          return (
            <Row
              key={t}
              l={
                <span className="mono" style={{ color: SOURCE_COLORS[tb.src] }}>
                  {tb.src}.{t}
                </span>
              }
              r={<code className="mono text-gray-500">{tb.rows.toLocaleString()} rows</code>}
            />
          );
        })}
      </div>
      {maps.length > 1 && (
        <div className="rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] px-2.5 py-2 text-xs text-gray-700">
          Resolved across {maps.length} systems. Exposed as <b>one object type</b>.
        </div>
      )}
      <div>
        <div className="eyebrow mb-1">Metrics</div>
        {m.length ? (
          m.map((x) => (
            <Row
              key={x}
              l={<span className="mono">{x}</span>}
              r={<Tag tone="amber">suggested</Tag>}
            />
          ))
        ) : (
          <div className="text-xs text-gray-600">none inferred</div>
        )}
      </div>
      <div>
        <div className="eyebrow mb-1">Will become tools</div>
        <Row
          l={<span className="mono">get_{n.id.toLowerCase()}</span>}
          r={<code className="mono text-gray-500">(id)</code>}
        />
        <Row
          l={<span className="mono">search_{n.id.toLowerCase()}s</span>}
          r={<code className="mono text-gray-500">(query)</code>}
        />
        {m.map((x) => (
          <Row
            key={x}
            l={<span className="mono">{x}</span>}
            r={<code className="mono text-gray-500">(term?)</code>}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="ibl-button-primary">
          Certify
        </Button>
        <Button size="sm" variant="outline" render={<Link href="/ontology" />}>
          Edit in Ontology
        </Button>
      </div>
    </>
  );
}
