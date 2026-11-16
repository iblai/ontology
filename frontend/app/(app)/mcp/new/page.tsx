"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, PageHeader, Pill } from "@/components/shell/page-header";
import { defaultOrigins, toolsYaml, toolsets } from "@/lib/mock";

export default function NewServerPage() {
  const [name, setName] = useState("institution");
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(toolsets.map((t) => [t.name, t.defaultOn])));
  const [origins, setOrigins] = useState(defaultOrigins);
  const [originIn, setOriginIn] = useState("");
  const [bad, setBad] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const slug = name.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "server";
  const count = useMemo(() => toolsets.reduce((n, t) => n + (on[t.name] ? t.tools.length : 0), 0), [on]);

  const addOrigin = () => {
    const v = originIn.trim();
    if (!/^https?:\/\//.test(v)) return setBad(true);
    setBad(false); setOrigins((o) => [...o, v]); setOriginIn("");
  };

  return (
    <>
      <PageHeader
        eyebrow="Step 4 · Expose"
        title="New MCP Server"
        description="Certified object types compile into named tools in a generated config file. Choose toolsets, how callers sign in, and the origins and hosts allowed to reach the server. Agents never get arbitrary SQL unless you add the raw toolset."
        actions={<><Button size="lg" variant="outline">Save Draft</Button><Button size="lg" className="ibl-button-primary" render={<Link href="/mcp/institution" />}>Deploy {slug}</Button></>}
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="grid gap-3.5">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="min-w-0"><Label htmlFor="srv" className="mb-1.5 text-gray-700">Server Name</Label><Input id="srv" className="mono h-9" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="min-w-0"><Label className="mb-1.5 text-gray-700">Endpoint</Label><div className="mono flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[#f9fafb] px-2.5 text-gray-500" title={`https://ontology.university.edu/${slug}/mcp`}><span className="truncate">https://ontology.university.edu/<span className="text-gray-900">{slug}</span>/mcp</span></div></div>
            </div>
          </Card>

          <Card>
            <div className="mb-2.5 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">Toolsets <span className="text-xs font-normal text-gray-600">· generated from certified object types</span></h3><span className="text-xs text-gray-600">{count} tools selected</span></div>
            {toolsets.map((t) => (
              <div key={t.name} className="mb-2.5 overflow-hidden rounded-lg border border-[var(--border-color)] last:mb-0">
                <label className="flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-[#fafbfc] px-3 py-2.5">
                  <Checkbox checked={on[t.name]} onCheckedChange={(v) => setOn((s) => ({ ...s, [t.name]: !!v }))} />
                  <b className="mono font-semibold text-gray-900">{t.name}</b>
                  <span className="text-xs text-gray-600">{t.summary}</span>
                  <span className="ml-auto">{t.risk === "writes" ? <Pill tone="amber">{t.tools.length} tools · writes</Pill> : t.risk === "unrestricted" ? <Pill tone="red">unrestricted reads</Pill> : <Pill>{t.tools.length} tools</Pill>}</span>
                </label>
                <ul className="px-3 py-1">
                  {t.tools.map((x) => <li key={x.sig} className="mono flex flex-wrap justify-between gap-x-3 border-b border-[var(--border-color)] py-1.5 text-gray-700 last:border-b-0"><span className="break-words">{x.sig}</span>{x.note && <span className="ml-auto text-right text-gray-500">{x.note}</span>}</li>)}
                </ul>
              </div>
            ))}
          </Card>

          <Card>
            <h3 className="mb-2.5 text-sm font-semibold text-gray-900">Authentication</h3>
            <AuthOpt checked title="ibl.ai Platform Tokens" tag="Api-Token" desc="Issued on ibl.ai per agent or service and scoped by RBAC policy. The gateway verifies each call with ibl.ai; nothing is stored here. ibl.ai agents attach the server with one of these or with each user's own session.">
              <div className="mono mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-color)] bg-[#fafbfc] px-2.5 py-2">
                <span>ontology-{slug}-</span><span>{key ?? "advising-bot"}</span>
                <Button size="sm" variant="outline" onClick={() => setKey("agent-" + Math.random().toString(36).slice(2, 6))}>{key ? "Issued on ibl.ai · Copy Now" : "Issue Token"}</Button>
                <span className="font-sans text-xs text-gray-600">policy: ontology:advising · group: advisors</span>
              </div>
            </AuthOpt>
            <AuthOpt checked title="Microsoft Entra ID" tag="OIDC" desc="Campus SSO, verified natively by the server runtime. Tools can bind email from the token so a student only sees their own records.">
              <Input className="mono mt-2 h-9" defaultValue="tenant: 8123…  ·  audience: api://ontology" />
            </AuthOpt>
            <AuthOpt title="Google Sign-in" tag="OIDC" desc="For Workspace campuses." />
            <AuthOpt title="Custom OIDC Issuer" desc="Okta, Auth0, Keycloak, Shibboleth." />
          </Card>

          <Card>
            <h3 className="mb-1 text-sm font-semibold text-gray-900">Allowed Origins</h3>
            <p className="mb-2.5 text-xs text-gray-600">Passed to the server runtime as its allowed-origins flag. Browsers and web agents calling from anywhere else are refused before authentication runs.</p>
            <div className="flex flex-wrap gap-1.5">
              {origins.map((o) => (
                <span key={o} className="mono inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--hover-bg)] px-2.5 text-gray-700">{o}<button type="button" className="text-gray-400 hover:text-red-500" aria-label={`remove ${o}`} onClick={() => setOrigins((x) => x.filter((y) => y !== o))}>×</button></span>
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Input className="mono h-9 max-w-[360px]" placeholder="https://…" value={originIn} onChange={(e) => setOriginIn(e.target.value)} aria-invalid={bad || undefined} onKeyDown={(e) => e.key === "Enter" && addOrigin()} />
              <Button size="lg" variant="outline" onClick={addOrigin}>Add Origin</Button>
            </div>
            <div className="mt-3.5"><Label className="mb-1.5 text-gray-700">Allowed Hosts <span className="text-xs font-normal text-gray-500">· allowed-hosts flag, DNS-rebinding guard</span></Label><Input className="mono h-9 max-w-[360px]" defaultValue="ontology.university.edu" /></div>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-0">
          <div className="mb-2.5 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">tools.yaml <span className="text-xs font-normal text-gray-600">· generated</span></h3><Button size="sm" variant="outline">Copy</Button></div>
          <pre className="mono overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] p-3.5 text-[12px] leading-[1.55] text-gray-700">{toolsYaml}</pre>
          <p className="mt-2.5 text-xs text-gray-600">One runtime process per server on the host, started with this file plus the origins and hosts above. Deploying also registers the endpoint as an MCP server on ibl.ai so agents can attach it.</p>
        </Card>
      </div>
    </>
  );
}

function AuthOpt({ checked, title, tag, desc, children }: { checked?: boolean; title: string; tag?: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-lg border border-[var(--border-color)] p-3 last:mb-0">
      <Checkbox defaultChecked={checked} className="mt-0.5" />
      <div>
        <div className="text-sm font-semibold text-gray-900">{title} {tag && <span className="mono ml-1 rounded bg-[var(--hover-bg)] px-1.5 py-0.5 text-[11px] font-normal text-gray-600">{tag}</span>}</div>
        <small className="block text-xs text-gray-600">{desc}</small>
        {children}
      </div>
    </div>
  );
}
