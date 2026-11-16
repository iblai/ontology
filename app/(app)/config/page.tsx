"use client";

import { useState } from "react";
import { both, RunError, StubPage, useRun, type StubRow } from "@/components/shell/stub-page";
import { Button } from "@/components/ui/button";
import { useActions, useEngine, useServers } from "@/lib/data";
import { isDemo } from "@/lib/iblai/session";
import { currentTenantKey } from "@/lib/iblai/tenant";
import { forgetServer, hostOf, relaying, storedServer } from "@/lib/server-address";
import type { EngineView } from "@/lib/view/types";

// Forgetting it brings back the connect card.
function changeServer() {
  forgetServer(currentTenantKey());
  window.location.reload();
}

function ServerHost({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-600">
      Server <span className="mono">{hostOf(address)}</span>
      <Button size="xs" variant="outline" onClick={changeServer}>
        Change
      </Button>
    </span>
  );
}

function ModelExport({ engine }: { engine: EngineView }) {
  const actions = useActions();
  const { busy, error, run } = useRun();
  const counts = `${engine.terms} terms · ${engine.relationships} relationships ·`;
  if (isDemo()) return `${counts} download from the engine`;
  return (
    <span className="inline-block">
      <span className="inline-flex items-center gap-2">
        {counts}
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => actions.exportModel())}
        >
          Download
        </Button>
      </span>
      <RunError error={error} />
    </span>
  );
}

export default function Page() {
  const [server] = useState(() =>
    relaying() && !isDemo() ? storedServer(currentTenantKey()) : null,
  );
  return (
    <StubPage
      title="Config"
      description="Files the console writes to the host. Edits happen in the console; these are the artifacts the runtime reads."
      // Beside the title, not among the rows: within reach when the server does not answer.
      actions={server ? <ServerHost address={server} /> : undefined}
      query={both(useServers(), useEngine())}
      rows={([servers, engine]) => [
        ...servers.flatMap((s): StubRow[] => [
          [
            `servers/${s.slug}/tools.yaml`,
            `rev ${s.revision} · ${(s.bytes / 1024).toFixed(1)} KB · ${s.tools} tools · ${s.toolsets} toolsets`,
          ],
          [
            `servers/${s.slug}/flags`,
            `--allowed-origins ${s.origins.length} · --allowed-hosts ${s.hosts.join(",") || "—"} · --port ${s.port ?? "—"}`,
          ],
        ]),
        ["semantic model export", <ModelExport key="export" engine={engine} />],
      ]}
    />
  );
}
