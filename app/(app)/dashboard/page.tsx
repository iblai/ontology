"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, Pill, Stat, Tag } from "@/components/shell/page-header";
import {
  useActivity,
  useAgents,
  useOntology,
  useServers,
  useSystems,
  useToolsets,
} from "@/lib/data";
import { useSession } from "@/lib/iblai/session";

const flow = [
  ["Connect", "databases · APIs"],
  ["Dissect", "terms · joins · metrics"],
  ["Model", "objects · links · actions"],
  ["Expose", "toolsets · auth · origins"],
  ["Serve", "/mcp endpoint"],
];

export default function DashboardPage() {
  const { tenantName } = useSession();
  const systems = useSystems();
  const ontology = useOntology();
  const toolsets = useToolsets();
  const servers = useServers();
  const agents = useAgents();
  const activity = useActivity();

  const types = ontology.data?.objectTypes;
  const certified = types?.filter((t) => t.status === "certified").length;
  const tools = toolsets.data?.filter((t) => t.defaultOn).reduce((n, t) => n + t.tools.length, 0);
  const calls = servers.data?.reduce((n, s) => n + s.calls24h, 0);
  const live = servers.data?.filter((s) => s.enabled);

  // One line per distinct failure; its Retry refetches every read that failed with it.
  const failures = new Map<string, (() => void)[]>();
  for (const q of [systems, ontology, toolsets, servers, agents, activity]) {
    if (q.error) failures.set(q.error, [...(failures.get(q.error) ?? []), q.refetch]);
  }

  return (
    <>
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div>
          <div className="eyebrow">{tenantName} · Ontology</div>
          <h1 className="mt-1.5 text-[26px] leading-[1.15] font-semibold tracking-tight text-balance text-gray-900">
            One ontology of the institution.
            <br />
            Every system, one set of definitions, available to every agent.
          </h1>
          <p className="my-3 max-w-[54ch] text-[13.5px] text-gray-600">
            Connect the systems you already run. The console reads their schemas, infers the
            business terms and relationships inside them, lets you certify the result, and publishes
            it as MCP servers your ibl.ai agents and any MCP client can call. Data stays on your
            host.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" className="ibl-button-primary" render={<Link href="/systems" />}>
              Connect a System
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/map" />}>
              Open the Map
            </Button>
          </div>
          <div
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
            aria-label="Pipeline"
          >
            {flow.map(([b, s]) => (
              <div
                key={b}
                className="rounded-lg border border-[rgba(0,88,204,.35)] bg-[#eef6fc] px-2.5 py-2"
              >
                <b className="block text-[13px] font-semibold text-gray-900">{b}</b>
                <small className="block text-[11.5px] break-words text-gray-600">{s}</small>
              </div>
            ))}
          </div>
        </div>
        <Card soft className="flex flex-col gap-3">
          <div className="eyebrow">Right now</div>
          {[...failures].map(([message, retries]) => (
            <div key={message} className="text-[12.5px] break-words text-gray-500">
              {message}{" "}
              <button
                type="button"
                className="underline hover:text-gray-700"
                onClick={() => retries.forEach((r) => r())}
              >
                Retry
              </button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <Stat value={systems.data?.systems.length ?? "—"} label="systems connected" />
            <Stat
              value={types ? `${certified} / ${types.length}` : "—"}
              label="object types certified"
            />
            <Stat value={tools ?? "—"} label="tools published" />
            <Stat value={calls?.toLocaleString() ?? "—"} label="agent tool calls · 24h" />
          </div>
          <div className="eyebrow mt-1">Activity</div>
          <div className="grid gap-2 text-[13px]">
            {activity.data?.length === 0 && <span className="text-gray-400">Nothing yet.</span>}
            {activity.data?.map((a, i) => (
              <div key={`${i}-${a.text}`} className="flex flex-wrap items-baseline gap-2">
                <Tag tone={a.tone}>{a.tag}</Tag>
                <span className="text-gray-700">{a.text}</span>
                <span className="text-gray-400">· {a.when}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">MCP servers</h2>
        <Button size="sm" variant="outline" render={<Link href="/mcp/new" />}>
          + New MCP Server
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {servers.data?.map((s) => (
          <Link
            key={s.slug}
            href={`/mcp/${s.slug}`}
            className="rounded-[10px] border border-[var(--border-color)] bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="mono truncate text-sm font-semibold text-gray-900">{s.slug}</h3>
              {s.enabled ? (
                <Pill tone="green" dot>
                  enabled · rev {s.revision}
                </Pill>
              ) : (
                <Pill tone="amber" dot>
                  draft
                </Pill>
              )}
            </div>
            <div className="mono mt-1 truncate text-[12px] text-gray-600">
              {new URL(s.url).pathname}
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              {[
                [s.toolsets, "toolsets"],
                [s.tools, "tools"],
                [s.agents, "agents"],
              ].map(([v, l]) => (
                <div key={l as string} className="rounded-md bg-[#fafbfc] px-2.5 py-2">
                  <b className="block text-lg font-semibold text-gray-900 tabular-nums">{v}</b>
                  <small className="text-[11px] text-gray-600">{l}</small>
                </div>
              ))}
            </div>
          </Link>
        ))}
        <Link
          href="/agents"
          className="rounded-[10px] border border-dashed border-gray-300 p-4 text-sm text-gray-600 hover:border-gray-400"
        >
          <b className="block text-gray-900">{agents.data?.length ?? "—"} agents attached</b>
          <span className="text-[12.5px]">
            across {live?.length ?? "—"} enabled servers · manage in Agents
          </span>
        </Link>
      </div>
    </>
  );
}
