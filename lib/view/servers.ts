import type { HostEvent, HostServer, HostServerActivity } from "@/lib/host/types";
import type { ActivityRow, ServerActivityView, ServerRow, Tone } from "@/lib/view/types";
import { ago, clock } from "./time";

/** A server as the lists show it; `url` is its endpoint, `agents` the ibl.ai agents on it. */
export function serverRow(s: HostServer, url: string, agents: number, now = Date.now()): ServerRow {
  return {
    slug: s.slug,
    url,
    revision: s.revision,
    enabled: s.enabled,
    toolsets: s.toolsets,
    tools: s.tools,
    calls24h: s.calls24h,
    agents,
    top: s.top ?? "—",
    deployedAgo: ago(s.deployedAt, now),
    toolsetNames: s.draft.toolsets,
    origins: s.draft.origins,
    hosts: s.draft.hosts,
    auth: s.draft.auth,
    bytes: s.bytes,
    port: s.port,
  };
}

type FeedItem = { tag: string; tone: Tone; text: string; at: string };

/** The dashboard's feed: deploys and the like, the last compile, agent connections; newest first. */
export function feedRows(
  events: HostEvent[],
  compile: { at: string | null; terms: number },
  agents: { name: string; server: string; connectedAt: string | null }[],
  now = Date.now(),
): ActivityRow[] {
  const items: FeedItem[] = events.map(({ tag, tone, text, at }) => ({ tag, tone, text, at }));
  if (compile.at)
    items.push({
      tag: "compile",
      tone: "gray",
      text: `compiled · ${compile.terms} terms`,
      at: compile.at,
    });
  for (const a of agents)
    if (a.connectedAt)
      items.push({
        tag: "agent",
        tone: "gray",
        text: `${a.name} connected to ${a.server}`,
        at: a.connectedAt,
      });
  return items
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .map(({ tag, tone, text, at }) => ({ tag, tone, text, when: ago(at, now) }));
}

export function activityView(a: HostServerActivity): ServerActivityView {
  return {
    calls: a.calls.map((c) => ({
      t: clock(c.at),
      tool: c.tool,
      agent: c.agent,
      user: c.user,
      session: c.session,
      status: c.status,
    })),
    log: a.log,
    spark: a.spark,
  };
}
