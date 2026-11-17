"use client";

// The one place a page gets its data and its actions.
//
// Demo mode (NEXT_PUBLIC_DEMO=1) answers from lib/mock.ts and the mocked pages' own literals,
// so every page renders exactly what the mocked build rendered and nothing is written.
// Live mode reads ibl.ai (lib/ibl-flows.ts), the engine and the host (lib/host-api.ts) and
// never reads the mock. The mode is chosen once, at module level, so no hook is conditional.

import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query/react";
import { authorization, hostApi, hostHeaders } from "@/lib/host-api";
import type {
  HostApiInput,
  HostServerDraft,
  HostSpec,
  HostSystemInput,
  HostSystemTest,
} from "@/lib/host/types";
import * as ibl from "@/lib/ibl-flows";
import { keyNameFor } from "@/lib/ibl-flows-pure";
import { isDemo } from "@/lib/iblai/session";
import { currentTenantKey } from "@/lib/iblai/tenant";
import { mcpPath } from "@/lib/platform";
import { hostOf, relaying, serverBase, storedServer, storeServer } from "@/lib/server-address";
import type {
  ActivityRow,
  AgentOption,
  AgentRow,
  ColumnRow,
  CountsView,
  EngineView,
  GraphView,
  KeyRow,
  ObjectTypeView,
  OntologyTree,
  PipelineView,
  PlayTool,
  Query,
  RoleRow,
  ServerActivityView,
  ServerRow,
  ServerView,
  SystemsView,
  ToolRun,
  ToolsetView,
} from "@/lib/view/types";
import { columnRows } from "@/lib/view/columns";
import * as demo from "@/lib/view/demo";
import { graphView } from "@/lib/view/graph";
import { objectTypeView, ontologyTree } from "@/lib/view/ontology";
import { pipelineView } from "@/lib/view/pipeline";
import { errorMessage, parseBody, playTools, toolRun } from "@/lib/view/result";
import { activityView, feedRows, serverRow } from "@/lib/view/servers";
import { apiRow, prebuiltRows, systemRow, unsettled } from "@/lib/view/systems";
import { ago } from "@/lib/view/time";
import type { IblaiAppDispatch } from "@/store/iblai-store";

/* ---------- static ---------- */

// The source kinds the product knows: not fetched.
export { catalog, type CatalogKind } from "@/lib/view/catalog";

const demoMode = isDemo();

/** The console's origin; empty on the server when NEXT_PUBLIC_APP_URL is not set. */
function consoleOrigin(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Where agents reach this platform's servers: its connected server, or the console itself. */
function serverOrigin(): string {
  if (!relaying()) return consoleOrigin();
  return storedServer(currentTenantKey()) ?? "";
}

/** The origins a new server starts with: os.ibl.ai, claude.ai and the console's own. */
export function defaultOrigins(): string[] {
  if (demoMode) return [...demo.demoOrigins];
  // The Playground calls a connected server straight from these pages.
  const own =
    relaying() && typeof window !== "undefined" ? window.location.origin : consoleOrigin();
  return [...new Set(["https://os.ibl.ai", "https://claude.ai", own])].filter(Boolean);
}

/** The address agents call for a server: `<its server's address>/<platform>/<slug>/mcp`. */
export function endpointOf(slug: string): string {
  if (demoMode) return demo.demoEndpoint(slug);
  return `${serverOrigin()}${mcpPath(currentTenantKey(), slug)}`;
}

/* ---------- query plumbing ---------- */

const noop = () => {};
const ready = <T>(data: T): Query<T> => ({ data, isLoading: false, error: null, refetch: noop });
const idle: Query<never> = { data: undefined, isLoading: false, error: null, refetch: noop };

function messageOf(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return String(error);
}

type Rtk<T> = {
  data?: T;
  isLoading: boolean;
  isUninitialized: boolean;
  error?: unknown;
  refetch: () => unknown;
};

/** An RTK Query result as a Query. */
function q<T>(r: Rtk<T>): Query<T> {
  return {
    data: r.data,
    isLoading: r.isLoading,
    error: messageOf(r.error),
    refetch: () => {
      if (!r.isUninitialized) r.refetch();
    },
  };
}

/** Several reads behind one view: loading while any is, the first error, one Retry for all. */
function join<T>(parts: Query<unknown>[], data: T | undefined): Query<T> {
  return {
    data,
    isLoading: data === undefined && parts.some((p) => p.isLoading),
    error: data === undefined ? (parts.map((p) => p.error).find(Boolean) ?? null) : null,
    refetch: () => parts.forEach((p) => p.refetch()),
  };
}

const POLL_MS = 4000;

/** Whether a compile runs or a system is still settling, from what is already cached. */
function useBusy(): boolean {
  const g = hostApi.endpoints.getGraph.useQueryState(undefined);
  const s = hostApi.endpoints.getSystems.useQueryState(undefined);
  const c = hostApi.endpoints.getCompileStatus.useQueryState(undefined);
  return !!g.data?.compile.running || !!c.data?.running || unsettled(s.data ?? []);
}

/* ---------- reads: live ---------- */

function useLiveSystems(): Query<SystemsView> {
  const poll = { pollingInterval: useBusy() ? POLL_MS : 0 };
  const s = q(hostApi.useGetSystemsQuery(undefined, poll));
  const a = q(hostApi.useGetApisQuery());
  const t = q(hostApi.useGetToolsetsQuery());
  const data = useMemo(
    () =>
      s.data && a.data && t.data
        ? {
            systems: s.data.map(systemRow),
            apis: a.data.map(apiRow),
            prebuilt: prebuiltRows(t.data, s.data),
          }
        : undefined,
    [s.data, a.data, t.data],
  );
  return join([s, a, t], data);
}

function useLiveGraph(): Query<GraphView> {
  const poll = { pollingInterval: useBusy() ? POLL_MS : 0 };
  const g = q(hostApi.useGetGraphQuery(undefined, poll));
  const s = q(hostApi.useGetSystemsQuery(undefined, poll));
  const data = useMemo(
    () => (g.data && s.data ? graphView(g.data, s.data) : undefined),
    [g.data, s.data],
  );
  return join([g, s], data);
}

function useLiveTableColumns(tableId: string | null): Query<ColumnRow[]> {
  const c = q(hostApi.useGetTableColumnsQuery(tableId ?? skipToken));
  const g = q(hostApi.useGetGraphQuery());
  const data = useMemo(
    () =>
      tableId && c.data && g.data ? columnRows(c.data, tableId, g.data.foreignKeys) : undefined,
    [tableId, c.data, g.data],
  );
  return tableId ? join([c, g], data) : idle;
}

function useLivePipeline(): Query<PipelineView> {
  const poll = { pollingInterval: useBusy() ? POLL_MS : 0 };
  const g = q(hostApi.useGetGraphQuery(undefined, poll));
  const s = q(hostApi.useGetSystemsQuery(undefined, poll));
  const t = q(hostApi.useGetToolsetsQuery(undefined, poll));
  const data = useMemo(
    () => (g.data && s.data && t.data ? pipelineView(g.data, s.data, t.data) : undefined),
    [g.data, s.data, t.data],
  );
  return join([g, s, t], data);
}

function useLiveOntology(): Query<OntologyTree> {
  const g = q(hostApi.useGetGraphQuery());
  const t = q(hostApi.useGetToolsetsQuery());
  const data = useMemo(
    () => (g.data && t.data ? ontologyTree(g.data, t.data) : undefined),
    [g.data, t.data],
  );
  return join([g, t], data);
}

function useLiveObjectType(id: string | null): Query<ObjectTypeView> {
  const arg = id ?? skipToken;
  const d = q(hostApi.useGetTermQuery(arg));
  const c = q(hostApi.useGetTermColumnAttributesQuery(arg));
  const m = q(hostApi.useGetTermSqlAttributesQuery(arg));
  const g = q(hostApi.useGetGraphQuery());
  const s = q(hostApi.useGetSystemsQuery());
  const t = q(hostApi.useGetToolsetsQuery());
  const data = useMemo(
    () =>
      id && d.data && c.data && m.data && g.data && s.data && t.data
        ? objectTypeView({
            detail: d.data,
            columns: c.data,
            sql: m.data,
            graph: g.data,
            systems: s.data,
            toolsets: t.data,
          })
        : undefined,
    [id, d.data, c.data, m.data, g.data, s.data, t.data],
  );
  return id ? join([d, c, m, g, s, t], data) : idle;
}

function useLiveToolsets(): Query<ToolsetView[]> {
  return q(hostApi.useGetToolsetsQuery());
}

/** Agents connected per server slug. */
function useAgentsBySlug(): Query<Record<string, number>> {
  const agents = ibl.useAgentRows(serverOrigin());
  const data = useMemo(() => {
    if (!agents.data) return undefined;
    const by: Record<string, number> = {};
    for (const a of agents.data) by[a.server] = (by[a.server] ?? 0) + 1;
    return by;
  }, [agents.data]);
  return join([agents], data);
}

function useLiveServers(): Query<ServerRow[]> {
  const s = q(hostApi.useGetServersQuery());
  const a = useAgentsBySlug();
  const data = useMemo(() => {
    const by = a.data;
    return s.data && by
      ? s.data.map((x) => serverRow(x, endpointOf(x.slug), by[x.slug] ?? 0))
      : undefined;
  }, [s.data, a.data]);
  return join([s, a], data);
}

function useLiveServer(slug: string): Query<ServerView | null> {
  const s = q(hostApi.useGetServerQuery(slug));
  const a = useAgentsBySlug();
  const data = useMemo(() => {
    if (s.data === undefined || !a.data) return undefined;
    if (s.data === null) return null;
    return { ...serverRow(s.data, endpointOf(slug), a.data[slug] ?? 0), yaml: s.data.yaml };
  }, [s.data, a.data, slug]);
  return join([s, a], data);
}

function useLiveServerActivity(slug: string): Query<ServerActivityView> {
  const r = q(hostApi.useGetServerActivityQuery(slug));
  const data = useMemo(() => (r.data ? activityView(r.data) : undefined), [r.data]);
  return join([r], data);
}

function useLiveConfigPreview(slug: string, draft: HostServerDraft): Query<string> {
  const [debounced, setDebounced] = useState({ slug, draft });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ slug, draft }), 300);
    return () => clearTimeout(t);
  }, [slug, draft]);
  const r = q(hostApi.usePreviewServerQuery(debounced.slug ? debounced : skipToken));
  return slug ? join([r], r.data?.yaml) : ready("");
}

function useLiveAgents(): Query<AgentRow[]> {
  const agents = ibl.useAgentRows(serverOrigin());
  const slugs = useMemo(
    () => [...new Set((agents.data ?? []).map((a) => a.server))].sort(),
    [agents.data],
  );
  const calls = q(hostApi.useGetAgentCallsQuery(agents.data ? slugs : skipToken));
  const data = useMemo(() => {
    const by = calls.data;
    if (!agents.data || !by) return undefined;
    return agents.data.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      server: a.server,
      authScope: a.authScope,
      authType: a.authType,
      status: a.status,
      calls: by[a.server]?.[a.label] ?? 0,
    }));
  }, [agents.data, calls.data]);
  return join([agents, calls], data);
}

function useLiveActivity(): Query<ActivityRow[]> {
  const e = q(hostApi.useGetActivityQuery());
  const g = q(hostApi.useGetGraphQuery());
  const agents = ibl.useAgentRows(serverOrigin());
  const data = useMemo(
    () =>
      e.data && g.data && agents.data
        ? feedRows(
            e.data,
            { at: g.data.compile.lastSuccessAt, terms: g.data.terms.length },
            agents.data,
          )
        : undefined,
    [e.data, g.data, agents.data],
  );
  return join([e, g, agents], data);
}

function useLiveEngine(): Query<EngineView> {
  const poll = { pollingInterval: useBusy() ? POLL_MS : 0 };
  const st = q(hostApi.useGetCompileStatusQuery(undefined, poll));
  const c = q(hostApi.useGetSwitchQuery("compilation"));
  const p = q(hostApi.useGetSwitchQuery("pii"));
  const v = q(hostApi.useGetSwitchQuery("probing"));
  const g = q(hostApi.useGetGraphQuery(undefined, poll));
  const data = useMemo(() => {
    if (!st.data || !c.data || !p.data || !v.data || !g.data) return undefined;
    const when = (iso: string | null) => (iso ? `${ago(iso)} ago` : null);
    return {
      running: st.data.running,
      lastSuccess: when(st.data.last_success_at),
      lastFailure: when(st.data.last_failure_at),
      switches: { compilation: c.data.enabled, pii: p.data.enabled, probing: v.data.enabled },
      timeout: null,
      terms: g.data.terms.length,
      relationships: g.data.termLinks.length,
    };
  }, [st.data, c.data, p.data, v.data, g.data]);
  return join([st, c, p, v, g], data);
}

function useLiveCounts(): CountsView {
  const s = hostApi.useGetSystemsQuery();
  const g = hostApi.useGetGraphQuery();
  const sv = hostApi.useGetServersQuery();
  const roles = ibl.useRoleRows();
  const agents = ibl.useAgentRows(serverOrigin());
  return {
    systems: s.data?.length ?? null,
    catalog: g.data?.tables.length ?? null,
    ontology: g.data?.terms.length ?? null,
    gateway: sv.data ? sv.data.filter((x) => x.enabled).reduce((n, x) => n + x.tools, 0) : null,
    roles: roles.data?.length ?? null,
    agents: agents.data?.length ?? null,
  };
}

/* ---------- reads: demo ---------- */

const demoReads = {
  systems: ready(demo.demoSystems),
  graph: ready(demo.demoGraph),
  pipeline: ready(demo.demoPipeline),
  ontology: ready(demo.demoOntology),
  toolsets: ready(demo.demoToolsets),
  servers: ready(demo.demoServers),
  activity: ready(demo.demoServerActivity),
  preview: ready(demo.demoYaml),
  keys: ready(demo.demoKeys),
  agents: ready(demo.demoAgents),
  options: ready(demo.demoAgentOptions),
  feed: ready(demo.demoFeed),
  roles: ready(demo.demoRoles),
  engine: ready(demo.demoEngine),
};

function useDemoTableColumns(tableId: string | null): Query<ColumnRow[]> {
  return useMemo(() => (tableId ? ready(demo.demoColumns(tableId)) : idle), [tableId]);
}

function useDemoObjectType(id: string | null): Query<ObjectTypeView> {
  return useMemo(() => {
    if (!id) return idle;
    const view = demo.demoObjectType(id);
    return view ? ready(view) : { ...idle, error: `No object type named ${id}.` };
  }, [id]);
}

function useDemoServer(slug: string): Query<ServerView | null> {
  return useMemo(() => ready(demo.demoServer(slug)), [slug]);
}

/* ---------- reads ---------- */

/** Connected databases, custom APIs, and one raw toolset per database for the Prebuilt tab. */
export const useSystems: () => Query<SystemsView> = demoMode
  ? () => demoReads.systems
  : useLiveSystems;

/** Tables, joins, terms and their links, as the Map draws them. */
export const useGraph: () => Query<GraphView> = demoMode ? () => demoReads.graph : useLiveGraph;

/** The columns of one table, for the Map's inspector. Idle while `tableId` is null. */
export const useTableColumns: (tableId: string | null) => Query<ColumnRow[]> = demoMode
  ? useDemoTableColumns
  : useLiveTableColumns;

/** The six stages, their log lines and the cross-system banner. Polls while a stage runs. */
export const usePipeline: () => Query<PipelineView> = demoMode
  ? () => demoReads.pipeline
  : useLivePipeline;

/** The Ontology page's tree and header pills. */
export const useOntology: () => Query<OntologyTree> = demoMode
  ? () => demoReads.ontology
  : useLiveOntology;

/** One object type in full. Idle while `id` is null. */
export const useObjectType: (id: string | null) => Query<ObjectTypeView> = demoMode
  ? useDemoObjectType
  : useLiveObjectType;

/** The toolsets a server can be built from. */
export const useToolsets: () => Query<ToolsetView[]> = demoMode
  ? () => demoReads.toolsets
  : useLiveToolsets;

/** Every server on this host. */
export const useServers: () => Query<ServerRow[]> = demoMode
  ? () => demoReads.servers
  : useLiveServers;

/** One server; `data` is null when there is no server by that slug. */
export const useServer: (slug: string) => Query<ServerView | null> = demoMode
  ? useDemoServer
  : useLiveServer;

/** A server's calls, runtime log and sparklines. */
export const useServerActivity: (slug: string) => Query<ServerActivityView> = demoMode
  ? () => demoReads.activity
  : useLiveServerActivity;

/** The config file a draft would write, as text. Follows the draft, debounced. */
export const useConfigPreview: (slug: string, draft: HostServerDraft) => Query<string> = demoMode
  ? () => demoReads.preview
  : useLiveConfigPreview;

/** ibl.ai API keys that carry an ontology policy. */
export const useApiKeys: () => Query<KeyRow[]> = demoMode ? () => demoReads.keys : ibl.useKeyRows;

/** ibl.ai agents that hold a connection to a server on this console. */
export const useAgents: () => Query<AgentRow[]> = demoMode ? () => demoReads.agents : useLiveAgents;

/** The platform's agents, to choose one to attach. */
export const useAgentOptions: () => Query<AgentOption[]> = demoMode
  ? () => demoReads.options
  : ibl.useAgentOptions;

/** The dashboard's feed: deploys, compiles, agent connections, newest first. */
export const useActivity: () => Query<ActivityRow[]> = demoMode
  ? () => demoReads.feed
  : useLiveActivity;

/** The ontology's policies on ibl.ai, with their toolsets and who holds them. */
export const useRoles: () => Query<RoleRow[]> = demoMode ? () => demoReads.roles : ibl.useRoleRows;

/** The engine's compile status and switches. */
export const useEngine: () => Query<EngineView> = demoMode ? () => demoReads.engine : useLiveEngine;

/** The sidebar's badges. */
export const useCounts: () => CountsView = demoMode ? () => demo.demoCounts : useLiveCounts;

/* ---------- actions ---------- */

// Every action rejects with an Error whose message is the server's own words, and on success
// makes the reads it changed fetch again. In demo mode each resolves with what the mocked page
// showed and changes nothing.
export type Actions = {
  /** Asks the engine to try the login. */
  testConnection(input: HostSystemInput): Promise<HostSystemTest>;
  /** Saves the password on the host, sets the two switches, creates the engine connection. */
  connectSystem(input: HostSystemInput): Promise<void>;
  /** The operations of an OpenAPI document, fetched by the host. */
  fetchSpec(input: { url: string; baseUrl: string; authHeader: string }): Promise<HostSpec>;
  /** Saves a custom HTTP API on the host. */
  addApi(input: HostApiInput): Promise<void>;

  /** Starts a compile now. */
  compile(): Promise<void>;
  /** Certifies (or uncertifies) a term's name and description. */
  certifyTerm(id: string, on: boolean): Promise<void>;
  /** Saves a term's name and description. */
  saveTerm(id: string, patch: { name: string; description: string }): Promise<void>;
  /** Certifies one property (a column attribute) of a term. */
  certifyProperty(termId: string, id: string, on: boolean): Promise<void>;
  /** Certifies one metric (a SQL attribute). */
  certifyMetric(id: string, on: boolean): Promise<void>;

  /** Writes the server's config; with `deploy`, also starts it and waits until it is loaded. */
  saveServer(slug: string, draft: HostServerDraft, deploy: boolean): Promise<void>;
  /** Puts the previous revision back. */
  rollbackServer(slug: string): Promise<void>;
  /** Creates an ibl.ai API key limited to these toolsets. The secret is returned once. */
  issueToken(
    slug: string,
    label: string,
    toolsets: string[],
  ): Promise<{ name: string; secret: string }>;
  /** Deletes an ibl.ai API key. */
  revokeKey(id: string): Promise<void>;
  /** Gives an agent a key limited to these toolsets and registers the server for it. */
  attachAgent(input: {
    agentId: string;
    agentName: string;
    slug: string;
    toolsets: string[];
  }): Promise<void>;
  /** The tools the signed-in user may call on a server, through the gateway. */
  listTools(slug: string): Promise<PlayTool[]>;
  /** Calls one tool through the gateway with the signed-in user's session. Never rejects. */
  runTool(slug: string, tool: string, args: Record<string, unknown>): Promise<ToolRun>;

  /** Turns one engine switch on or off. Turning compilation on also starts a compile. */
  setSwitch(name: "compilation" | "pii" | "probing", on: boolean): Promise<void>;
  /** Downloads the engine's model export. */
  exportModel(): Promise<void>;

  /** Connects this browser to the platform's server at this host, once it answers. */
  connectServer(host: string): Promise<void>;
};

/** An RTK mutation's answer, or an Error in the server's words. */
async function unwrap<T>(p: { unwrap(): Promise<T> }): Promise<T> {
  try {
    return await p.unwrap();
  } catch (e) {
    throw new Error(messageOf(e) ?? "The request failed.");
  }
}

/** A server's address from the host name an admin typed, or an Error in plain words. */
function addressOf(host: string): string {
  const base = serverBase(host);
  if (!base) throw new Error("That is not a host name.");
  return base;
}

/** One JSON-RPC call to the gateway with the signed-in user's session. */
async function rpc(slug: string, method: string, params?: unknown) {
  const platform = currentTenantKey();
  if (!platform) throw new Error("There is no signed-in platform, so the gateway was not called.");
  const auth = authorization();
  const server = relaying() ? (storedServer(platform) ?? "") : "";
  const res = await fetch(`${server}${mcpPath(platform, slug)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  const body = parseBody(await res.text());
  return { status: res.status, statusText: res.statusText || String(res.status), body };
}

const filenameOf = (disposition: string | null) =>
  disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];

async function downloadExport(): Promise<void> {
  const res = await fetch("/api/host/ao/model/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostHeaders() },
    body: "{}",
  });
  if (!res.ok) throw new Error(errorMessage(parseBody(await res.text()), res.statusText));
  const blob = await res.blob();
  const name = decodeURIComponent(filenameOf(res.headers.get("content-disposition")) ?? "model");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function useLiveActions(): Actions {
  const dispatch = useDispatch<IblaiAppDispatch>();
  return useMemo(() => {
    const e = hostApi.endpoints;
    const actions: Actions = {
      testConnection: (input) => unwrap(dispatch(e.testSystem.initiate(input))),
      connectSystem: async (input) => {
        await unwrap(dispatch(e.addSystem.initiate(input)));
      },
      fetchSpec: (input) => unwrap(dispatch(e.fetchSpec.initiate(input))),
      addApi: async (input) => {
        await unwrap(dispatch(e.addApi.initiate(input)));
      },
      compile: async () => {
        await unwrap(dispatch(e.setSwitch.initiate({ name: "compilation", on: true })));
      },
      certifyTerm: async (term, on) => {
        const patch = { name_certified: on, description_certified: on };
        await unwrap(dispatch(e.patchTerm.initiate({ term, patch })));
      },
      saveTerm: async (term, patch) => {
        await unwrap(dispatch(e.patchTerm.initiate({ term, patch })));
      },
      certifyProperty: async (term, attr, on) => {
        const patch = { certified: on };
        await unwrap(dispatch(e.patchColumnAttribute.initiate({ term, attr, patch })));
      },
      certifyMetric: async (attr, on) => {
        await unwrap(dispatch(e.patchSqlAttribute.initiate({ attr, patch: { certified: on } })));
      },
      saveServer: async (slug, draft, deploy) => {
        await unwrap(dispatch(e.saveServer.initiate({ slug, draft, start: deploy })));
      },
      rollbackServer: async (slug) => {
        await unwrap(dispatch(e.rollbackServer.initiate(slug)));
      },
      issueToken: async (slug, label, toolsets) => {
        if (!/[A-Za-z0-9]/.test(label)) throw new Error("Name the token with a letter or a digit.");
        return ibl.issueKey(keyNameFor(slug, label), toolsets);
      },
      revokeKey: (id) => ibl.revokeKey(id),
      attachAgent: ({ agentId, agentName, slug, toolsets }) => {
        const label = agentName.replace(/[^A-Za-z0-9 ._-]/g, "");
        const url = `${endpointOf(slug)}?agent=${encodeURIComponent(label)}`;
        return ibl.attachAgent({ agentId, agentName, slug, url, toolsets });
      },
      listTools: async (slug) => {
        const r = await rpc(slug, "tools/list");
        return playTools(r.body, r.statusText);
      },
      runTool: async (slug, tool, args) => {
        const t0 = performance.now();
        const ms = () => Math.round(performance.now() - t0);
        try {
          const r = await rpc(slug, "tools/call", { name: tool, arguments: args });
          return toolRun(tool, r.status, ms(), r.body, r.statusText);
        } catch (err) {
          const error = messageOf(err) ?? "The gateway did not answer.";
          return { ok: false, status: 0, ms: ms(), error };
        }
      },
      setSwitch: async (name, on) => {
        await unwrap(dispatch(e.setSwitch.initiate({ name, on })));
      },
      exportModel: downloadExport,
      connectServer: async (host) => {
        const server = addressOf(host);
        const asked = e.getHealth.initiate(server, { forceRefetch: true, subscribe: false });
        // Typed as the health answer, but whatever answers at that address can say anything.
        const answer: unknown = await unwrap(dispatch(asked));
        if ((answer as { ok?: unknown } | null)?.ok !== true) {
          throw new Error(
            `${hostOf(server)} answered, but not as an ontology server: check the host name.`,
          );
        }
        storeServer(currentTenantKey(), server);
      },
    };
    return actions;
  }, [dispatch]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = async () => {};

const demoActions: Actions = {
  testConnection: async () => {
    await sleep(900);
    return demo.demoTest;
  },
  connectSystem: done,
  fetchSpec: async () => ({ title: "", endpoints: demo.demoSpec }),
  addApi: done,
  compile: done,
  certifyTerm: done,
  saveTerm: done,
  certifyProperty: done,
  certifyMetric: done,
  saveServer: done,
  rollbackServer: done,
  issueToken: async (slug, label) => ({
    name: `ontology-${slug}-${label}`,
    secret: `agent-${Math.random().toString(36).slice(2, 6)}`,
  }),
  revokeKey: done,
  attachAgent: done,
  listTools: async () => demo.demoPlayTools,
  runTool: async (_slug, tool) => {
    await sleep(900);
    return demo.demoRun(tool);
  },
  setSwitch: done,
  exportModel: done,
  connectServer: done,
};

/** Every write a page can make. */
export const useActions: () => Actions = demoMode ? () => demoActions : useLiveActions;
