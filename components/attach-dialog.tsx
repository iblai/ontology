"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/query-state";
import { useActions, useAgentOptions, useServers } from "@/lib/data";
import type { AgentOption, ServerRow } from "@/lib/view/types";

const select =
  "h-9 w-full rounded-md border border-[var(--border-color)] bg-[#f9fafb] px-2.5 text-sm";

/** Gives an ibl.ai agent a key for a server's toolsets; without `slug` it asks for the server. */
export function AttachDialog({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug?: string;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-gray-900">
            Attach a Server to an Agent
          </DialogTitle>
          <DialogDescription className="text-[13px] text-gray-600">
            The agent gets its own ibl.ai API key, limited to the toolsets you tick, and the server
            is registered for it.
          </DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so the reads wait for it and each opening starts fresh */}
        <AttachForm slug={slug} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AttachForm({ slug, onDone }: { slug?: string; onDone: () => void }) {
  const agents = useAgentOptions();
  const servers = useServers();
  return (
    <QueryState query={agents}>
      {(agentList) => (
        <QueryState query={servers}>
          {(serverList) => (
            <Fields agents={agentList} servers={serverList} slug={slug} onDone={onDone} />
          )}
        </QueryState>
      )}
    </QueryState>
  );
}

function Fields({
  agents,
  servers,
  slug,
  onDone,
}: {
  agents: AgentOption[];
  servers: ServerRow[];
  slug?: string;
  onDone: () => void;
}) {
  const actions = useActions();
  const [agentId, setAgentId] = useState("");
  const [chosen, setChosen] = useState(slug ?? "");
  const [off, setOff] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = servers.filter((s) => s.enabled);
  const agent = agents.find((a) => a.id === agentId);
  const server = servers.find((s) => s.slug === chosen);
  const toolsets = server ? server.toolsetNames.filter((n) => !off.includes(n)) : [];

  const attach = () => {
    if (!agent || !server) return;
    setBusy(true);
    setError(null);
    actions
      .attachAgent({ agentId: agent.id, agentName: agent.name, slug: server.slug, toolsets })
      .then(onDone, (e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="grid gap-3.5">
      <div>
        <Label htmlFor="attach-agent" className="mb-1.5 text-gray-700">
          Agent
        </Label>
        <select
          id="attach-agent"
          className={select}
          value={agentId}
          disabled={busy}
          onChange={(e) => setAgentId(e.target.value)}
        >
          <option value="" disabled>
            {agents.length ? "Choose an agent…" : "No agents on this platform"}
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {!slug && (
        <div>
          <Label htmlFor="attach-server" className="mb-1.5 text-gray-700">
            Server
          </Label>
          <select
            id="attach-server"
            className={select}
            value={chosen}
            disabled={busy}
            onChange={(e) => {
              setChosen(e.target.value);
              setOff([]);
            }}
          >
            <option value="" disabled>
              {enabled.length ? "Choose a server…" : "No enabled servers"}
            </option>
            {enabled.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.slug}
              </option>
            ))}
          </select>
        </div>
      )}
      {slug && !server && <p className="text-xs text-red-600">No server named {slug}.</p>}
      {server && (
        <div>
          <Label className="mb-1.5 text-gray-700">Toolsets</Label>
          {server.toolsetNames.length === 0 && (
            <p className="text-xs text-gray-600">This server has no toolsets.</p>
          )}
          {server.toolsetNames.map((n) => (
            <label
              key={n}
              className="mb-1.5 flex items-center gap-2.5 rounded-md border border-[var(--border-color)] p-2.5 text-sm"
            >
              <Checkbox
                checked={!off.includes(n)}
                disabled={busy}
                onCheckedChange={(v) => setOff((o) => (v ? o.filter((x) => x !== n) : [...o, n]))}
              />{" "}
              <code className="mono">{n}</code>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          className="ibl-button-primary"
          disabled={busy || !agent || !server || toolsets.length === 0}
          onClick={attach}
        >
          Attach
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
