"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, PageHeader, Pill, Stat, Tag } from "@/components/shell/page-header";
import { agentToolCalls, apiKeys, defaultOrigins, gatewayLog, servers, sparklines } from "@/lib/mock";

const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
const tab = "flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]";

export default function ServerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const srv = servers.find((s) => s.slug === slug) ?? servers[0];
  const url = `https://ontology.university.edu/${srv.slug}/mcp`;
  const [copied, setCopied] = useState(false);
  const [tool, setTool] = useState("at_risk_students");
  const [args, setArgs] = useState('{"term": "2026-FA", "program": "CS-BS"}');
  const [res, setRes] = useState<"idle" | "running" | "rows" | "nl">("idle");

  const run = () => { setRes("running"); setTimeout(() => setRes(tool === "ask_question" ? "nl" : "rows"), 900); };

  return (
    <>
      <PageHeader
        eyebrow="Step 5 · Serve"
        title={<span className="flex items-center gap-2.5">{srv.slug} <Pill tone="green" dot pulse>enabled · rev {srv.revision}</Pill></span>}
        description="Attach the server to an ibl.ai agent or any MCP client, try tools from the playground with the same sign-in a client would use, and see what agents are calling. Certifying a change rewrites the config and the runtime reloads it."
        actions={<><Button size="lg" variant="outline">Roll Back to Rev {srv.revision - 1}</Button><Button size="lg" variant="outline" className="ibl-outline-primary" render={<Link href="/mcp/new" />}>Edit Server</Button></>}
      />
      <div className="grid gap-3.5">
        <div className="mono flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[13px] text-gray-900">
          <span className="text-gray-500">POST</span><span className="min-w-[14rem] flex-1 break-all">{url}</span><Tag tone="green">streamable-http</Tag><Tag>{srv.toolsets} toolsets</Tag>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copied" : "Copy"}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat value={srv.calls24h.toLocaleString()} label="agent tool calls · 24h" spark={sparklines.calls} />
          <Stat value={srv.agents} label="agents attached" />
          <Stat value={srv.tools} label={`tools in ${srv.toolsets} toolsets`} />
          <Stat value={<span className="mono block truncate text-base" title={srv.top}>{srv.top}</span>} label="most called tool" spark={sparklines.top} />
        </div>

        <Card>
          <Tabs defaultValue="connect">
            <TabsList variant="line" className="mb-4 w-full justify-start overflow-x-auto overflow-y-hidden border-b border-[var(--border-color)]">
              <TabsTrigger value="connect" className={tab}>Connect</TabsTrigger>
              <TabsTrigger value="play" className={tab}>Playground</TabsTrigger>
              <TabsTrigger value="activity" className={tab}>Activity</TabsTrigger>
              <TabsTrigger value="keys" className={tab}>Tokens &amp; Origins</TabsTrigger>
            </TabsList>

            <TabsContent value="connect">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1.5">ibl.ai agent</div>
                  <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border-color)] bg-[#fafbfc] p-3">
                    <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#0ea5e9] to-[#0058cc] text-xs font-semibold text-white">AG</span>
                    <div className="flex-1"><b className="text-sm text-gray-900">agentAI</b><div className="text-xs text-gray-600">Attach <code className="mono">{srv.slug}</code> · sign-in scope: user</div></div>
                    <Button size="sm" className="ibl-button-primary">Attach</Button>
                  </div>
                  <div className="eyebrow mt-3.5 mb-1.5">cURL</div>
                  <Code>{`curl -X POST ${url} \\
  -H "Authorization: Api-Token <ibl.ai platform token>" \\
  -H "Origin: https://advising.university.edu" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`}</Code>
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Claude Desktop / Cursor</div>
                  <Code>{`{
  "mcpServers": {
    "${srv.slug}": {
      "url": "${url}",
      "headers": { "Authorization": "Api-Token <ibl.ai platform token>" }
    }
  }
}`}</Code>
                  <div className="eyebrow mt-3.5 mb-1.5">Python · MCP SDK</div>
                  <Code>{`from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

async with streamablehttp_client(URL, headers=AUTH) as (r, w, _):
    async with ClientSession(r, w) as s:
        await s.initialize()
        rows = await s.call_tool("at_risk_students", {"term": "2026-FA"})`}</Code>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="play">
              <div className="flex flex-wrap items-center gap-2">
                <select className="h-9 rounded-md border border-[var(--border-color)] bg-[#f9fafb] px-2.5 text-sm" value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Tool">
                  {["at_risk_students", "get_student", "retention_rate", "ask_question"].map((t) => <option key={t}>{t}</option>)}
                </select>
                <Input className="mono h-9 max-w-[360px]" value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Arguments" />
                <Button size="lg" className="ibl-button-primary" onClick={run}>Run</Button>
                <span className="text-xs text-gray-600">as your ibl.ai session · policy ontology:advising</span>
              </div>
              <div className="mt-3">
                {res === "idle" && <p className="text-xs text-gray-600">Results appear here. The playground calls the running server through the gateway with your own ibl.ai session.</p>}
                {res === "running" && <p className="text-xs text-gray-600">gateway → {tool}(…) · verifying session with ibl.ai…</p>}
                {res === "nl" && (
                  <div className="flex gap-3 rounded-[10px] border border-[var(--border-color)] bg-[#fafbfc] p-3.5 text-[13px] text-gray-700">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--border-color)] bg-white text-[#0058cc]">?</span>
                    <div>
                      <b className="text-gray-900">312 students</b> in CS-BS are at risk for 2026-FA: 201 by GPA, 143 by LMS inactivity, 32 by both.
                      <Code className="mt-2">{`SELECT count(*) FROM students s LEFT JOIN lms.auth_user u ON lower(u.email)=lower(s.email)
WHERE s.program_code='CS-BS' AND (s.cum_gpa < 2.0 OR u.last_login < now() - interval '14 days')`}</Code>
                      <div className="mt-1.5 text-xs text-gray-600">provenance: term Student (certified) · metric at_risk (certified) · 2.7 s</div>
                    </div>
                  </div>
                )}
                {res === "rows" && (
                  <>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-gray-600"><span>312 rows · 164 ms</span><Tag tone="green">200</Tag></div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>{["student_id", "email", "program", "cum_gpa", "lms_last_active", "reason"].map((h) => <TableHead key={h} className={th}>{h}</TableHead>)}</TableRow></TableHeader>
                        <TableBody>
                          {[["A00412…", "j.okafor@university.edu", "CS-BS", "1.84", "2026-10-29", "gpa"], ["A00398…", "m.lindqvist@university.edu", "CS-BS", "2.71", "2026-10-12", "inactive 33d"], ["A00377…", "r.alvarez@university.edu", "CS-BS", "1.92", "2026-10-20", "gpa · inactive"], ["A00351…", "s.nair@university.edu", "CS-BS", "1.67", "2026-11-10", "gpa"]].map((r) => (
                            <TableRow key={r[0]}><TableCell className="mono">{r[0]}</TableCell><TableCell className="mono">{r[1]}</TableCell><TableCell>{r[2]}</TableCell><TableCell className="tabular-nums">{r[3]}</TableCell><TableCell className="mono">{r[4]}</TableCell><TableCell><Tag tone={r[5].startsWith("gpa") ? "red" : "amber"}>{r[5]}</Tag></TableCell></TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="activity">
              <div className="eyebrow mb-1.5">Agent Tool Calls <span className="font-normal normal-case tracking-normal">· from ibl.ai analytics</span></div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>{["Time", "Tool", "Agent", "User", "Session", "Result"].map((h) => <TableHead key={h} className={th}>{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {agentToolCalls.map((r, i) => (
                      <TableRow key={i}><TableCell className="mono text-gray-500">{r.t}</TableCell><TableCell className="mono">{r.tool}</TableCell><TableCell>{r.agent}</TableCell><TableCell>{r.user}</TableCell><TableCell className="mono">{r.session}</TableCell><TableCell className={r.status === "ok" ? "text-emerald-600" : "text-red-600"}>{r.status}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="eyebrow mt-5 mb-1.5">Runtime Log <span className="font-normal normal-case tracking-normal">· tail of the server process on the host</span></div>
              <Code>{gatewayLog.join("\n")}</Code>
            </TabsContent>

            <TabsContent value="keys">
              <div className="eyebrow mb-1.5">Platform API Tokens <span className="font-normal normal-case tracking-normal">· issued and revoked on ibl.ai</span></div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>{["Name", "Policies", "Groups", "Created", "Expires", ""].map((h, i) => <TableHead key={i} className={th}>{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {apiKeys.map((k) => (
                      <TableRow key={k.name}><TableCell className="mono">{k.name}</TableCell><TableCell>{k.policies.map((p) => <Tag key={p} tone="blue">{p}</Tag>)}</TableCell><TableCell>{k.groups.length ? k.groups.join(", ") : "—"}</TableCell><TableCell>{k.created}</TableCell><TableCell>{k.expires}</TableCell><TableCell><Button size="sm" variant="outline">Revoke</Button></TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5"><span className="eyebrow mr-1">Allowed Origins</span>{defaultOrigins.map((o) => <span key={o} className="mono rounded-full bg-[var(--hover-bg)] px-2.5 py-1 text-gray-700">{o}</span>)}<span className="text-xs text-gray-500">· runtime flag on the host</span></div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </>
  );
}

function Code({ children, className = "" }: { children: string; className?: string }) {
  return <pre className={`mono overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] p-3 text-[12px] leading-[1.55] text-gray-700 ${className}`}>{children}</pre>;
}
