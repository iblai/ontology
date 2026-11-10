"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Plus, CalendarClock, Activity } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { SyncSchedule, SyncRun } from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import { EmptyState } from "@/components/console/empty-state";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { ScheduleDialog } from "@/components/sync/schedule-dialog";
import { useCreateParam } from "@/components/shell/use-create-param";
import { Checkbox } from "@/components/ui/checkbox";
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
import { fmtDuration } from "@/lib/ontology/format";
import { toast } from "sonner";

export default function SyncPage() {
  const t = useTranslations("sync");
  const tc = useTranslations("common");
  const [schedules, setSchedules] = useState<SyncSchedule[] | null>(null);
  const [status, setStatus] = useState<SyncRun[] | null>(null);
  const [history, setHistory] = useState<SyncRun[] | null>(null);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [editing, setEditing] = useState<SyncSchedule | "new" | null>(null);
  useCreateParam("schedule", () => setEditing("new"));
  const [sources, setSources] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);

  const loadSchedules = useCallback(() => {
    apiClient.sync
      .schedules()
      .then(setSchedules)
      .catch((e) => console.error("sync load failed", e));
  }, []);

  useEffect(() => {
    const err = (e: unknown) => console.error("sync load failed", e);
    loadSchedules();
    apiClient.sync.status().then(setStatus).catch(err);
    apiClient.sync.history().then(setHistory).catch(err);
    apiClient.services
      .list()
      .then((list) => setSources(list.map((s) => s.name)))
      .catch(err);
    apiClient.mcp
      .tools()
      .then((list) => setTools(list.map((x) => x.name)))
      .catch(err);
  }, [loadSchedules]);

  async function setEnabled(schedule: SyncSchedule, enabled: boolean) {
    const r = await apiClient.sync.saveSchedule({ ...schedule, enabled });
    if (r.ok) loadSchedules();
    else toast.error(r.message);
  }

  async function removeSchedule(name: string) {
    const r = await apiClient.sync.removeSchedule(name);
    if (r.ok) {
      toast.success(r.message);
      setSchedules((prev) => prev?.filter((x) => x.name !== name) ?? null);
    } else {
      toast.error(r.message);
    }
  }

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
      cell: ({ row }) => <span className="text-xs font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "cron",
      header: sortableHeader(t("schedulesColCron")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.cron}</span>,
    },
    {
      accessorKey: "source",
      header: sortableHeader(t("schedulesColSource")),
      cell: ({ row }) => <span className="text-xs">{row.original.source}</span>,
    },
    {
      accessorKey: "tool",
      header: sortableHeader(t("schedulesColTool")),
      cell: ({ row }) => <span className="text-xs">{row.original.table ?? row.original.tool}</span>,
    },
    {
      accessorKey: "mode",
      header: sortableHeader(t("schedulesColMode")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.mode}</span>,
    },
    {
      accessorKey: "description",
      header: t("schedulesColDescription"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.description}</span>
      ),
    },
    {
      accessorKey: "enabled",
      header: t("schedulesColEnabled"),
      cell: ({ row }) => (
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          <Checkbox
            checked={row.original.enabled}
            aria-label={t("enabled")}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(on) => setEnabled(row.original, on === true)}
          />
          {row.original.enabled ? tc("on") : tc("off")}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <ConfirmDelete
          name={row.original.name}
          onConfirm={() => removeSchedule(row.original.name)}
        />
      ),
    },
  ];

  const addButton = (
    <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
      <Plus className="mr-2 size-3.5" />
      {t("addSchedule")}
    </Button>
  );

  const statusCols: ColumnDef<SyncRun, unknown>[] = [
    {
      accessorKey: "schedule_name",
      header: sortableHeader(t("statusColSchedule")),
      cell: ({ row }) => <span className="text-xs font-medium">{row.original.schedule_name}</span>,
    },
    {
      accessorKey: "source_system",
      header: sortableHeader(t("statusColSource")),
      cell: ({ row }) => <span className="text-xs">{row.original.source_system}</span>,
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
        <span className="text-muted-foreground text-xs">
          {fmtDateTime(row.original.started_at)}
        </span>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: sortableHeader(t("statusColDuration")),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">{fmtDuration(row.original.duration_seconds)}</span>
      ),
    },
    {
      accessorKey: "records_processed",
      header: sortableHeader(t("statusColRecords")),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">{row.original.records_processed}</span>
      ),
    },
  ];

  const historyCols: ColumnDef<SyncRun, unknown>[] = [
    {
      accessorKey: "id",
      header: sortableHeader(t("historyColId")),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.id.slice(0, 8)}</span>
      ),
    },
    {
      accessorKey: "schedule_name",
      header: sortableHeader(t("historyColSchedule")),
      cell: ({ row }) => <span className="text-xs">{row.original.schedule_name}</span>,
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
        <span className="text-muted-foreground text-xs">
          {fmtDateTime(row.original.started_at)}
        </span>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: sortableHeader(t("historyColDuration")),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">{fmtDuration(row.original.duration_seconds)}</span>
      ),
    },
    {
      accessorKey: "records_created",
      header: sortableHeader(t("historyColCreated")),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">{row.original.records_created}</span>
      ),
    },
    {
      accessorKey: "records_updated",
      header: sortableHeader(t("historyColUpdated")),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">{row.original.records_updated}</span>
      ),
    },
    {
      accessorKey: "error_message",
      header: t("historyColError"),
      cell: ({ row }) =>
        row.original.error_message ? (
          <span className="text-xs text-red-600">{row.original.error_message.slice(0, 50)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button size="sm" variant="outline" onClick={runAll}>
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
            <EmptyState icon={CalendarClock} title={t("noSchedules")} action={addButton} />
          ) : (
            <DataTable
              columns={scheduleCols}
              data={schedules}
              toolbar={addButton}
              onRowClick={(s) => setEditing(s)}
              pageSize={15}
            />
          )}
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          {status === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : status.length === 0 ? (
            <EmptyState icon={Activity} title={t("noRuns")} />
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
                    <span className="text-xs">{s}</span>
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
      <ScheduleDialog
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        initial={editing === "new" ? undefined : (editing ?? undefined)}
        sources={sources}
        tools={tools}
        onSaved={loadSchedules}
      />
    </div>
  );
}
