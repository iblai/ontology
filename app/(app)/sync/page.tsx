"use client";

import { both, RunError, StubPage, useRun } from "@/components/shell/stub-page";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useActions, useEngine, useServers } from "@/lib/data";
import type { ServerRow } from "@/lib/view/types";

const SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  mo: 2592000,
  y: 31536000,
};

// ponytail: reads deployedAgo's "12m" / "6d" form; any other form counts as never deployed
function age(ago: string): number {
  const m = /^(\d+)\s*(mo|[smhdwy])/.exec(ago);
  return m ? Number(m[1]) * SECONDS[m[2]] : Infinity;
}

function lastReload(servers: ServerRow[]): string {
  const last = servers.reduce<ServerRow | undefined>(
    (best, s) =>
      s.enabled && age(s.deployedAgo) < (best ? age(best.deployedAgo) : Infinity) ? s : best,
    undefined,
  );
  return last
    ? `automatic · last reload ${last.deployedAgo} ago (${last.slug} rev ${last.revision})`
    : "automatic";
}

function EngineSwitch({
  name,
  label,
  on,
  after = "",
}: {
  name: "compilation" | "pii" | "probing";
  label: string;
  on: boolean;
  after?: string;
}) {
  const actions = useActions();
  const { busy, error, run } = useRun();
  return (
    <span className="inline-block">
      <span className="inline-flex items-center gap-2">
        <Switch
          size="sm"
          checked={on}
          disabled={busy}
          aria-label={label}
          onCheckedChange={(v: boolean) => void run(() => actions.setSwitch(name, v))}
        />
        {`${on ? "on" : "off"}${after}`}
      </span>
      <RunError error={error} />
    </span>
  );
}

export default function Page() {
  const actions = useActions();
  const compile = useRun();
  return (
    <StubPage
      title="Compilation"
      description="The engine's ingest and compile status for this host, and the switches that control it."
      actions={
        <span className="flex flex-col items-end">
          <Button
            size="lg"
            variant="outline"
            disabled={compile.busy}
            onClick={() => void compile.run(() => actions.compile())}
          >
            Run now
          </Button>
          <RunError error={compile.error} />
        </span>
      }
      query={both(useEngine(), useServers())}
      rows={([e, servers]) => [
        [
          "Compilation",
          `${e.running ? "running" : "idle"} · last success ${e.lastSuccess ?? "—"} · last failure ${e.lastFailure ?? "—"}`,
        ],
        [
          "Scheduled compilation",
          <EngineSwitch
            key="compilation"
            name="compilation"
            label="Scheduled compilation"
            on={e.switches.compilation}
            after=" · after each ingest"
          />,
        ],
        [
          "PII detection",
          <EngineSwitch key="pii" name="pii" label="PII detection" on={e.switches.pii} />,
        ],
        [
          "Distinct-value probing",
          <EngineSwitch
            key="probing"
            name="probing"
            label="Distinct-value probing"
            on={e.switches.probing}
          />,
        ],
        ["SQL query timeout", e.timeout ?? "—"],
        ["Server config reload", lastReload(servers)],
      ]}
    />
  );
}
