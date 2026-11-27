"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import { FilePicker } from "@/components/file-picker";
import { QueryState } from "@/components/query-state";
import { SetupHelp } from "@/components/setup-steps";
import { catalog, useActions, useSystems, type CatalogKind } from "@/lib/data";
import type {
  HostApiEndpoint,
  HostApiMethod,
  HostApiOAuthInput,
  HostSpec,
  HostSystemTest,
} from "@/lib/host/types";
import { isDemo } from "@/lib/iblai/session";
import { load } from "@/lib/library";
import { toolName, type ReadyApi } from "@/lib/library/types";
import { cn } from "@/lib/utils";
import { withScheme } from "@/lib/view/systems";

const filters = ["All", "Databases", "Warehouses", "APIs", "Cloud"] as const;
const groupOf: Record<string, CatalogKind["group"]> = {
  Databases: "db",
  Warehouses: "wh",
  APIs: "api",
  Cloud: "gc",
};

// The Connection URL scheme a catalog kind puts in the field; any other kind sets nothing.
const schemeOf: Record<string, string> = {
  PostgreSQL: "postgresql://",
  MySQL: "mysql://",
  Snowflake: "snowflake://",
  ClickHouse: "clickhouse://",
  Trino: "trino://",
  Databricks: "databricks://",
  Filesystem: "local://",
};

// The server builder reads this key to tick the same toolsets.
const PREBUILT_KEY = "ontology.prebuilt";
// "1" while the connected list is folded away.
const HIDE_CONNECTED_KEY = "ontology.hide-connected";

const demo = isDemo();
const DEMO_URL = "snowflake://FIN_RO:••••@acme.us-east-1/FIN?warehouse=ANALYTICS";
const DEMO_SCOPE = ["FIN.AWARDS", "FIN.TUITION_INVOICES", "FIN.LEDGER"];
const DEMO_BASE = "https://api.crm.example";
const DEMO_AUTH = "Authorization: Bearer ${CRM_TOKEN}";
const DEMO_ENDPOINTS = [
  "GET /v3/objects/contacts",
  "GET /v3/objects/deals",
  "GET /v3/objects/companies",
];

/** The database a connection URL names: the engine names the system after it. */
function databaseOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/")[1] ?? "");
  } catch {
    return "";
  }
}

/** "local:///srv/Data Room" → "data-room". */
function localNameOf(url: string): string {
  const last = url.slice("local://".length).split("/").filter(Boolean).pop() ?? "";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 53);
}

/** "https://api.crm.example" → "crm". */
function apiNameOf(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^(api|www)\./, "");
    return (host.split(".")[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  } catch {
    return "";
  }
}

/** "GET /v3/objects/{id}" → a tool named get_v3_objects_id; null when not that shape. */
function endpointOf(line: string): HostApiEndpoint | null {
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s?#]*)$/i.exec(line.trim());
  if (!m) return null;
  const method = m[1].toUpperCase() as HostApiMethod;
  const path = m[2];
  const name = [method, ...path.split(/[^A-Za-z0-9]+/)].filter(Boolean).join("_").toLowerCase();
  return { name, method, path, description: "", query: [] };
}

const keyOf = (ep: HostApiEndpoint) => `${ep.method} ${ep.path}`;

// `own`: from a ready-made API, so named behind the API's own name when it is saved.
type Row = { ep: HostApiEndpoint; on: boolean; own?: boolean };
const DEMO_ROWS: Row[] = DEMO_ENDPOINTS.map((e) => ({ ep: endpointOf(e)!, on: true }));

// The demo fills every OAuth sign-in with a test client.
const NO_OAUTH: HostApiOAuthInput = {
  grant: "client_credentials",
  tokenUrl: "",
  clientId: demo ? "test-id" : "",
  clientAuth: "basic",
  scope: "",
  clientSecret: demo ? "test-secret" : "",
  refreshToken: "",
};

/** "3 operations and 12 parameters", for what a document held that a tool cannot carry. */
function leftWords({ operations, parameters }: NonNullable<HostSpec["left"]>): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [
    ...(operations ? [count(operations, "operation")] : []),
    ...(parameters ? [count(parameters, "parameter")] : []),
  ].join(" and ");
}

/** Adds a document's operations after the rows already there; a small one has its GETs ticked. */
function mergeSpec(rows: Row[], eps: HostApiEndpoint[]): Row[] {
  const seen = new Set(rows.map((r) => keyOf(r.ep)));
  const small = eps.length <= 20;
  const next = [...rows];
  for (const ep of eps) {
    if (seen.has(keyOf(ep))) continue;
    seen.add(keyOf(ep));
    next.push({ ep, on: small && ep.method === "GET" });
  }
  return next;
}

/** One action's in-flight flag and rejection message. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Cap({ kind, children }: { kind: "o" | "m" | "x"; children: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        kind === "o" && "bg-[#eef6fc] text-[#0058cc]",
        kind === "m" && "bg-emerald-50 text-emerald-600",
        kind === "x" && "bg-[var(--hover-bg)] text-gray-400",
      )}
    >
      {children}
    </span>
  );
}

export default function SystemsPage() {
  const router = useRouter();
  const actions = useActions();
  const systemsQ = useSystems();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [tab, setTab] = useState("db");
  const shown = catalog.filter((c) => filter === "All" || c.group === groupOf[filter]);
  // Client-only, as the providers render after mount.
  const [connectedHidden, setConnectedHidden] = useState(
    () => localStorage.getItem(HIDE_CONNECTED_KEY) === "1",
  );
  const toggleConnected = () => {
    setConnectedHidden(!connectedHidden);
    localStorage.setItem(HIDE_CONNECTED_KEY, connectedHidden ? "0" : "1");
  };

  // Database tab
  const [url, setUrl] = useState(demo ? DEMO_URL : "");
  const [scope, setScope] = useState<string[]>(demo ? DEMO_SCOPE : []);
  const [adding, setAdding] = useState(false);
  const [scopeDraft, setScopeDraft] = useState("");
  const [pii, setPii] = useState(true);
  const [probing, setProbing] = useState(true);
  const [result, setResult] = useState<HostSystemTest | null>(null);
  const test = useRun();
  const connect = useRun();
  // What to call the system: the database's name until the person types one.
  const [label, setLabel] = useState<string | null>(demo ? "finance" : null);
  const input = { url, scope, pii, probing, label: (label ?? "").trim() };

  // Filesystem form: after a click on Filesystem, and while the URL is local://.
  const [files, setFiles] = useState(false);
  const isLocal = files || url.startsWith("local://");
  const expose = useRun();

  // HTTP API tab
  const [baseUrl, setBaseUrl] = useState(demo ? DEMO_BASE : "");
  const [nameDraft, setNameDraft] = useState<string | null>(null); // null follows the address
  const apiName = nameDraft ?? apiNameOf(baseUrl);
  const [specUrl, setSpecUrl] = useState("");
  const [authHeader, setAuthHeader] = useState(demo ? DEMO_AUTH : "");
  // OAuth in place of the header: the fields, and whether they are the ones in use.
  const [oauthOn, setOauthOn] = useState(false);
  const [oauth, setOauth] = useState(NO_OAUTH);
  const setSignIn = (part: Partial<HostApiOAuthInput>) => setOauth((all) => ({ ...all, ...part }));
  // With a refresh token the host renews from it; a ready-made API may ask for one.
  const signIn: HostApiOAuthInput = {
    ...oauth,
    grant:
      oauth.refreshToken.trim() || oauth.grant === "refresh_token"
        ? "refresh_token"
        : "client_credentials",
  };
  const auth = oauthOn ? { authHeader: "", oauth: signIn } : { authHeader };
  // The ready-made API the form was filled from, for its example address and its hint.
  const [ready, setReady] = useState<ReadyApi | null>(null);
  const tokenExample = ready && "oauth" in ready.auth ? ready.auth.oauth.tokenExample : undefined;
  const authLabel = useRef<HTMLSpanElement>(null);
  const [rows, setRows] = useState<Row[]>(demo ? DEMO_ROWS : []);
  const [manual, setManual] = useState("");
  const [manualBad, setManualBad] = useState(false);
  const [find, setFind] = useState("");
  const many = rows.length > 8;
  const q = find.trim().toLowerCase();
  const shownRows = many && q ? rows.filter((r) => keyOf(r.ep).toLowerCase().includes(q)) : rows;
  const fetchSpec = useRun();
  const addApi = useRun();

  // Prebuilt tab
  const [ticked, setTicked] = useState<string[]>([]);
  useEffect(() => {
    setTicked(JSON.parse(localStorage.getItem(PREBUILT_KEY) ?? "[]") as string[]);
  }, []);
  const tick = (toolset: string, on: boolean) => {
    const next = on ? [...ticked, toolset] : ticked.filter((t) => t !== toolset);
    setTicked(next);
    localStorage.setItem(PREBUILT_KEY, JSON.stringify(next));
  };

  // Fills the HTTP API form from a ready-made API: its reads ticked, its changes left to tick.
  const fillFrom = (api: ReadyApi) => {
    const preset = "oauth" in api.auth ? api.auth.oauth : null;
    setReady(api);
    setNameDraft(api.id);
    setBaseUrl(api.baseUrl);
    setSpecUrl("");
    setFind("");
    setOauthOn(preset !== null);
    setAuthHeader("header" in api.auth ? api.auth.header : "");
    setOauth({
      ...NO_OAUTH,
      ...(preset && {
        grant: preset.grant,
        tokenUrl: preset.tokenUrl,
        clientAuth: preset.clientAuth,
        scope: preset.scope,
      }),
    });
    const asks = api.ask ?? [];
    setRows(
      api.endpoints.map((ep) => ({
        ep,
        on: ep.method === "GET" || asks.includes(ep.name),
        own: true,
      })),
    );
  };

  const pickKind = (c: CatalogKind) => {
    const scheme = schemeOf[c.name];
    if (scheme) {
      setUrl((u) => withScheme(u, scheme));
      setFiles(scheme === "local://");
      setTab("db");
    } else if (c.group === "api") {
      setTab("api");
      if (c.ready) {
        void load[c.ready]().then(fillFrom, () =>
          toast(`${c.name} did not load: reload the page.`),
        );
      }
    }
  };

  // Closes the scope field, keeping what was typed; null drops it (Escape).
  const dropScope = useRef(false);
  const closeScope = (typed: string | null) => {
    const t = (typed ?? "").trim();
    if (t) setScope((all) => (all.includes(t) ? all : [...all, t]));
    setScopeDraft("");
    setAdding(false);
  };

  const addManual = () => {
    const ep = endpointOf(manual);
    setManualBad(!ep);
    if (!ep) return;
    setRows([...rows.filter((r) => keyOf(r.ep) !== keyOf(ep)), { ep, on: true }]);
    setManual("");
  };

  // Ticks or unticks the rows the filter shows; every row when it shows them all.
  const tickShown = (on: boolean) => {
    const keys = new Set(shownRows.map((r) => keyOf(r.ep)));
    setRows((all) => all.map((r) => (keys.has(keyOf(r.ep)) ? { ...r, on } : r)));
  };

  return (
    <>
      <PageHeader
        eyebrow="Step 1 · Connect"
        title="Systems"
        description="Pick from the catalog or wrap any HTTP endpoint. Databases are dissected into the ontology and served; HTTP APIs are served as named tools only. Credentials are tested before they are saved."
        actions={
          <div className="inline-flex overflow-hidden rounded-md border border-[var(--border-color)] bg-white">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "h-[30px] px-2.5 text-[13px] text-gray-600",
                  filter === f && "bg-[#eef6fc] font-medium text-[#0058cc]",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <Card className="mb-3.5">
            <QueryState query={systemsQ}>
              {(data) => (
                <>
                  <div
                    className={cn("flex items-center justify-between", !connectedHidden && "mb-2")}
                  >
                    <h3 className="text-sm font-semibold text-gray-900">
                      Connected to Institution
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">
                        {data.systems.length} databases · {data.apis.length} API
                        {data.files.length > 0 && ` · ${data.files.length} filesystems`}
                      </span>
                      <button
                        type="button"
                        className="-mr-1 text-gray-400 hover:text-gray-700"
                        aria-expanded={!connectedHidden}
                        aria-label={`${connectedHidden ? "Show" : "Hide"} the connected systems`}
                        onClick={toggleConnected}
                      >
                        <ChevronDown
                          className={cn(
                            "size-4 transition-transform",
                            connectedHidden && "-rotate-90",
                          )}
                        />
                      </button>
                    </div>
                  </div>
                  {!connectedHidden && (
                    <>
                      {data.systems.map((s) => (
                        <div
                          key={s.key}
                          className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-color)] py-2.5 last:border-b-0"
                        >
                          <div
                            className="grid size-[34px] place-items-center rounded-lg text-[11px] font-bold text-white"
                            style={{ background: s.color }}
                          >
                            {s.abbr}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm">
                              <b className="text-gray-900">{s.name}</b>{" "}
                              <span className="text-gray-600">· {s.engine}</span>
                              {s.dissect && <Tag tone="blue">dissect</Tag>}
                              {s.serve && <Tag tone="green">serve</Tag>}
                            </div>
                            <small className="mono block truncate text-[11.5px] text-gray-600">
                              {s.url} · {s.detail}
                            </small>
                          </div>
                          {s.status === "ingested" ? (
                            <Pill tone="green" dot>
                              ingested
                            </Pill>
                          ) : (
                            <Pill tone="amber" dot>
                              {s.status}
                            </Pill>
                          )}
                        </div>
                      ))}
                      {data.apis.map((a) => (
                        <div
                          key={a.name}
                          className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-color)] py-2.5 last:border-b-0"
                        >
                          <div className="grid size-[34px] place-items-center rounded-lg bg-[#FF7A59] text-[11px] font-bold text-white">
                            API
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm">
                              <b className="text-gray-900">{a.name}</b>{" "}
                              <span className="text-gray-600">· HTTP API</span>{" "}
                              <Tag tone="green">serve</Tag>
                            </div>
                            <small className="mono block truncate text-[11.5px] text-gray-600">
                              {a.baseUrl} · {a.endpoints} endpoints → {a.tools} tools
                            </small>
                          </div>
                          <Pill tone="green" dot>
                            serving
                          </Pill>
                        </div>
                      ))}
                      {data.files.map((f) => (
                        <div
                          key={f.name}
                          className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-color)] py-2.5 last:border-b-0"
                        >
                          <div className="grid size-[34px] place-items-center rounded-lg bg-[#64748B] text-[11px] font-bold text-white">
                            FS
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm">
                              <b className="text-gray-900">{f.name}</b>{" "}
                              <span className="text-gray-600">· Filesystem</span>{" "}
                              <Tag tone="green">serve</Tag>
                            </div>
                            <small className="mono block truncate text-[11.5px] text-gray-600">
                              {f.url}
                            </small>
                          </div>
                          <Pill tone="green" dot>
                            serving
                          </Pill>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </QueryState>
          </Card>

          <div className="eyebrow mb-2">Catalog</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5">
            {shown.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => pickKind(c)}
                className="rounded-lg border border-[var(--border-color)] bg-white p-3 text-left transition hover:border-[#0058cc]"
              >
                {c.logo ? (
                  <Image
                    src={c.logo}
                    alt=""
                    width={30}
                    height={30}
                    className="mb-2 size-[30px] object-contain"
                  />
                ) : (
                  <div
                    className="mb-2 grid size-[30px] place-items-center rounded-md text-[11px] font-bold text-white"
                    style={{ background: c.color }}
                  >
                    {c.abbr}
                  </div>
                )}
                <b className="block text-[13px] font-semibold text-gray-900">{c.name}</b>
                <div className="mt-2 flex gap-1">
                  {c.dissect ? <Cap kind="o">DISSECT</Cap> : <Cap kind="x">—</Cap>}
                  {c.serve ? <Cap kind="m">SERVE</Cap> : <Cap kind="x">—</Cap>}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-xs text-gray-600">
            <Cap kind="o">DISSECT</Cap> schema read and terms inferred by the engine &nbsp;{" "}
            <Cap kind="m">SERVE</Cap> a source kind the server runtime can expose
          </p>
        </div>

        <Card>
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList
              variant="line"
              className="mb-3 w-full justify-start overflow-x-auto overflow-y-hidden border-b border-[var(--border-color)]"
            >
              <TabsTrigger
                value="db"
                className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]"
              >
                {isLocal ? "Filesystem" : "Database"}
              </TabsTrigger>
              <TabsTrigger
                value="api"
                className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]"
              >
                HTTP API
              </TabsTrigger>
              <TabsTrigger
                value="pre"
                className="flex-none px-3 data-active:text-[#0058cc] data-active:after:bg-[#0058cc]"
              >
                Prebuilt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="db" className="space-y-3.5">
              <div>
                <Label htmlFor="src-name" className="mb-1.5 text-gray-700">
                  Name
                </Label>
                <Input
                  id="src-name"
                  className="mono h-9"
                  value={label ?? (isLocal ? localNameOf(url) : databaseOf(url))}
                  placeholder="finance"
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="src-url" className="mb-1.5 text-gray-700">
                  Connection URL
                </Label>
                <Input
                  id="src-url"
                  className="mono h-9"
                  value={url}
                  placeholder={DEMO_URL}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              {isLocal ? (
                <>
                  <div>
                    <Label className="mb-1.5 text-gray-700">Folder or File</Label>
                    <FilePicker
                      picked={url.slice("local://".length)}
                      onPick={(path) => setUrl(`local://${path}`)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="lg"
                      className="ibl-button-primary"
                      disabled={expose.busy}
                      onClick={() =>
                        void expose.run(async () => {
                          await actions.connectLocal({
                            name: (label ?? localNameOf(url)).trim(),
                            url,
                          });
                          router.push("/mcp/new");
                        })
                      }
                    >
                      Connect &amp; Expose
                    </Button>
                  </div>
                  {expose.error && <p className="text-xs text-red-600">{expose.error}</p>}
                </>
              ) : (
                <>
                  <div>
                    <Label className="mb-1.5 text-gray-700">Scope</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {scope.map((t) => (
                        <span
                          key={t}
                          className="mono inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--hover-bg)] px-2.5 text-gray-700"
                        >
                          {t}{" "}
                          <button
                            type="button"
                            className="text-gray-400 hover:text-red-500"
                            aria-label="remove"
                            onClick={() => setScope(scope.filter((x) => x !== t))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {adding ? (
                        <span className="mono inline-flex h-[26px] items-center rounded-full border border-dashed border-gray-300 px-2.5 text-gray-400">
                          <input
                            autoFocus
                            aria-label="table"
                            className="w-56 bg-transparent text-gray-700 outline-none"
                            placeholder="SCHEMA or SCHEMA.TABLE"
                            value={scopeDraft}
                            onChange={(e) => setScopeDraft(e.target.value)}
                            onBlur={(e) => {
                              if (!dropScope.current) closeScope(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                closeScope(e.currentTarget.value);
                              } else if (e.key === "Escape") {
                                dropScope.current = true;
                                closeScope(null);
                              }
                            }}
                          />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            dropScope.current = false;
                            setAdding(true);
                          }}
                          className="mono inline-flex h-[26px] items-center rounded-full border border-dashed border-gray-300 px-2.5 text-gray-400"
                        >
                          + table
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1.5 text-gray-700">Dissection Options</Label>
                    <label className="flex items-start gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                      <Checkbox checked={pii} onCheckedChange={setPii} className="mt-0.5" />{" "}
                      <span>
                        PII detection{" "}
                        <span className="text-xs text-gray-600">
                          · tag columns and mask sample values before they reach a model
                        </span>
                      </span>
                    </label>
                    <label className="mt-1.5 flex items-start gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                      <Checkbox checked={probing} onCheckedChange={setProbing} className="mt-0.5" />{" "}
                      <span>
                        Distinct-value probing{" "}
                        <span className="text-xs text-gray-600">
                          · sample categorical columns for better term names
                        </span>
                      </span>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="lg"
                      variant="outline"
                      disabled={test.busy}
                      onClick={() => {
                        setResult(null);
                        void test.run(async () => setResult(await actions.testConnection(input)));
                      }}
                    >
                      Test Connection
                    </Button>
                    <Button
                      size="lg"
                      className="ibl-button-primary"
                      disabled={connect.busy}
                      onClick={() =>
                        void connect.run(async () => {
                          await actions.connectSystem(input);
                          router.push("/map?dissect=1");
                        })
                      }
                    >
                      Connect &amp; Dissect
                    </Button>
                  </div>
                  {test.busy && <p className="text-xs text-gray-600">Testing credentials…</p>}
                  {test.error && <p className="text-xs text-red-600">{test.error}</p>}
                  {result?.ok && (
                    <p className="text-xs text-gray-600">
                      <span className="font-medium text-emerald-600">✓ Connected</span> ·{" "}
                      {result.message} · {result.ms} ms · use a read-only login
                    </p>
                  )}
                  {result && !result.ok && <p className="text-xs text-red-600">{result.message}</p>}
                  {connect.error && <p className="text-xs text-red-600">{connect.error}</p>}
                </>
              )}
            </TabsContent>

            <TabsContent value="api" className="space-y-3.5">
              <div>
                <Label className="mb-1.5 text-gray-700">Name</Label>
                <Input
                  className="mono h-9"
                  value={apiName}
                  placeholder="crm"
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 text-gray-700">Base URL</Label>
                <Input
                  className="mono h-9"
                  value={baseUrl}
                  placeholder={ready?.example ?? DEMO_BASE}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 text-gray-700">OpenAPI Spec (optional)</Label>
                <Input
                  className="mono h-9"
                  value={specUrl}
                  placeholder="https://…/openapi.json"
                  onChange={(e) => setSpecUrl(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span ref={authLabel} className="flex items-center gap-1.5">
                    <Label className="text-gray-700">
                      {oauthOn ? "Upstream Auth" : "Upstream Auth Header"}
                    </Label>
                    {ready && oauthOn && (
                      <SetupHelp id={ready.id} name={ready.name} anchor={authLabel} />
                    )}
                  </span>
                  <span className="flex gap-3 text-xs text-gray-500">
                    {(["Header", "OAuth 2.0"] as const).map((way) => (
                      <button
                        key={way}
                        type="button"
                        aria-pressed={oauthOn === (way === "OAuth 2.0")}
                        className={cn(
                          "hover:text-gray-900",
                          oauthOn === (way === "OAuth 2.0") && "font-medium text-gray-900",
                        )}
                        onClick={() => setOauthOn(way === "OAuth 2.0")}
                      >
                        {way}
                      </button>
                    ))}
                  </span>
                </div>
                {oauthOn ? (
                  <div className="space-y-2.5">
                    <div>
                      <Label className="mb-1 text-xs font-normal text-gray-600">Token URL</Label>
                      <Input
                        className="mono h-9"
                        value={oauth.tokenUrl}
                        placeholder={tokenExample ?? "https://…/oauth2/token"}
                        onChange={(e) => setSignIn({ tokenUrl: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-normal text-gray-600">Client ID</Label>
                      <Input
                        className="mono h-9"
                        value={oauth.clientId}
                        onChange={(e) => setSignIn({ clientId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-normal text-gray-600">
                        Client Secret
                      </Label>
                      <Input
                        className="mono h-9"
                        type="password"
                        autoComplete="off"
                        value={oauth.clientSecret}
                        onChange={(e) => setSignIn({ clientSecret: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-normal text-gray-600">
                        Scope (optional)
                      </Label>
                      <Input
                        className="mono h-9"
                        value={oauth.scope}
                        onChange={(e) => setSignIn({ scope: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-normal text-gray-600">
                        {oauth.grant === "refresh_token"
                          ? "Refresh Token"
                          : "Refresh Token (optional)"}
                      </Label>
                      <Input
                        className="mono h-9"
                        type="password"
                        autoComplete="off"
                        value={oauth.refreshToken}
                        onChange={(e) => setSignIn({ refreshToken: e.target.value })}
                      />
                    </div>
                    <label className="flex items-start gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm">
                      <Checkbox
                        checked={oauth.clientAuth === "body"}
                        onCheckedChange={(on) => setSignIn({ clientAuth: on ? "body" : "basic" })}
                        className="mt-0.5"
                      />{" "}
                      <span>
                        Credentials in the body{" "}
                        <span className="text-xs text-gray-600">
                          · for a token URL that takes no Basic header
                        </span>
                      </span>
                    </label>
                  </div>
                ) : (
                  <Input
                    className="mono h-9"
                    aria-label="Upstream auth header"
                    value={authHeader}
                    placeholder={DEMO_AUTH}
                    onChange={(e) => setAuthHeader(e.target.value)}
                  />
                )}
                {ready && <p className="mt-1.5 text-xs text-gray-600">{ready.hint}</p>}
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <Label className="text-gray-700">Endpoints to Wrap</Label>
                  {rows.length > 0 && (
                    <span className="flex gap-3 text-xs text-gray-500">
                      <button
                        type="button"
                        className="hover:text-gray-900"
                        onClick={() => tickShown(true)}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="hover:text-gray-900"
                        onClick={() => tickShown(false)}
                      >
                        Unselect all
                      </button>
                    </span>
                  )}
                </div>
                {many && (
                  <Input
                    className="mono mb-1.5 h-9"
                    aria-label="Filter endpoints"
                    placeholder="Filter by method or path…"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                )}
                <div className={cn(many && "mb-1.5 max-h-96 overflow-y-auto")}>
                  {shownRows.map((r) => (
                    <label
                      key={keyOf(r.ep)}
                      className="mb-1.5 flex items-center gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm"
                    >
                      <Checkbox
                        checked={r.on}
                        onCheckedChange={(on) =>
                          setRows((all) => all.map((x) => (x === r ? { ...x, on } : x)))
                        }
                      />{" "}
                      <code className="mono">
                        {r.ep.method} {r.ep.path}
                      </code>
                    </label>
                  ))}
                </div>
                <Input
                  className="mono h-9"
                  aria-label="Add an endpoint"
                  placeholder="GET /path"
                  value={manual}
                  onChange={(e) => {
                    setManual(e.target.value);
                    setManualBad(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }}
                />
                {manualBad && (
                  <p className="mt-1.5 text-xs text-red-600">Write it as METHOD /path.</p>
                )}
              </div>
              <div className="rounded-[10px] border border-[rgba(0,88,204,.25)] bg-[#eef6fc] p-3 text-[12.5px] text-gray-700">
                HTTP APIs are served as named tools only. They do not appear in the map or the
                ontology; map their responses to object types by hand when you expose them.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  variant="outline"
                  disabled={fetchSpec.busy || !specUrl.trim()}
                  onClick={() =>
                    void fetchSpec.run(async () => {
                      const spec = await actions.fetchSpec({ url: specUrl, baseUrl, ...auth });
                      setRows((all) => mergeSpec(all, spec.endpoints));
                      if (spec.withoutAuth) {
                        toast(`Fetched without the auth header. With it, ${spec.withoutAuth}.`);
                      }
                      if (spec.left) {
                        toast(`Left out ${leftWords(spec.left)} that a tool cannot carry.`);
                      }
                    })
                  }
                >
                  Fetch Spec
                </Button>
                <Button
                  size="lg"
                  className="ibl-button-primary"
                  disabled={addApi.busy}
                  onClick={() =>
                    void addApi.run(async () => {
                      const name = apiName.trim();
                      await actions.addApi({
                        name,
                        baseUrl,
                        ...auth,
                        endpoints: rows
                          .filter((r) => r.on)
                          .map((r) =>
                            r.own ? { ...r.ep, name: toolName(name, r.ep.name) } : r.ep,
                          ),
                      });
                      router.push("/mcp/new");
                    })
                  }
                >
                  Add &amp; Expose
                </Button>
              </div>
              {fetchSpec.error && <p className="text-xs text-red-600">{fetchSpec.error}</p>}
              {addApi.error && <p className="text-xs text-red-600">{addApi.error}</p>}
            </TabsContent>

            <TabsContent value="pre" className="space-y-2">
              <p className="text-xs text-gray-600">
                Prebuilt toolsets give raw, read-only access per engine. Use one when you want SQL
                access alongside the ontology tools. Ticked toolsets are already selected when you
                build a server.
              </p>
              <QueryState query={systemsQ}>
                {(data) => (
                  <>
                    {data.prebuilt.map((p) => (
                      <label
                        key={p.toolset}
                        className="flex items-center gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm"
                      >
                        <Checkbox
                          checked={ticked.includes(p.toolset)}
                          onCheckedChange={(on) => tick(p.toolset, on)}
                        />{" "}
                        <code className="mono">{p.label}</code>
                      </label>
                    ))}
                  </>
                )}
              </QueryState>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </>
  );
}
