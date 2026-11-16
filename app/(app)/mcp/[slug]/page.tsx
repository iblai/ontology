"use client";

import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, PageHeader, Pill, Stat, Tag } from "@/components/shell/page-header";
import { AttachDialog } from "@/components/attach-dialog";
import { QueryState } from "@/components/query-state";
import { useActions, useApiKeys, useServer, useServerActivity } from "@/lib/data";
import { isDemo } from "@/lib/iblai/session";
import type { PlayTool, ServerView, ToolRun } from "@/lib/view/types";

const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
const tab = "flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function ServerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const server = useServer(slug);
  return (
    <QueryState query={server}>
      {(srv) => {
        if (!srv) notFound();
        return <Server srv={srv} />;
      }}
    </QueryState>
  );
}

function Server({ srv }: { srv: ServerView }) {
  const actions = useActions();
  const activity = useServerActivity(srv.slug);
  const keys = useApiKeys();
  const demo = isDemo();
  const url = srv.url;
  // An example caller for the snippet: the first origin that is not an agent host.
  const origin =
    srv.origins.find((o) => !/^https:\/\/(os\.ibl\.ai|claude\.ai)$/.test(o)) ?? srv.origins[0];
  const [copied, setCopied] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [toolsAsked, setToolsAsked] = useState(false);
  const [tools, setTools] = useState<PlayTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolRun | null>(null);

  const rollback = () => {
    setRollingBack(true);
    setRollbackError(null);
    actions
      .rollbackServer(srv.slug)
      .catch((e) => setRollbackError(message(e)))
      .finally(() => setRollingBack(false));
  };

  const openTab = (value: unknown) => {
    if (value !== "play" || toolsAsked) return;
    setToolsAsked(true);
    setToolsError(null);
    actions.listTools(srv.slug).then(
      (list) => {
        setTools(list);
        if (list[0]) {
          setTool(list[0].name);
          setArgs(list[0].args);
        }
      },
      (e) => {
        setToolsError(message(e));
        setToolsAsked(false); // reopening the tab asks again
      },
    );
  };

  const run = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.trim() || "{}");
    } catch (e) {
      setRunError(message(e));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setRunError("Arguments must be a JSON object.");
      return;
    }
    setRunError(null);
    setResult(null);
    setRunning(true);
    actions
      .runTool(srv.slug, tool, parsed as Record<string, unknown>)
      .then(setResult, (e) => setRunError(message(e)))
      .finally(() => setRunning(false));
  };

  return (
    <>
      <PageHeader
        eyebrow="Step 5 · Serve"
        title={
          <span className="flex items-center gap-2.5">
            {srv.slug}{" "}
            {srv.enabled ? (
              <Pill tone="green" dot pulse>
                enabled · rev {srv.revision}
              </Pill>
            ) : (
              <Pill tone="amber" dot>
                draft
              </Pill>
            )}
          </span>
        }
        description="Attach the server to an ibl.ai agent or any MCP client, try tools from the playground with the same sign-in a client would use, and see what agents are calling. Certifying a change rewrites the config and the runtime reloads it."
        actions={
          <>
            <div className="grid gap-1">
              <Button
                size="lg"
                variant="outline"
                disabled={srv.revision <= 1 || rollingBack}
                onClick={rollback}
              >
                Roll Back to Rev {srv.revision - 1}
              </Button>
              {rollbackError && <p className="text-xs text-red-600">{rollbackError}</p>}
            </div>
            <Button
              size="lg"
              variant="outline"
              className="ibl-outline-primary"
              render={<Link href={`/mcp/new?slug=${srv.slug}`} />}
            >
              Edit Server
            </Button>
          </>
        }
      />
      <div className="grid gap-3.5">
        <div className="mono flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[13px] text-gray-900">
          <span className="text-gray-500">POST</span>
          <span className="min-w-[14rem] flex-1 break-all">{url}</span>
          <Tag tone="green">streamable-http</Tag>
          <Tag>{srv.toolsets} toolsets</Tag>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <QueryState query={activity}>
          {(a) => (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                value={srv.calls24h.toLocaleString()}
                label="agent tool calls · 24h"
                spark={a.spark.calls}
              />
              <Stat value={srv.agents} label="agents attached" />
              <Stat value={srv.tools} label={`tools in ${srv.toolsets} toolsets`} />
              <Stat
                value={
                  <span className="mono block truncate text-base" title={srv.top}>
                    {srv.top}
                  </span>
                }
                label="most called tool"
                spark={a.spark.top}
              />
            </div>
          )}
        </QueryState>

        <Card>
          <Tabs defaultValue="connect" onValueChange={openTab}>
            <TabsList
              variant="line"
              className="mb-4 w-full justify-start overflow-x-auto overflow-y-hidden border-b border-[var(--border-color)]"
            >
              <TabsTrigger value="connect" className={tab}>
                Connect
              </TabsTrigger>
              <TabsTrigger value="play" className={tab}>
                Playground
              </TabsTrigger>
              <TabsTrigger value="activity" className={tab}>
                Activity
              </TabsTrigger>
              <TabsTrigger value="keys" className={tab}>
                Tokens &amp; Origins
              </TabsTrigger>
            </TabsList>

            <TabsContent value="connect">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1.5">ibl.ai agent</div>
                  <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border-color)] bg-[#fafbfc] p-3">
                    <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#0ea5e9] to-[#0058cc] text-xs font-semibold text-white">
                      AG
                    </span>
                    <div className="flex-1">
                      <b className="text-sm text-gray-900">{demo ? "agentAI" : "ibl.ai agent"}</b>
                      <div className="text-xs text-gray-600">
                        Attach <code className="mono">{srv.slug}</code> ·{" "}
                        {demo ? "sign-in scope: user" : "a key per agent"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="ibl-button-primary"
                      onClick={() => setAttaching(true)}
                    >
                      Attach
                    </Button>
                  </div>
                  <div className="eyebrow mt-3.5 mb-1.5">cURL</div>
                  <Code>{`curl -X POST ${url} \\
  -H "Authorization: Api-Token <ibl.ai platform token>" \\
${origin ? `  -H "Origin: ${origin}" \\\n` : ""}  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`}</Code>
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

async with streamablehttp_client("${url}", headers=AUTH) as (r, w, _):
    async with ClientSession(r, w) as s:
        await s.initialize()
        rows = await s.call_tool("at_risk_students", {"term": "2026-FA"})`}</Code>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="play">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-md border border-[var(--border-color)] bg-[#f9fafb] px-2.5 text-sm"
                  value={tool}
                  disabled={!tools || running}
                  onChange={(e) => {
                    setTool(e.target.value);
                    const picked = tools?.find((t) => t.name === e.target.value);
                    if (picked) setArgs(picked.args);
                  }}
                  aria-label="Tool"
                >
                  {tools?.map((t) => (
                    <option key={t.name}>{t.name}</option>
                  ))}
                </select>
                <Input
                  className="mono h-9 max-w-[360px]"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  aria-label="Arguments"
                />
                <Button
                  size="lg"
                  className="ibl-button-primary"
                  disabled={!tool || running}
                  onClick={run}
                >
                  Run
                </Button>
                <span className="text-xs text-gray-600">as your ibl.ai session</span>
              </div>
              {toolsError && <p className="mt-1.5 text-xs text-red-600">{toolsError}</p>}
              <div className="mt-3">
                {runError ? (
                  <p className="text-xs text-red-600">{runError}</p>
                ) : running ? (
                  <p className="text-xs text-gray-600">
                    gateway → {tool}(…) · verifying session with ibl.ai…
                  </p>
                ) : !result ? (
                  <p className="text-xs text-gray-600">
                    Results appear here. The playground calls the running server through the gateway
                    with your own ibl.ai session.
                  </p>
                ) : result.error !== undefined ? (
                  <div className="mb-1.5 flex items-center justify-between text-xs text-red-600">
                    <span>{result.error}</span>
                    <Tag tone="red">{result.status}</Tag>
                  </div>
                ) : result.answer ? (
                  <div className="flex gap-3 rounded-[10px] border border-[var(--border-color)] bg-[#fafbfc] p-3.5 text-[13px] text-gray-700">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--border-color)] bg-white text-[#0058cc]">
                      ?
                    </span>
                    <div>
                      {result.answer.text}
                      {result.answer.sql && <Code className="mt-2">{result.answer.sql}</Code>}
                      {result.answer.provenance && (
                        <div className="mt-1.5 text-xs text-gray-600">
                          provenance: {result.answer.provenance} · {(result.ms / 1000).toFixed(1)} s
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <Rows run={result} />
                )}
              </div>
            </TabsContent>

            <TabsContent value="activity">
              <div className="eyebrow mb-1.5">
                Agent Tool Calls{" "}
                <span className="font-normal tracking-normal normal-case">
                  · seen by the gateway
                </span>
              </div>
              <QueryState query={activity}>
                {(a) => (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {["Time", "Tool", "Agent", "User", "Session", "Result"].map((h) => (
                              <TableHead key={h} className={th}>
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {a.calls.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="text-gray-500">
                                No calls yet.
                              </TableCell>
                            </TableRow>
                          )}
                          {a.calls.map((r, i) => (
                            <TableRow key={i}>
                              <TableCell className="mono text-gray-500">{r.t}</TableCell>
                              <TableCell className="mono">{r.tool}</TableCell>
                              <TableCell>{r.agent}</TableCell>
                              <TableCell>{r.user}</TableCell>
                              <TableCell className="mono">{r.session}</TableCell>
                              <TableCell
                                className={r.status === "ok" ? "text-emerald-600" : "text-red-600"}
                              >
                                {r.status}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="eyebrow mt-5 mb-1.5">
                      Runtime Log{" "}
                      <span className="font-normal tracking-normal normal-case">
                        · tail of the server process on the host
                      </span>
                    </div>
                    <Code>{a.log.join("\n")}</Code>
                  </>
                )}
              </QueryState>
            </TabsContent>

            <TabsContent value="keys">
              <div className="eyebrow mb-1.5">
                Platform API Tokens{" "}
                <span className="font-normal tracking-normal normal-case">
                  · issued and revoked on ibl.ai
                </span>
              </div>
              <QueryState query={keys}>
                {(list) => (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {["Name", "Policies", "Groups", "Created", "Expires", ""].map((h, i) => (
                            <TableHead key={i} className={th}>
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((k) => (
                          <TableRow key={k.id}>
                            <TableCell className="mono">{k.name}</TableCell>
                            <TableCell>
                              {k.policies.map((p) => (
                                <Tag key={p} tone="blue">
                                  {p}
                                </Tag>
                              ))}
                            </TableCell>
                            <TableCell>{k.groups.length ? k.groups.join(", ") : "—"}</TableCell>
                            <TableCell>{k.created}</TableCell>
                            <TableCell>{k.expires}</TableCell>
                            <TableCell>
                              <Revoke id={k.id} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </QueryState>
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <span className="eyebrow mr-1">Allowed Origins</span>
                {srv.origins.map((o) => (
                  <span
                    key={o}
                    className="mono rounded-full bg-[var(--hover-bg)] px-2.5 py-1 text-gray-700"
                  >
                    {o}
                  </span>
                ))}
                <span className="text-xs text-gray-500">· runtime flag on the host</span>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
      <AttachDialog open={attaching} onOpenChange={setAttaching} slug={srv.slug} />
    </>
  );
}

function Rows({ run }: { run: ToolRun }) {
  const rows = run.rows ?? [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between text-xs text-gray-600">
        <span>
          {run.total ? `${rows.length} of ${run.total}` : rows.length} rows · {run.ms} ms
        </span>
        <Tag tone={run.ok ? "green" : "red"}>{run.status}</Tag>
      </div>
      {cols.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((h) => (
                  <TableHead key={h} className={th}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 50).map((r, i) => (
                <TableRow key={i}>
                  {cols.map((c) => (
                    <TableCell
                      key={c}
                      className={typeof r[c] === "number" ? "tabular-nums" : "mono"}
                    >
                      {cell(r[c])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function Revoke({ id }: { id: string }) {
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          actions
            .revokeKey(id)
            .catch((e) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      >
        Revoke
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </>
  );
}

function Code({ children, className = "" }: { children: string; className?: string }) {
  return (
    <pre
      className={`mono overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] p-3 text-[12px] leading-[1.55] text-gray-700 ${className}`}
    >
      {children}
    </pre>
  );
}
