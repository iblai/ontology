"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import { apiSystems, catalog, systems, type CatalogKind } from "@/lib/mock";
import { cn } from "@/lib/utils";

const filters = ["All", "Databases", "Warehouses", "APIs", "Cloud"] as const;
const groupOf: Record<string, CatalogKind["group"]> = { Databases: "db", Warehouses: "wh", APIs: "api", Cloud: "gc" };

function Cap({ kind, children }: { kind: "o" | "m" | "x"; children: string }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide", kind === "o" && "bg-[#eef6fc] text-[#0058cc]", kind === "m" && "bg-emerald-50 text-emerald-600", kind === "x" && "bg-[var(--hover-bg)] text-gray-400")}>
      {children}
    </span>
  );
}

export default function SystemsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [name, setName] = useState("finance");
  const [test, setTest] = useState<"idle" | "running" | "ok">("idle");
  const shown = catalog.filter((c) => filter === "All" || c.group === groupOf[filter]);

  return (
    <>
      <PageHeader
        eyebrow="Step 1 · Connect"
        title="Systems"
        description="Pick from the catalog or wrap any HTTP endpoint. Databases are dissected into the ontology and served; HTTP APIs are served as named tools only. Credentials are tested before they are saved."
        actions={
          <div className="inline-flex overflow-hidden rounded-md border border-[var(--border-color)] bg-white">
            {filters.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn("h-[30px] px-2.5 text-[13px] text-gray-600", filter === f && "bg-[#eef6fc] font-medium text-[#0058cc]")}>
                {f}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <Card className="mb-3.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Connected to Institution</h3>
              <span className="text-xs text-gray-600">{systems.length} databases · {apiSystems.length} API</span>
            </div>
            {systems.map((s) => (
              <div key={s.name} className="grid grid-cols-[34px_1fr_auto] items-center gap-3 border-b border-[var(--border-color)] py-2.5 last:border-b-0">
                <div className="grid size-[34px] place-items-center rounded-lg text-[11px] font-bold text-white" style={{ background: ["#336791", "#E48E00", "#FF7A59", "#29B5E8"][["sis", "lms", "crm", "fin"].indexOf(s.key)] }}>
                  {s.abbr}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <b className="text-gray-900">{s.name}</b> <span className="text-gray-600">· {s.engine}</span>
                    <Tag tone="blue">dissect</Tag>
                    <Tag tone="green">serve</Tag>
                  </div>
                  <small className="mono block truncate text-[11.5px] text-gray-600">
                    {s.url} · {s.detail}
                  </small>
                </div>
                {s.status === "ingested" ? <Pill tone="green" dot>ingested</Pill> : <Pill tone="amber" dot>compiling</Pill>}
              </div>
            ))}
            {apiSystems.map((a) => (
              <div key={a.name} className="grid grid-cols-[34px_1fr_auto] items-center gap-3 border-b border-[var(--border-color)] py-2.5 last:border-b-0">
                <div className="grid size-[34px] place-items-center rounded-lg bg-[#FF7A59] text-[11px] font-bold text-white">API</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm"><b className="text-gray-900">{a.name}</b> <span className="text-gray-600">· HTTP API</span> <Tag tone="green">serve</Tag></div>
                  <small className="mono block truncate text-[11.5px] text-gray-600">{a.baseUrl} · {a.endpoints} endpoints → {a.tools} tools</small>
                </div>
                <Pill tone="green" dot>serving</Pill>
              </div>
            ))}
          </Card>

          <div className="eyebrow mb-2">Catalog</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5">
            {shown.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setName(c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}
                className="rounded-lg border border-[var(--border-color)] bg-white p-3 text-left transition hover:border-[#0058cc]"
              >
                <div className="mb-2 grid size-[30px] place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: c.color }}>{c.abbr}</div>
                <b className="block text-[13px] font-semibold text-gray-900">{c.name}</b>
                <div className="mt-2 flex gap-1">
                  {c.dissect ? <Cap kind="o">DISSECT</Cap> : <Cap kind="x">—</Cap>}
                  {c.serve ? <Cap kind="m">SERVE</Cap> : <Cap kind="x">—</Cap>}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-xs text-gray-600">
            <Cap kind="o">DISSECT</Cap> schema read and terms inferred by the engine &nbsp; <Cap kind="m">SERVE</Cap> a source kind the server runtime can expose
          </p>
        </div>

        <Card>
          <Tabs defaultValue="db">
            <TabsList variant="line" className="mb-3 w-full justify-start border-b border-[var(--border-color)]">
              <TabsTrigger value="db" className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]">Database</TabsTrigger>
              <TabsTrigger value="api" className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]">HTTP API</TabsTrigger>
              <TabsTrigger value="pre" className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]">Prebuilt</TabsTrigger>
            </TabsList>

            <TabsContent value="db" className="space-y-3.5">
              <div>
                <Label htmlFor="src-name" className="mb-1.5 text-gray-700">Name</Label>
                <Input id="src-name" className="mono h-9" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="src-url" className="mb-1.5 text-gray-700">Connection URL</Label>
                <Input id="src-url" className="mono h-9" defaultValue="snowflake://FIN_RO:••••@acme.us-east-1/FIN?warehouse=ANALYTICS" />
              </div>
              <div>
                <Label className="mb-1.5 text-gray-700">Scope</Label>
                <div className="flex flex-wrap gap-1.5">
                  {["FIN.AWARDS", "FIN.TUITION_INVOICES", "FIN.LEDGER"].map((t) => (
                    <span key={t} className="mono inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--hover-bg)] px-2.5 text-gray-700">
                      {t} <button type="button" className="text-gray-400 hover:text-red-500" aria-label="remove">×</button>
                    </span>
                  ))}
                  <span className="mono inline-flex h-[26px] items-center rounded-full border border-dashed border-gray-300 px-2.5 text-gray-400">+ table</span>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 text-gray-700">Dissection Options</Label>
                <label className="flex items-start gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                  <Checkbox defaultChecked className="mt-0.5" /> <span>PII detection <span className="text-xs text-gray-600">· tag columns and mask sample values before they reach a model</span></span>
                </label>
                <label className="mt-1.5 flex items-start gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                  <Checkbox defaultChecked className="mt-0.5" /> <span>Distinct-value probing <span className="text-xs text-gray-600">· sample categorical columns for better term names</span></span>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" variant="outline" onClick={() => { setTest("running"); setTimeout(() => setTest("ok"), 900); }}>Test Connection</Button>
                <Button size="lg" className="ibl-button-primary" render={<Link href="/map" />}>Connect &amp; Dissect</Button>
              </div>
              {test !== "idle" && (
                <p className="text-xs text-gray-600">
                  {test === "running" ? "Testing credentials…" : <><span className="font-medium text-emerald-600">✓ Connected</span> · 3 tables visible · 210 ms · use a read-only login</>}
                </p>
              )}
            </TabsContent>

            <TabsContent value="api" className="space-y-3.5">
              <div><Label className="mb-1.5 text-gray-700">Base URL</Label><Input className="mono h-9" defaultValue="https://api.crm.example" /></div>
              <div><Label className="mb-1.5 text-gray-700">OpenAPI Spec (optional)</Label><Input className="mono h-9" placeholder="https://…/openapi.json" /></div>
              <div><Label className="mb-1.5 text-gray-700">Upstream Auth Header</Label><Input className="mono h-9" defaultValue="Authorization: Bearer ${CRM_TOKEN}" /></div>
              <div>
                <Label className="mb-1.5 text-gray-700">Endpoints to Wrap</Label>
                {["GET /v3/objects/contacts", "GET /v3/objects/deals", "GET /v3/objects/companies"].map((e) => (
                  <label key={e} className="mb-1.5 flex items-center gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                    <Checkbox defaultChecked /> <code className="mono">{e}</code>
                  </label>
                ))}
              </div>
              <div className="rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] p-3 text-[12.5px] text-gray-700">
                HTTP APIs are served as named tools only. They do not appear in the map or the ontology; map their responses to object types by hand when you expose them.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" variant="outline">Fetch Spec</Button>
                <Button size="lg" className="ibl-button-primary" render={<Link href="/mcp/new" />}>Add &amp; Expose</Button>
              </div>
            </TabsContent>

            <TabsContent value="pre" className="space-y-2">
              <p className="text-xs text-gray-600">Prebuilt toolsets give raw, read-only access per engine. Use one when you want SQL access alongside the ontology tools.</p>
              {["postgres · execute_sql, list_tables", "bigquery · execute_sql, get_table_info", "mysql · execute_sql, list_tables"].map((p) => (
                <label key={p} className="flex items-center gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm"><Checkbox /> <code className="mono">{p}</code></label>
              ))}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </>
  );
}
