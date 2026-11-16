"use client";

// Everything the console reads from and writes to ibl.ai, through the SDK's own endpoints and
// with the signed-in admin's session. Nothing here touches the host. Ported from the old
// product's platform/agents.py and identity/role_source.py.

import { useEffect, useState } from "react";
import type { RbacPolicy, RbacRole } from "@iblai/iblai-api";
import {
  apiKeysApiSlice,
  coreApiSlice,
  mcpApiSlice,
  mentorApiSlice,
  mentorCustomApiSlice,
  unwrapApiTokenList,
  useGetApiKeysQuery,
  useGetMCPServersQuery,
  useGetMentorsQuery,
  useGetRbacPoliciesQuery,
} from "@iblai/iblai-js/data-layer";
import { getUserName } from "@iblai/iblai-js/web-utils";
import {
  failed,
  holds,
  keyNameFor,
  keyRows,
  matchRegistration,
  readToolsets,
  withServer,
  withUndo,
} from "@/lib/ibl-flows-pure";
import { currentTenantKey } from "@/lib/iblai/tenant";
import { ALL_VERBS, NAME, POLICY_PREFIX, VERBS, toolsetResource } from "@/lib/ontology-rbac";
import type { AgentOption, AgentRow, KeyRow, Query, RoleRow } from "@/lib/view/types";
import { iblaiStore } from "@/store/iblai-store";

/** An agent's connection, as ibl.ai holds it. Call counts come from the host. */
export type IblAgent = Omit<AgentRow, "calls"> & {
  label: string; // the ?agent= value its connection's URL carries
  connectedAt: string | null; // ISO time the connection was registered
};

const dispatch = iblaiStore.dispatch;
const fresh = { forceRefetch: true } as const;
const NOT_ASKED = "There is no platform or signed-in user here, so ibl.ai was not asked.";

function who() {
  const org = currentTenantKey();
  const userId = getUserName() ?? "";
  return { org, userId, skip: !org || !userId };
}

function signedIn() {
  const { org, userId, skip } = who();
  if (skip) throw new Error(NOT_ASKED);
  return { org, userId };
}

/** A query's result, read once outside React. */
async function read<T>(request: { unwrap(): Promise<T>; unsubscribe(): void }): Promise<T> {
  try {
    return await request.unwrap();
  } finally {
    request.unsubscribe();
  }
}

/** Runs one call; its failure names the step. */
async function at<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new Error(failed(step, err));
  }
}

async function everyPage<T>(
  load: (page: number) => Promise<{ results: T[]; next?: string | null }>,
): Promise<T[]> {
  const found: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await load(page);
    found.push(...body.results);
    if (!body.next) return found;
  }
  throw new Error("The platform has more than 2,000 matches; narrow them there first.");
}

/** A hook's Query; a skipped one is loading on the server and refused in the browser. */
function shape<T>(
  skip: boolean,
  step: string,
  data: T | undefined,
  q: { isLoading: boolean; error?: unknown; refetch: () => unknown },
): Query<T> {
  if (skip) {
    const server = typeof window === "undefined";
    return {
      data: undefined,
      isLoading: server,
      error: server ? null : NOT_ASKED,
      refetch() {},
    };
  }
  return {
    data,
    isLoading: q.isLoading,
    error: q.error ? failed(step, q.error) : null,
    refetch: () => void q.refetch(),
  };
}

/* ---------- reads ---------- */

function roleRow(policy: RbacPolicy): RoleRow {
  const { toolsets, all } = readToolsets(policy.resources ?? []);
  // The DM's policy groups carry no members today; a count shows if it ever sends them.
  const members = (g: object) => {
    const users = (g as { users?: unknown }).users;
    return Array.isArray(users) ? users.length : null;
  };
  return {
    name: policy.name ?? "",
    toolsets,
    all,
    holders: [
      ...(policy.groups ?? []).map((g) => ({
        label: g.name || g.unique_id,
        kind: "group" as const,
        users: members(g),
      })),
      ...(policy.users ?? []).map((u) => ({
        label: u.username || u.email || `user ${u.id}`,
        kind: "user" as const,
        users: null,
      })),
    ],
  };
}

/** Policies named "Ontology: …" on this platform, with their toolsets and holders. */
export function useRoleRows(): Query<RoleRow[]> {
  const { org, skip } = who();
  // ponytail: the first 100 ontology policies (one per toolset); page when a platform has more.
  const q = useGetRbacPoliciesQuery(
    {
      platformKey: org,
      name: POLICY_PREFIX.trim(),
      includeUsers: true,
      includeGroups: true,
      pageSize: 100,
    },
    { skip },
  );
  const data = q.data?.results.filter((p) => p.name?.startsWith(POLICY_PREFIX)).map(roleRow);
  return shape(skip, "Reading the platform’s ontology policies", data, q);
}

/** API keys of this platform that carry at least one ontology policy. */
export function useKeyRows(): Query<KeyRow[]> {
  const { org, skip } = who();
  const list = useGetApiKeysQuery({ platformKey: org }, { skip });
  const [round, setRound] = useState(0);
  const [details, setDetails] = useState<{ of: unknown; rows?: KeyRow[]; error?: string }>({
    of: null,
  });

  // The list never carries a key's policies, so each key's detail is read.
  useEffect(() => {
    if (!list.data) return;
    const of = list.data;
    let live = true;
    const asked = unwrapApiTokenList(list.data).tokens.map((t) =>
      dispatch(
        apiKeysApiSlice.endpoints.getApiKey.initiate(
          // unique_id addresses any key; a name with a space has no route of its own.
          { name: (t as { unique_id?: string }).unique_id ?? t.name, platformKey: org },
          fresh,
        ),
      ),
    );
    Promise.all(asked.map((a) => a.unwrap()))
      .then((keys) => {
        if (live) setDetails({ of, rows: keyRows(keys) });
      })
      .catch((err) => {
        if (live) setDetails({ of, error: failed("Reading the keys’ policies", err) });
      });
    return () => {
      live = false;
      for (const a of asked) a.unsubscribe();
    };
  }, [list.data, org, round]);

  const current = details.of === list.data ? details : null;
  const base = shape(skip, "Reading the platform’s API keys", current?.rows, list);
  if (skip || base.error) return base;
  return {
    data: current?.rows,
    isLoading: list.isLoading || (!!list.data && !current),
    error: current?.error ?? null,
    refetch: () => {
      base.refetch();
      setRound((n) => n + 1);
    },
  };
}

// ponytail: the first 100 agents; search by name past that.
const mentorArgs = (org: string, username: string) => ({ org, username, limit: 100, offset: 0 });

/** The platform's agents, by name. */
export function useAgentOptions(): Query<AgentOption[]> {
  const { org, userId, skip } = who();
  const q = useGetMentorsQuery(mentorArgs(org, userId), { skip });
  const data = q.data?.results
    .filter((m) => m.unique_id)
    .map((m) => ({ id: m.unique_id as string, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return shape(skip, "Reading the platform’s agents", data, q);
}

/** Agents with an MCP server registered at `<appOrigin>/<this platform>/<slug>/mcp`. */
export function useAgentRows(appOrigin: string): Query<IblAgent[]> {
  const { org, userId, skip } = who();
  // ponytail: the first 100 registrations on the platform; page when a platform has more.
  const servers = useGetMCPServersQuery({ org, userId, pageSize: 100 }, { skip });
  const agents = useAgentOptions();
  const names = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
  const data =
    servers.data && agents.data
      ? servers.data.results.flatMap((s): IblAgent[] => {
          const found = matchRegistration(s.url, appOrigin, org);
          if (!found) return [];
          return [
            {
              id: String(s.id),
              name: (s.mentor && names.get(s.mentor)) || "—",
              kind: "ibl.ai agent",
              server: found.slug,
              label: found.label,
              authScope: s.auth_scope || "—",
              // The DM masks credentials but still sends them when the registration has its own.
              authType: s.credentials ? "token" : s.auth_type || "—",
              status: s.is_enabled === false ? "disabled" : "enabled",
              connectedAt: s.created_at || null,
            },
          ];
        })
      : undefined;
  const q = shape(skip, "Reading the platform’s MCP servers", data, servers);
  return {
    ...q,
    isLoading: q.isLoading || agents.isLoading,
    error: q.error ?? agents.error,
    refetch: () => {
      q.refetch();
      agents.refetch();
    },
  };
}

/* ---------- writes ---------- */

/** The policy "Ontology: <toolset>" bound to the role, granting the toolset; returns its id. */
async function ensurePolicy(org: string, toolset: string, roleId: number): Promise<number> {
  const wanted = POLICY_PREFIX + toolset;
  const resource = toolsetResource(toolset);
  const listed = await at("Reading the platform’s policies", () =>
    everyPage((page) =>
      read(
        dispatch(
          coreApiSlice.endpoints.getRbacPolicies.initiate(
            {
              platformKey: org,
              name: wanted,
              includeUsers: false,
              includeGroups: false,
              page,
              pageSize: 100,
            },
            fresh,
          ),
        ),
      ),
    ),
  );
  const foreign = listed.find((p) => p.platform?.key && p.platform.key !== org);
  if (foreign) {
    throw new Error(
      `The platform answered with the policies of “${foreign.platform.key}”: ` +
        `this sign-in is not one of “${org}”.`,
    );
  }
  const named = listed.filter((p) => p.name === wanted);
  const policy = named.find((p) => p.role?.id === roleId);
  if (named.length && !policy) {
    throw new Error(
      `The platform’s policy “${wanted}” is bound to the role “${named[0].role?.name}”: ` +
        "rename or delete it there.",
    );
  }
  // The DM takes these four fields; the generated type is the full read shape.
  const body = (resources: string[]) =>
    ({ platform_key: org, name: wanted, role_id: roleId, resources }) as unknown as RbacPolicy;
  if (!policy) {
    const made = await at(`Creating the policy “${wanted}”`, () =>
      dispatch(
        coreApiSlice.endpoints.createRbacPolicy.initiate({ requestBody: body([resource]) }),
      ).unwrap(),
    );
    return made.id;
  }
  const has = (policy.resources ?? []).some((r) => (r.endsWith("/") ? r : `${r}/`) === resource);
  if (!has) {
    await at(`Adding ${resource} to the policy “${wanted}”`, () =>
      dispatch(
        coreApiSlice.endpoints.updateRbacPolicy.initiate({
          id: policy.id,
          requestBody: body([...(policy.resources ?? []), resource]),
        }),
      ).unwrap(),
    );
  }
  return policy.id;
}

/** The platform role named after the toolset, holding Ontology/*, and its one policy. */
async function ensureRole(org: string, toolset: string): Promise<number> {
  const roles = await at("Reading the platform’s roles", () =>
    everyPage((page) =>
      read(
        dispatch(
          coreApiSlice.endpoints.getRbacRoles.initiate(
            { platformKey: org, name: toolset, page, pageSize: 100 },
            fresh,
          ),
        ),
      ),
    ),
  );
  // The list carries the global roles too; only this platform's own counts.
  let role = roles.find((r) => r.name === toolset && r.platform?.key === org);
  const created = !role;
  if (!role) {
    const requestBody = { platform_key: org, name: toolset, actions: [ALL_VERBS] };
    role = await at(`Creating the role “${toolset}”`, () =>
      dispatch(
        coreApiSlice.endpoints.createRbacRole.initiate({
          requestBody: requestBody as unknown as RbacRole,
        }),
      ).unwrap(),
    );
  } else if (role.is_internal || !holds(role.actions, VERBS.toolsets)) {
    // The console never changes a role's verbs.
    throw new Error(
      `The platform’s role “${toolset}” does not hold ${VERBS.toolsets}: ` +
        "add it to that role on the platform, or name the toolset differently.",
    );
  }
  const roleId = role.id;
  try {
    return await ensurePolicy(org, toolset, roleId);
  } catch (err) {
    if (!created) throw err;
    // A new role that grants nothing is not left behind.
    try {
      await dispatch(
        coreApiSlice.endpoints.deleteRbacRole.initiate({ id: roleId, platformKey: org }),
      ).unwrap();
    } catch (failure) {
      throw new Error(
        `${(err as Error).message} ${failed(`Removing the new role “${toolset}”`, failure)}`,
      );
    }
    throw err;
  }
}

/**
 * Makes sure each toolset has its role (a platform role named after it that holds Ontology/*)
 * and that role's one policy ("Ontology: <toolset>", granting the toolset's resource).
 * Returns the policies' ids in the toolsets' order.
 */
export async function ensureRoles(toolsets: string[]): Promise<number[]> {
  const refused = toolsets.filter((t) => !NAME.test(t));
  if (refused.length) {
    throw new Error(
      `${refused.map((t) => `“${t}”`).join(", ")} cannot be a role on ibl.ai: ` +
        "a name holds letters, digits, - and _ only.",
    );
  }
  const { org } = signedIn();
  const ids: number[] = [];
  for (const toolset of toolsets) ids.push(await ensureRole(org, toolset));
  return ids;
}

/** Creates an API key limited to the toolsets' policies. The secret is returned once. */
export async function issueKey(
  name: string,
  toolsets: string[],
): Promise<{ name: string; secret: string }> {
  // One key is addressed by its name in a URL segment, so the name keeps to the same rule.
  if (!NAME.test(name)) {
    throw new Error(`“${name}” cannot name a key: letters, digits, - and _ only.`);
  }
  if (!toolsets.length) {
    throw new Error("Choose at least one toolset: a key limited to none reaches nothing.");
  }
  const policies = await ensureRoles(toolsets);
  const made = await at(`Creating the API key “${name}”`, () =>
    dispatch(
      apiKeysApiSlice.endpoints.createApiKey.initiate({
        requestBody: { name, mode: "token_policies", policies_to_add: policies },
      }),
    ).unwrap(),
  );
  // The DM answers the secret once, as `key` (PlatformApiKeySerializer).
  if (!made.key) {
    throw new Error(
      `The platform created the key “${name}” but did not return its secret: revoke it and ` +
        "issue another.",
    );
  }
  return { name: made.name || name, secret: made.key };
}

/** Deletes an API key by its id (its name on ibl.ai). */
export async function revokeKey(id: string): Promise<void> {
  const { org } = signedIn();
  await at(`Revoking the API key “${id}”`, () =>
    dispatch(
      apiKeysApiSlice.endpoints.deleteApiKey.initiate({ name: id, platformKey: org }),
    ).unwrap(),
  );
}

// The SDK's types resolve these three mutations to `never`; this is the shape they have.
type Sent<A, R> = {
  initiate(arg: A): (dispatch: unknown, getState: unknown) => { unwrap(): Promise<R> };
};
type OfUser = { org: string; userId: string };
const createServer = mcpApiSlice.endpoints.createMCPServer as unknown as Sent<
  OfUser & { body: Record<string, unknown> },
  { id: number }
>;
const deleteServer = mcpApiSlice.endpoints.deleteMCPServer as unknown as Sent<
  OfUser & { id: number },
  void
>;
const editSettings = mentorCustomApiSlice.endpoints.editMentorJson as unknown as Sent<
  OfUser & { mentorId: string; requestBody: Record<string, unknown> },
  unknown
>;

/**
 * Connects an agent to a server: a key limited to the toolsets, an MCP server registered for
 * the agent with that key, and the agent's settings told to use it. A step that fails undoes
 * the steps before it, in reverse, and the error says what was undone.
 */
export async function attachAgent(input: {
  agentId: string;
  agentName: string;
  slug: string;
  url: string; // the server's endpoint, with ?agent=<label>
  toolsets: string[];
}): Promise<void> {
  const { org, userId } = signedIn();
  const { agentId, agentName, slug, url, toolsets } = input;
  const description = `The ontology gateway’s ${slug} server, limited to ${toolsets.join(", ")}.`;
  let secret = "";
  let serverId = 0;
  let settings: unknown;
  await withUndo([
    {
      step: "Issuing the agent’s API key",
      run: async () => {
        const key = await issueKey(keyNameFor(slug, agentName), toolsets);
        secret = key.secret;
        return { what: "the API key", run: () => revokeKey(key.name) };
      },
    },
    {
      step: "Registering the MCP server for the agent",
      run: async () => {
        const server = await dispatch(
          createServer.initiate({
            org,
            userId,
            body: {
              name: `Ontology: ${slug}`,
              description,
              url,
              transport: "streamable_http",
              // Sent as it is on every call: no per-user connection to set up.
              auth_type: "none",
              auth_scope: "platform",
              is_enabled: true,
              credentials: `Api-Token ${secret}`,
              mentor: agentId,
            },
          }),
        ).unwrap();
        serverId = server.id;
        return {
          what: "the MCP server",
          run: () => dispatch(deleteServer.initiate({ org, userId, id: server.id })).unwrap(),
        };
      },
    },
    {
      step: "Reading the agent’s settings",
      run: async () => {
        // The generated args omit userId, but the settings URL is built with it.
        const args = { mentor: agentId, org, userId };
        settings = await read(
          dispatch(mentorApiSlice.endpoints.getMentorSettings.initiate(args, fresh)),
        );
      },
    },
    {
      step: "Telling the agent to use the server",
      run: async () => {
        // JSON, not the multipart editMentor, which drops an empty list.
        await dispatch(
          editSettings.initiate({
            mentorId: agentId,
            org,
            userId,
            requestBody: withServer(settings, serverId),
          }),
        ).unwrap();
      },
    },
  ]);
}
