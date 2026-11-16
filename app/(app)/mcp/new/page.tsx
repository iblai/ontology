"use client";

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, PageHeader, Pill } from "@/components/shell/page-header";
import { QueryState } from "@/components/query-state";
import {
  defaultOrigins,
  endpointOf,
  useActions,
  useConfigPreview,
  useServer,
  useToolsets,
} from "@/lib/data";
import { isDemo } from "@/lib/iblai/session";
import type { HostAuth, HostServerDraft } from "@/lib/host/types";
import { cn } from "@/lib/utils";
import type { ServerView, ToolsetView } from "@/lib/view/types";

type Opt = "entra" | "google" | "oidc";

const noSubscribe = () => () => {};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
// One "key: value" pair of an auth row; "·" separates pairs.
const field = (text: string, key: string) => text.match(new RegExp(`${key}:\\s*([^\\s·]+)`))?.[1];

export default function NewServerPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <Builder />
    </Suspense>
  );
}

function Builder() {
  const slug = useSearchParams().get("slug");
  return slug ? <EditServer slug={slug} /> : <ServerForm initial={null} />;
}

function EditServer({ slug }: { slug: string }) {
  const server = useServer(slug);
  return (
    <QueryState query={server}>
      {(srv) =>
        srv ? (
          <ServerForm initial={srv} />
        ) : (
          <p className="py-6 text-sm text-gray-600">No server named “{slug}”.</p>
        )
      }
    </QueryState>
  );
}

function ServerForm({ initial }: { initial: ServerView | null }) {
  const router = useRouter();
  const actions = useActions();
  const demo = isDemo();
  const [name, setName] = useState(initial?.slug ?? (demo ? "institution" : ""));
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const toolsets = useToolsets();
  const [on, setOn] = useState<Record<string, boolean>>({});
  const prebuiltRaw = useSyncExternalStore(
    noSubscribe,
    () => localStorage.getItem("ontology.prebuilt"),
    () => null,
  );
  const prebuilt = useMemo(
    () => (prebuiltRaw ? (JSON.parse(prebuiltRaw) as string[]) : []),
    [prebuiltRaw],
  );
  const isOn = (t: ToolsetView) =>
    on[t.name] ??
    (initial ? initial.toolsetNames.includes(t.name) : t.defaultOn || prebuilt.includes(t.name));
  const listed = toolsets.data ?? [];
  const ticked = listed.filter(isOn).map((t) => t.name);
  const count = listed.reduce((n, t) => n + (isOn(t) ? t.tools.length : 0), 0);
  // A long list of tools starts hidden; the pill still says how many there are.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (t: ToolsetView) => open[t.name] ?? t.tools.length <= 8;

  const [origins, setOrigins] = useState(() => initial?.origins ?? defaultOrigins());
  const [originIn, setOriginIn] = useState("");
  const [bad, setBad] = useState(false);
  const [hosts, setHosts] = useState(
    () => initial?.hosts.join(", ") ?? new URL(endpointOf(slug)).hostname,
  );

  const [tried, setTried] = useState(false); // incomplete options show their sentence after a save
  const [authOn, setAuthOn] = useState<Record<Opt, boolean>>({
    entra: initial ? !!initial.auth.entra : demo,
    google: !!initial?.auth.google,
    oidc: !!initial?.auth.oidc,
  });
  const [authText, setAuthText] = useState<Record<Opt, string>>(() => {
    const a = initial?.auth;
    return {
      entra: a?.entra
        ? `tenant: ${a.entra.tenant}  ·  audience: ${a.entra.audience}`
        : demo
          ? "tenant: 8123…  ·  audience: api://ontology"
          : "",
      google: a?.google ? `audience: ${a.google.audience}` : "",
      oidc: a?.oidc ? `issuer: ${a.oidc.issuer}  ·  audience: ${a.oidc.audience}` : "",
    };
  });
  const { auth, missing } = useMemo(() => {
    const auth: HostAuth = { platform: true };
    const missing: Partial<Record<Opt, string>> = {};
    if (authOn.entra) {
      const tenant = field(authText.entra, "tenant");
      const audience = field(authText.entra, "audience");
      if (tenant && audience) auth.entra = { tenant, audience };
      else missing.entra = "Enter the tenant and the audience.";
    }
    if (authOn.google) {
      const audience = field(authText.google, "audience");
      if (audience) auth.google = { audience };
      else missing.google = "Enter the audience, your Google client ID.";
    }
    if (authOn.oidc) {
      const issuer = field(authText.oidc, "issuer");
      const audience = field(authText.oidc, "audience");
      if (issuer && audience) auth.oidc = { issuer, audience };
      else missing.oidc = "Enter the issuer and the audience.";
    }
    return { auth, missing };
  }, [authOn, authText]);
  const authRow = (opt: Opt, label: string, placeholder: string) =>
    authOn[opt] && (
      <>
        <Input
          className="mono mt-2 h-9"
          aria-label={label}
          placeholder={placeholder}
          value={authText[opt]}
          onChange={(e) => setAuthText((s) => ({ ...s, [opt]: e.target.value }))}
        />
        {tried && missing[opt] && (
          <small className="mt-1 block text-xs text-red-600">{missing[opt]}</small>
        )}
      </>
    );

  // Stable identity, so the debounced preview only refetches when the draft really changes.
  const draftKey = JSON.stringify({
    toolsets: ticked,
    auth,
    origins,
    hosts: hosts
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  } satisfies HostServerDraft);
  const draft = useMemo(() => JSON.parse(draftKey) as HostServerDraft, [draftKey]);
  const preview = useConfigPreview(slug, draft);

  const [label, setLabel] = useState(demo ? "advising-bot" : "");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ name: string; secret: string; toolsets: string[] }>();
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const issue = async () => {
    setIssuing(true);
    setTokenErr(null);
    try {
      const key = await actions.issueToken(slug, label.trim(), ticked);
      setIssued({ ...key, toolsets: ticked });
    } catch (e) {
      setTokenErr(errorText(e));
    } finally {
      setIssuing(false);
    }
  };

  const [busy, setBusy] = useState<"draft" | "deploy" | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const save = async (deploy: boolean) => {
    setTried(true);
    setSaved(false);
    setSaveErr(null);
    if (Object.keys(missing).length) return;
    setBusy(deploy ? "deploy" : "draft");
    try {
      await actions.saveServer(slug, draft, deploy);
      if (deploy) router.push(`/mcp/${slug}`);
      else setSaved(true);
    } catch (e) {
      setSaveErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const cannotSave = !!busy || !slug || !toolsets.data;

  const addOrigin = () => {
    const v = originIn.trim();
    if (!/^https?:\/\//.test(v)) return setBad(true);
    setBad(false);
    setOrigins((o) => [...o, v]);
    setOriginIn("");
  };

  const endpoint = endpointOf(slug);
  const endpointBase = endpoint.slice(0, endpoint.length - `${slug}/mcp`.length);
  const policies = (issued?.toolsets ?? ticked).map((t) => `Ontology: ${t}`).join(", ");

  return (
    <>
      <PageHeader
        eyebrow="Step 4 · Expose"
        title={initial ? "Edit MCP Server" : "New MCP Server"}
        description="Certified object types compile into named tools in a generated config file. Choose toolsets, how callers sign in, and the origins and hosts allowed to reach the server. Agents never get arbitrary SQL unless you add the raw toolset."
        actions={
          <>
            {saved && <span className="text-xs text-gray-600">Draft saved</span>}
            <Button size="lg" variant="outline" disabled={cannotSave} onClick={() => save(false)}>
              Save Draft
            </Button>
            <Button
              size="lg"
              className="ibl-button-primary"
              disabled={cannotSave}
              onClick={() => save(true)}
            >
              Deploy {slug}
            </Button>
            {saveErr && (
              <pre className="mono basis-full text-xs whitespace-pre-wrap text-red-600">
                {saveErr}
              </pre>
            )}
          </>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="grid gap-3.5">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="min-w-0">
                <Label htmlFor="srv" className="mb-1.5 text-gray-700">
                  Server Name
                </Label>
                <Input
                  id="srv"
                  className="mono h-9"
                  value={name}
                  readOnly={!!initial}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="min-w-0">
                <Label className="mb-1.5 text-gray-700">Endpoint</Label>
                <div
                  className="mono flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[#f9fafb] px-2.5 text-gray-500"
                  title={endpoint}
                >
                  <span className="truncate">
                    {endpointBase}
                    <span className="text-gray-900">{slug}</span>
                    /mcp
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                Toolsets{" "}
                <span className="text-xs font-normal text-gray-600">
                  · generated from certified object types
                </span>
              </h3>
              <span className="text-xs text-gray-600">{count} tools selected</span>
            </div>
            <QueryState query={toolsets}>
              {(list) =>
                list.map((t) => (
                  <div
                    key={t.name}
                    className="mb-2.5 overflow-hidden rounded-lg border border-[var(--border-color)] last:mb-0"
                  >
                    <div className="flex items-center gap-2 bg-[#fafbfc] px-3 py-2.5">
                      <label className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Checkbox
                          checked={isOn(t)}
                          onCheckedChange={(v) => setOn((s) => ({ ...s, [t.name]: !!v }))}
                        />
                        <b className="mono font-semibold text-gray-900">{t.name}</b>
                        <span className="text-xs text-gray-600">{t.summary}</span>
                        <span className="ml-auto">
                          {t.risk === "writes" ? (
                            <Pill tone="amber">{t.tools.length} tools · writes</Pill>
                          ) : t.risk === "unrestricted" ? (
                            <Pill tone="red">unrestricted reads</Pill>
                          ) : (
                            <Pill>{t.tools.length} tools</Pill>
                          )}
                        </span>
                      </label>
                      {t.tools.length > 0 && (
                        <button
                          type="button"
                          className="shrink-0 text-gray-400 hover:text-gray-700"
                          aria-expanded={isOpen(t)}
                          aria-label={`${isOpen(t) ? "Hide" : "Show"} the tools of ${t.name}`}
                          onClick={() => setOpen((s) => ({ ...s, [t.name]: !isOpen(t) }))}
                        >
                          <ChevronDown
                            className={cn(
                              "size-4 transition-transform",
                              !isOpen(t) && "-rotate-90",
                            )}
                          />
                        </button>
                      )}
                    </div>
                    {isOpen(t) && (
                      <ul className="px-3 py-1">
                        {t.tools.map((x) => (
                          <li
                            key={x.sig}
                            className="mono flex flex-wrap justify-between gap-x-3 border-b border-[var(--border-color)] py-1.5 text-gray-700 last:border-b-0"
                          >
                            <span className="break-words">{x.sig}</span>
                            {x.note && (
                              <span className="ml-auto text-right text-gray-500">{x.note}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              }
            </QueryState>
          </Card>

          <Card>
            <h3 className="mb-2.5 text-sm font-semibold text-gray-900">Authentication</h3>
            <AuthOpt
              checked
              disabled
              title="ibl.ai Platform Tokens"
              tag="Api-Token"
              desc="Issued on ibl.ai per agent or service and scoped by RBAC policy. The gateway verifies each call with ibl.ai; nothing is stored here. ibl.ai agents attach the server with one of these or with each user's own session."
            >
              <div className="mono mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-color)] bg-[#fafbfc] px-2.5 py-2">
                {issued ? (
                  <>
                    <span>{issued.name}</span>
                    <span className="break-all text-gray-900">{issued.secret}</span>
                    <CopyButton text={issued.secret} />
                  </>
                ) : (
                  <>
                    <span>
                      ontology-{slug}-
                      <input
                        className="w-32 border-b border-[var(--border-color)] bg-transparent outline-none"
                        aria-label="Token label"
                        placeholder="label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={issuing || !slug || !label.trim() || !ticked.length}
                      onClick={issue}
                    >
                      Issue Token
                    </Button>
                  </>
                )}
                <span className="font-sans text-xs text-gray-600">policies: {policies || "—"}</span>
                {tokenErr && (
                  <span className="basis-full font-sans text-xs text-red-600">{tokenErr}</span>
                )}
              </div>
            </AuthOpt>
            <AuthOpt
              checked={authOn.entra}
              onCheckedChange={(v) => setAuthOn((s) => ({ ...s, entra: v }))}
              title="Microsoft Entra ID"
              tag="OIDC"
              desc="Campus SSO, verified natively by the server runtime. Tools can bind email from the token so a student only sees their own records."
            >
              {authRow("entra", "Microsoft Entra ID", "tenant: …  ·  audience: …")}
            </AuthOpt>
            <AuthOpt
              checked={authOn.google}
              onCheckedChange={(v) => setAuthOn((s) => ({ ...s, google: v }))}
              title="Google Sign-in"
              tag="OIDC"
              desc="For Workspace campuses."
            >
              {authRow("google", "Google Sign-in", "audience: …")}
            </AuthOpt>
            <AuthOpt
              checked={authOn.oidc}
              onCheckedChange={(v) => setAuthOn((s) => ({ ...s, oidc: v }))}
              title="Custom OIDC Issuer"
              desc="Okta, Auth0, Keycloak, Shibboleth."
            >
              {authRow("oidc", "Custom OIDC Issuer", "issuer: …  ·  audience: …")}
            </AuthOpt>
          </Card>

          <Card>
            <h3 className="mb-1 text-sm font-semibold text-gray-900">Allowed Origins</h3>
            <p className="mb-2.5 text-xs text-gray-600">
              Passed to the server runtime as its allowed-origins flag. Browsers and web agents
              calling from anywhere else are refused before authentication runs.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {origins.map((o) => (
                <span
                  key={o}
                  className="mono inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--hover-bg)] px-2.5 text-gray-700"
                >
                  {o}
                  <button
                    type="button"
                    className="text-gray-400 hover:text-red-500"
                    aria-label={`remove ${o}`}
                    onClick={() => setOrigins((x) => x.filter((y) => y !== o))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Input
                className="mono h-9 max-w-[360px]"
                placeholder="https://…"
                value={originIn}
                onChange={(e) => setOriginIn(e.target.value)}
                aria-invalid={bad || undefined}
                onKeyDown={(e) => e.key === "Enter" && addOrigin()}
              />
              <Button size="lg" variant="outline" onClick={addOrigin}>
                Add Origin
              </Button>
            </div>
            <div className="mt-3.5">
              <Label htmlFor="hosts" className="mb-1.5 text-gray-700">
                Allowed Hosts{" "}
                <span className="text-xs font-normal text-gray-500">
                  · allowed-hosts flag, DNS-rebinding guard
                </span>
              </Label>
              <Input
                id="hosts"
                className="mono h-9 max-w-[360px]"
                placeholder="localhost, *.example.com"
                value={hosts}
                onChange={(e) => setHosts(e.target.value)}
              />
            </div>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-0">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              tools.yaml <span className="text-xs font-normal text-gray-600">· generated</span>
            </h3>
            <CopyButton text={preview.data} />
          </div>
          <QueryState query={preview}>
            {(yaml) => (
              <pre className="mono overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] p-3.5 text-[12px] leading-[1.55] text-gray-700">
                {yaml}
              </pre>
            )}
          </QueryState>
          <p className="mt-2.5 text-xs text-gray-600">
            One runtime process per server on the host, started with this file plus the origins and
            hosts above. Attaching an agent registers the endpoint on ibl.ai for that agent.
          </p>
        </Card>
      </div>
    </>
  );
}

function CopyButton({ text }: { text: string | undefined }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(text ?? "").then(
      () => {
        setErr(null);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      (e: unknown) => setErr(errorText(e)),
    );
  return (
    <>
      <Button size="sm" variant="outline" disabled={text === undefined} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
      {err && <span className="basis-full font-sans text-xs text-red-600">{err}</span>}
    </>
  );
}

function AuthOpt({
  checked,
  onCheckedChange,
  disabled,
  title,
  tag,
  desc,
  children,
}: {
  checked: boolean;
  onCheckedChange?: (on: boolean) => void;
  disabled?: boolean;
  title: string;
  tag?: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-lg border border-[var(--border-color)] p-3 last:mb-0">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange?.(!!v)}
        className="mt-0.5"
        aria-label={title}
      />
      <div>
        <div className="text-sm font-semibold text-gray-900">
          {title}{" "}
          {tag && (
            <span className="mono ml-1 rounded bg-[var(--hover-bg)] px-1.5 py-0.5 text-[11px] font-normal text-gray-600">
              {tag}
            </span>
          )}
        </div>
        <small className="block text-xs text-gray-600">{desc}</small>
        {children}
      </div>
    </div>
  );
}
