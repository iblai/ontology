// RTK Query over /api/host: the host's own routes, and the engine calls the browser makes
// through /api/host/ao. Every call carries the signed-in user's `Token <dm_token>` and platform.

import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
} from "@reduxjs/toolkit/query/react";
import type {
  AoAttributePatchResponse,
  AoColumnAttribute,
  AoColumnAttributePatch,
  AoData,
  AoPage,
  AoSemanticStatus,
  AoSqlAttribute,
  AoSqlAttributePatch,
  AoTableColumnsPage,
  AoTerm,
  AoTermDetail,
  AoTermPatch,
  AoToggle,
} from "@/lib/ao-types";
import type {
  HostApi,
  HostApiInput,
  HostEvent,
  HostGraph,
  HostPreview,
  HostServer,
  HostServerActivity,
  HostServerDetail,
  HostServerDraft,
  HostSetup,
  HostSetupDone,
  HostSpec,
  HostSystem,
  HostSystemInput,
  HostSystemTest,
  HostToolset,
} from "@/lib/host/types";
import { currentTenantKey } from "@/lib/iblai/tenant";
import { PLATFORM_HEADER } from "@/lib/platform";
import { relaying, SERVER_HEADER, storedServer } from "@/lib/server-address";
import { errorMessage } from "@/lib/view/result";

/** The engine's three switches, by the console's name. */
export const SWITCHES = {
  compilation: "semantic-compilation",
  pii: "pii-detection",
  probing: "distinct-value-probing",
} as const;
export type SwitchName = keyof typeof SWITCHES;

export type HostQueryError = { status: number | string; message: string };

/** `Token <dm_token>` from storage; null before sign-in or on the server. */
export function authorization(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("dm_token");
  return token ? `Token ${token}` : null;
}

/** What every host call carries: the Token, the platform it is signed in to and its server. */
export function hostHeaders(): Record<string, string> {
  const auth = authorization();
  const platform = currentTenantKey();
  const server = relaying() ? storedServer(platform) : null;
  return {
    ...(auth ? { Authorization: auth } : {}),
    ...(platform ? { [PLATFORM_HEADER]: platform } : {}),
    ...(server ? { [SERVER_HEADER]: server } : {}),
  };
}

const raw = fetchBaseQuery({
  baseUrl: "/api/host",
  prepareHeaders: (headers) => {
    for (const [name, value] of Object.entries(hostHeaders())) {
      // The setup calls name a server that is not stored yet.
      if (name === SERVER_HEADER && headers.has(name)) continue;
      headers.set(name, value);
    }
    return headers;
  },
});

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, HostQueryError> = async (
  args,
  api,
  extra,
) => {
  const r = await raw(args, api, extra);
  if (!r.error) return { data: r.data, meta: r.meta };
  const e = r.error;
  // A body that is not JSON keeps its real status as originalStatus.
  const status = "originalStatus" in e ? e.originalStatus : e.status;
  const statusText = r.meta?.response?.statusText || String(status);
  const data = "data" in e ? e.data : undefined;
  const message = "error" in e && !data ? e.error : errorMessage(data, statusText);
  return { error: { status, message } };
};

type SaveServer = { slug: string; draft: HostServerDraft; start: boolean };

const ao = (path: string) => `/ao${path}`;
const id = encodeURIComponent;

export const hostApi = createApi({
  reducerPath: "hostApi",
  baseQuery,
  tagTypes: [
    "Systems",
    "Apis",
    "Graph",
    "Toolsets",
    "Servers",
    "Server",
    "ServerActivity",
    "Activity",
    "Term",
    "Columns",
    "Switch",
    "Compile",
  ],
  endpoints: (b) => ({
    /* ---------- the host ---------- */
    getSystems: b.query<HostSystem[], void>({ query: () => "/systems", providesTags: ["Systems"] }),
    addSystem: b.mutation<HostSystem, HostSystemInput>({
      query: (body) => ({ url: "/systems", method: "POST", body }),
      invalidatesTags: ["Systems", "Graph", "Toolsets", "Switch", "Activity"],
    }),
    testSystem: b.mutation<HostSystemTest, HostSystemInput>({
      query: (body) => ({ url: "/systems/test", method: "POST", body }),
    }),
    getApis: b.query<HostApi[], void>({ query: () => "/apis", providesTags: ["Apis"] }),
    addApi: b.mutation<HostApi, HostApiInput>({
      query: (body) => ({ url: "/apis", method: "POST", body }),
      invalidatesTags: ["Apis", "Toolsets"],
    }),
    fetchSpec: b.mutation<HostSpec, { url: string; baseUrl: string; authHeader: string }>({
      query: (body) => ({ url: "/apis/spec", method: "POST", body }),
    }),
    getGraph: b.query<HostGraph, void>({ query: () => "/graph", providesTags: ["Graph"] }),
    getToolsets: b.query<HostToolset[], void>({
      query: () => "/toolsets",
      providesTags: ["Toolsets"],
    }),
    getServers: b.query<HostServer[], void>({ query: () => "/servers", providesTags: ["Servers"] }),
    previewServer: b.query<HostPreview, { slug: string; draft: HostServerDraft }>({
      query: (body) => ({ url: "/servers/preview", method: "POST", body }),
      providesTags: ["Toolsets"],
    }),
    // A missing server is data null, not an error.
    getServer: b.query<HostServerDetail | null, string>({
      async queryFn(slug, api, extra) {
        const r = await baseQuery(`/servers/${id(slug)}`, api, extra);
        if (r.error) return r.error.status === 404 ? { data: null } : { error: r.error };
        return { data: r.data as HostServerDetail };
      },
      providesTags: (_r, _e, slug) => [{ type: "Server", id: slug }],
    }),
    saveServer: b.mutation<HostServerDetail, SaveServer>({
      query: ({ slug, draft, start }) => ({
        url: `/servers/${id(slug)}`,
        method: "PUT",
        body: { draft, start },
      }),
      invalidatesTags: (_r, _e, { slug }) => [
        "Servers",
        "Activity",
        { type: "Server", id: slug },
        { type: "ServerActivity", id: slug },
      ],
    }),
    rollbackServer: b.mutation<HostServerDetail, string>({
      query: (slug) => ({ url: `/servers/${id(slug)}/rollback`, method: "POST" }),
      invalidatesTags: (_r, _e, slug) => [
        "Servers",
        "Activity",
        { type: "Server", id: slug },
        { type: "ServerActivity", id: slug },
      ],
    }),
    getServerActivity: b.query<HostServerActivity, string>({
      query: (slug) => `/servers/${id(slug)}/activity`,
      providesTags: (_r, _e, slug) => [{ type: "ServerActivity", id: slug }],
    }),
    // Calls per agent label on each of these servers, for the Agents list.
    getAgentCalls: b.query<Record<string, Record<string, number>>, string[]>({
      async queryFn(slugs, api, extra) {
        const out: Record<string, Record<string, number>> = {};
        for (const slug of slugs) {
          const r = await baseQuery(`/servers/${id(slug)}/activity`, api, extra);
          if (r.error) return { error: r.error };
          out[slug] = (r.data as HostServerActivity).byAgent;
        }
        return { data: out };
      },
      providesTags: (_r, _e, slugs) =>
        slugs.map((s) => ({ type: "ServerActivity" as const, id: s })),
    }),
    getActivity: b.query<HostEvent[], void>({
      query: () => "/activity",
      providesTags: ["Activity"],
    }),
    // Both name the server by its address: a server not connected yet.
    getSetup: b.query<HostSetup, string>({
      query: (server) => ({ url: "/setup", headers: { [SERVER_HEADER]: server } }),
    }),
    setUpServer: b.mutation<HostSetupDone, { server: string; code: string }>({
      query: ({ server, code }) => ({
        url: "/setup",
        method: "POST",
        body: { code },
        headers: { [SERVER_HEADER]: server },
      }),
    }),

    /* ---------- the engine, through /api/host/ao ---------- */
    getTerm: b.query<AoTermDetail, string>({
      query: (term) => ao(`/terms/${id(term)}`),
      transformResponse: (r: AoData<AoTermDetail>) => r.data,
      providesTags: (_r, _e, term) => [{ type: "Term", id: term }],
    }),
    getTermColumnAttributes: b.query<AoColumnAttribute[], string>({
      query: (term) => ao(`/terms/${id(term)}/column-attributes`),
      transformResponse: (r: AoPage<AoColumnAttribute>) => r.data,
      providesTags: (_r, _e, term) => [{ type: "Term", id: term }],
    }),
    getTermSqlAttributes: b.query<AoSqlAttribute[], string>({
      query: (term) => ao(`/terms/${id(term)}/sql-attributes`),
      transformResponse: (r: AoPage<AoSqlAttribute>) => r.data,
      providesTags: (_r, _e, term) => [{ type: "Term", id: term }],
    }),
    getTableColumns: b.query<AoTableColumnsPage, string>({
      query: (table) => ao(`/columns/${id(table)}`),
      providesTags: (_r, _e, table) => [{ type: "Columns", id: table }],
    }),
    getSwitch: b.query<AoToggle, SwitchName>({
      query: (name) => ao(`/configurations/${SWITCHES[name]}`),
      providesTags: (_r, _e, name) => [{ type: "Switch", id: name }],
    }),
    setSwitch: b.mutation<AoToggle, { name: SwitchName; on: boolean }>({
      query: ({ name, on }) => ({
        url: ao(`/configurations/${SWITCHES[name]}`),
        method: "PUT",
        body: { enabled: on },
      }),
      invalidatesTags: (_r, _e, { name }) => [{ type: "Switch", id: name }, "Compile", "Graph"],
    }),
    getCompileStatus: b.query<AoSemanticStatus, void>({
      query: () => ao("/semantic-compilation/status"),
      providesTags: ["Compile"],
    }),
    patchTerm: b.mutation<AoTerm, { term: string; patch: AoTermPatch }>({
      query: ({ term, patch }) => ({ url: ao(`/terms/${id(term)}`), method: "PATCH", body: patch }),
      transformResponse: (r: AoData<AoTerm>) => r.data,
      invalidatesTags: (_r, _e, { term }) => [
        { type: "Term", id: term },
        "Graph",
        "Toolsets",
        "Activity",
      ],
    }),
    patchColumnAttribute: b.mutation<
      AoAttributePatchResponse<AoColumnAttribute>,
      { term: string; attr: string; patch: AoColumnAttributePatch }
    >({
      query: ({ term, attr, patch }) => ({
        url: ao(`/terms/${id(term)}/column-attributes/${id(attr)}`),
        method: "PATCH",
        body: patch,
      }),
      invalidatesTags: (_r, _e, { term }) => [{ type: "Term", id: term }, "Graph", "Toolsets"],
    }),
    patchSqlAttribute: b.mutation<
      AoAttributePatchResponse<AoSqlAttribute>,
      { attr: string; patch: AoSqlAttributePatch }
    >({
      query: ({ attr, patch }) => ({
        url: ao(`/sql-attributes/${id(attr)}`),
        method: "PATCH",
        body: patch,
      }),
      // The term is not named in the route, so every term's detail fetches again.
      invalidatesTags: ["Term", "Graph", "Toolsets"],
    }),
  }),
});
