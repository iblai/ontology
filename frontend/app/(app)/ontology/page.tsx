import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import { objectTypes, studentActions, studentLinks, studentMetrics, studentProperties } from "@/lib/mock";
import { cn } from "@/lib/utils";

function TreeGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="eyebrow mt-3.5 mb-1.5 first:mt-0">{title} <span className="ml-1 font-normal text-gray-400">{count}</span></h4>
      {children}
    </div>
  );
}
function TreeItem({ color, label, right, active }: { color: string; label: string; right?: string; active?: boolean }) {
  return (
    <button type="button" className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-gray-700 hover:bg-[var(--hover-bg)]", active && "bg-[#eef6fc] font-medium text-[#0058cc] hover:bg-[#eef6fc]")}>
      <span className="size-[9px] shrink-0 rounded-[3px]" style={{ background: color }} />
      {label}
      {right && <span className="ml-auto text-[11px] text-gray-400">{right}</span>}
    </button>
  );
}
const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";

export default function OntologyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Step 3 · Model"
        title="Ontology"
        description="Terms become object types, joins become link types, SQL attributes become metrics. Certify what is right, fix what is not. Only certified definitions are compiled into tools."
        actions={
          <>
            <Pill tone="amber">9 suggested</Pill>
            <Pill tone="green">14 certified</Pill>
            <Button size="lg" variant="outline" className="ibl-outline-primary" render={<Link href="/mcp/new" />}>Expose as MCP</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)]">
        <Card className="h-fit">
          <TreeGroup title="Object Types" count={14}>
            {objectTypes.slice(0, 9).map((o) => <TreeItem key={o.name} color="#0058cc" label={o.name} right={o.status === "suggested" ? "new" : o.systems > 1 ? `${o.systems} systems` : undefined} active={o.name === "Student"} />)}
            <button type="button" className="h-8 w-full px-2 text-left text-[13.5px] text-gray-400">+ 5 more</button>
          </TreeGroup>
          <TreeGroup title="Link Types" count={11}>{["enrolled_in", "teaches", "became"].map((l) => <TreeItem key={l} color="#00b0ef" label={l} />)}</TreeGroup>
          <TreeGroup title="Metrics" count={6}>{["retention_rate", "dfw_rate", "yield_rate"].map((l) => <TreeItem key={l} color="#10b981" label={l} />)}</TreeGroup>
          <TreeGroup title="Actions" count={3}>{["flag_at_risk", "create_advising_note"].map((l) => <TreeItem key={l} color="#f59e0b" label={l} />)}</TreeGroup>
          <TreeGroup title="Tags" count={2}>{["person", "billable"].map((l) => <TreeItem key={l} color="#9ca3af" label={l} />)}</TreeGroup>
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3.5">
            <div className="grid size-[42px] place-items-center rounded-[10px] bg-[#eef6fc] text-lg font-bold text-[#0058cc]">S</div>
            <div className="min-w-[200px] flex-1">
              <h2 className="text-lg font-semibold text-gray-900">Student</h2>
              <div className="text-[12.5px] text-gray-600">A person admitted to and enrolled in at least one program. Tagged <b>person</b>. Mapped to tables in 3 systems.</div>
            </div>
            <Pill tone="green" dot>certified</Pill>
            <Button size="sm" variant="outline">Edit</Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            Synonyms
            {["learner", "enrollee", "pupil"].map((s) => <span key={s} className="mono rounded-full bg-[var(--hover-bg)] px-2.5 py-1 text-gray-700">{s}</span>)}
            <span className="mono rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-gray-400">+ add</span>
          </div>

          <Section title="Backing Datasets" hint="· from term → column mapping">
            <div className="flex flex-wrap gap-2">
              {[["#336791", "sis.students", "primary · 48,211 rows"], ["#E48E00", "lms.auth_user", "join on lower(email)"], ["#7C3AED", "crm.person", "join on lower(email)"]].map(([c, n, d]) => (
                <div key={n} className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-2.5 py-2 text-[12.5px] text-gray-600"><span className="size-[9px] rounded-[3px]" style={{ background: c }} /><code className="mono text-gray-900">{n}</code><span>{d}</span></div>
              ))}
            </div>
          </Section>

          <Section title="Properties" hint={<Pill>12</Pill>}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className={th}>Property</TableHead><TableHead className={th}>Type</TableHead><TableHead className={th}>Backing column</TableHead><TableHead className={th}>Flags</TableHead><TableHead className={th}>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {studentProperties.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-semibold text-gray-900">{p.name}{p.key && <span className="ml-1 text-xs font-normal text-gray-500">key</span>}</TableCell>
                      <TableCell className="mono">{p.type}</TableCell>
                      <TableCell className="mono">{p.column}</TableCell>
                      <TableCell>{p.pii && <Tag tone="red">PII</Tag>}</TableCell>
                      <TableCell><Tag tone={p.status === "certified" ? "green" : "amber"}>{p.status}</Tag></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section title="Links">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
              {studentLinks.map((l) => (
                <div key={l.name} className="rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-gray-700"><b className="mono font-semibold text-[#0058cc]">{l.name}</b> {l.dir} {l.target}<small className="mt-0.5 block text-gray-600">{l.via}</small></div>
              ))}
            </div>
          </Section>

          <Section title="Metrics" hint="· certified SQL expressions">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className={th}>Metric</TableHead><TableHead className={th}>Expression</TableHead><TableHead className={th}>Grain</TableHead><TableHead className={th}>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {studentMetrics.map((m) => (
                    <TableRow key={m.name}><TableCell className="font-semibold text-gray-900">{m.name}</TableCell><TableCell><code className="mono">{m.expr}</code></TableCell><TableCell>{m.grain}</TableCell><TableCell><Tag tone={m.status === "certified" ? "green" : "amber"}>{m.status}</Tag></TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section title="Actions" hint="· write tools in the server config, gated by toolset">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
              {studentActions.map((a) => (
                <div key={a.name} className="rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-gray-700"><b className="mono font-semibold text-[#0058cc]">{a.name}</b>{a.sig}<small className="mt-0.5 block text-gray-600">{a.via}</small></div>
              ))}
            </div>
          </Section>
        </Card>
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">{title} {hint && <span className="text-xs font-normal text-gray-600">{hint}</span>}</h3>
      {children}
    </div>
  );
}
