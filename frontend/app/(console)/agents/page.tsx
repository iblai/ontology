"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, Plus } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDateTime } from "@/lib/format";
import { apiClient } from "@/lib/ontology/api-client";
import type { AgentConnection } from "@/lib/ontology/types";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { EmptyState } from "@/components/console/empty-state";
import { SectionHeader } from "@/components/console/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsPage() {
  const t = useTranslations("agents");
  const tc = useTranslations("common");
  const [connections, setConnections] = useState<AgentConnection[] | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(() => {
    apiClient.agents
      .connections()
      .then(setConnections)
      .catch((e) => console.error("agents load failed", e));
  }, []);

  useEffect(load, [load]);

  async function remove(name: string) {
    const r = await apiClient.agents.disconnect(name);
    if (r.ok) {
      toast.success(r.message);
      setConnections((prev) => prev?.filter((c) => c.name !== name) ?? null);
    } else {
      toast.error(r.message);
    }
  }

  const columns: ColumnDef<AgentConnection, unknown>[] = [
    {
      accessorKey: "agent_name",
      header: sortableHeader(t("colAgent")),
      cell: ({ row }) => (
        <span className="text-foreground text-sm font-medium">
          {row.original.agent_name || row.original.agent}
        </span>
      ),
    },
    {
      accessorKey: "role",
      header: sortableHeader(t("colRole")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.role}</span>,
    },
    {
      accessorKey: "created_at",
      header: sortableHeader(t("colSince")),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {fmtDateTime(row.original.created_at)}
        </span>
      ),
    },
    {
      accessorKey: "created_by",
      header: t("colBy"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.created_by || "—"}</span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <ConfirmDelete
          name={row.original.agent_name}
          title={t("removeTitle", { name: row.original.agent_name })}
          body={t("removeBody")}
          action={tc("remove")}
          onConfirm={() => remove(row.original.name)}
        />
      ),
    },
  ];

  const connect = (
    <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
      <Plus className="mr-2 size-3.5" />
      {t("connect")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      {connections === null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : connections.length === 0 ? (
        <EmptyState icon={Bot} title={t("empty")} hint={t("emptyHint")} action={connect} />
      ) : (
        <DataTable columns={columns} data={connections} toolbar={connect} pageSize={15} />
      )}
      <ConnectAgentDialog open={connecting} onOpenChange={setConnecting} onConnected={load} />
    </div>
  );
}
