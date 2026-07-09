"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { SyncSchedule, SyncRun } from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import { StatusBadge } from "@/components/console/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";

export default function SyncPage() {
  const t = useTranslations("sync");
  const [schedules, setSchedules] = useState<SyncSchedule[] | null>(null);
  const [status, setStatus] = useState<SyncRun[] | null>(null);
  const [history, setHistory] = useState<SyncRun[] | null>(null);
  const [serviceFilter, setServiceFilter] = useState("all");

  useEffect(() => {
    const err = (e: unknown) => console.error("sync load failed", e);
    apiClient.sync.schedules().then(setSchedules).catch(err);
    apiClient.sync.status().then(setStatus).catch(err);
    apiClient.sync.history().then(setHistory).catch(err);
  }, []);

  async function runAll() {
    const r = await apiClient.sync.runAll();
    toast.success(r.message);
    apiClient.sync
      .status()
      .then(setStatus)
      .catch((e) => console.error(e));
    apiClient.sync
      .history()
      .then(setHistory)
      .catch((e) => console.error(e));
  }

  const scheduleCols: ColumnDef<SyncSchedule, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("schedulesColName")),
      cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "cron",
      header: sortableHeader(t("schedulesColCron")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.cron}</span>
      ),
    },
    {
      accessorKey: "source",
      header: sortableHeader(t("schedulesColSource")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.source}</span>,
    },
    {
      accessorKey: "tool",
      header: sortableHeader(t("schedulesColTool")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.tool}</span>,
    },
    {
      accessorKey: "mode",
      header: sortableHeader(t("schedulesColMode")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.mode}</span>
      ),
    },
    {
      accessorKey: "description",
      header: t("schedulesColDescription"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.description}</span>
      ),
    },
  ];

  const statusCols: ColumnDef<SyncRun, unknown>[] = [
    {
      accessorKey: "schedule_name",
      header: sortableHeader(t("statusColSchedule")),
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium">{row.original.schedule_name}</span>
      ),
    },
    {
      accessorKey: "source_system",
      header: sortableHeader(t("statusColSource")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.source_system}</span>,
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("statusColStatus")),
      cell: ({ row }) => <StatusBadge kind="syncRun" value={row.original.status} />,
    },
    {
      accessorKey: "started_at",
      header: sortableHeader(t("statusColStarted")),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {fmtDateTime(row.original.started_at)}
        </span>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: sortableHeader(t("statusColDuration")),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.duration_seconds}s</span>
      ),
    },
    {
      accessorKey: "records_processed",
      header: sortableHeader(t("statusColRecords")),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{row.original.records_processed}</span>
      ),
    },
  ];

  const historyCols: ColumnDef<SyncRun, unknown>[] = [
    {
      accessorKey: "id",
      header: sortableHeader(t("historyColId")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.id.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: "schedule_name",
      header: sortableHeader(t("historyColSchedule")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.schedule_name}</span>,
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("historyColStatus")),
      cell: ({ row }) => <StatusBadge kind="syncRun" value={row.original.status} />,
    },
    {
      accessorKey: "started_at",
      header: sortableHeader(t("historyColStarted")),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {fmtDateTime(row.original.started_at)}
        </span>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: sortableHeader(t("historyColDuration")),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.duration_seconds}s</span>
      ),
    },
    {
      accessorKey: "records_created",
      header: sortableHeader(t("historyColCreated")),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{row.original.records_created}</span>
      ),
    },
    {
      accessorKey: "records_updated",
      header: sortableHeader(t("historyColUpdated")),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{row.original.records_updated}</span>
      ),
    },
    {
      accessorKey: "error_message",
      header: t("historyColError"),
      cell: ({ row }) =>
        row.original.error_message ? (
          <span className="text-xs text-red-600">{row.original.error_message.slice(0, 50)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button size="sm" onClick={runAll}>
            <Play className="mr-2 size-3.5" />
            {t("runAllDue")}
          </Button>
        }
      />
      <Tabs defaultValue="schedules">
        <TabsList>
          <TabsTrigger value="schedules">{t("tabSchedules")}</TabsTrigger>
          <TabsTrigger value="status">{t("tabStatus")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="mt-4">
          {schedules === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSchedules")}</p>
          ) : (
            <DataTable columns={scheduleCols} data={schedules} pageSize={15} />
          )}
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          {status === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : status.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
          ) : (
            <DataTable columns={statusCols} data={status} pageSize={15} />
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="flex flex-col gap-3">
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterByService")}: all</SelectItem>
                {Array.from(new Set((history ?? []).map((r) => r.source_system))).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="font-mono text-xs">{s}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {history === null ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <DataTable
                columns={historyCols}
                data={
                  serviceFilter === "all"
                    ? history
                    : history.filter((r) => r.source_system === serviceFilter)
                }
                pageSize={15}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
