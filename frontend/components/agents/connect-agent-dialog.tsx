"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { Agent, McpToolset, Role } from "@/lib/ontology/types";
import { useRoleLabel } from "@/lib/ontology/use-role-label";
import { Field } from "@/components/console/form-dialog";
import { Picker } from "@/components/console/picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Pick an agent and a role: the backend makes the key, registers this gateway and switches the agent's MCP tool on. */
export function ConnectAgentDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const t = useTranslations("agents");
  const roleLabel = useRoleLabel();
  const [agents, setAgents] = useState<Agent[]>([]);
  // Why the platform's agents could not be listed, in the backend's words.
  const [refused, setRefused] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [toolsets, setToolsets] = useState<McpToolset[]>([]);
  const [agent, setAgent] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const said = (e: unknown) => (e instanceof Error ? e.message : String(e));
    apiClient.agents
      .list()
      .then((r) => {
        setAgents(r.agents ?? []);
        setRefused(r.ok ? "" : r.message);
      })
      .catch((e) => setRefused(said(e)));
    Promise.all([apiClient.roles.list(), apiClient.mcp.toolsets()])
      .then(([listed, sets]) => {
        setRoles(listed);
        setToolsets(sets);
        // A default, not a blank: the first role that can change data, else the first.
        const writes = new Set(sets.filter((s) => s.write).map((s) => s.name));
        const first = listed.find((r) => r.mcp_toolsets.some((n) => writes.has(n))) ?? listed[0];
        setRole((current) => current || first?.name || "");
      })
      .catch((e) => toast.error(said(e)));
  }, [open]);

  const writing = new Set(toolsets.filter((s) => s.write).map((s) => s.name));
  const changes = (roles.find((r) => r.name === role)?.mcp_toolsets ?? []).filter((name) =>
    writing.has(name),
  );
  // Two agents may share a name: the start of each one's id tells them apart.
  const shared = new Set(
    agents.filter((a, i) => agents.some((b, j) => i !== j && a.name === b.name)).map((a) => a.id),
  );

  /** Closed, the dialog forgets its agent: opened again it starts with none picked. */
  function openChange(next: boolean) {
    if (!next) setAgent("");
    onOpenChange(next);
  }

  async function connect() {
    setBusy(true);
    try {
      const r = await apiClient.agents.connect({ agent, role });
      if (r.ok) {
        toast.success(r.message);
        onConnected();
        openChange(false);
      } else {
        toast.error(r.message);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("agent")} error={refused || undefined}>
            {!refused && (
              <Picker
                items={agents.map((a) => ({
                  value: a.id,
                  label: a.name,
                  hint: shared.has(a.id) ? a.id.slice(0, 8) : undefined,
                }))}
                value={agent}
                onChange={setAgent}
                label={t("agent")}
                placeholder={t("agentSearch")}
                empty={t("agentNone")}
                change={t("agentChange")}
              />
            )}
          </Field>
          <Field
            label={t("role")}
            htmlFor="agent-role"
            hint={
              role
                ? changes.length
                  ? t("changes", { toolsets: changes.join(", ") })
                  : t("readsOnly")
                : undefined
            }
          >
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="agent-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {roleLabel({ ...r, display_name: r.display_name || r.name })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={connect} disabled={!agent || !role || busy}>
            {t(busy ? "connecting" : "connectAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
