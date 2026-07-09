"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Play, ShieldCheck, RefreshCw, Database, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type {
  Service,
  ServiceHealth,
  SafetyReport,
  ProvisioningRun,
  SyncRun,
} from "@/lib/ontology/types";
import { StatusBadge } from "@/components/console/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineStepper } from "@/components/services/pipeline-stepper";
import { SafetyChecklist } from "@/components/services/safety-checklist";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";
import { fmtRows, redactConnectionConfig } from "@/lib/ontology/format";

export function ServiceDetailClient({ service }: { service: Service }) {
  const t = useTranslations("serviceDetail");
  const ts = useTranslations("services");
  const tc = useTranslations("common");
  const router = useRouter();

  const [probe, setProbe] = useState<ServiceHealth | null>(null);
  const [safety, setSafety] = useState<SafetyReport | undefined>(undefined);
  const [runs, setRuns] = useState<ProvisioningRun[]>([]);
  const [latestSync, setLatestSync] = useState<SyncRun | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [health, syncHistory, serviceRuns, safety] = await Promise.all([
          apiClient.services.status(service.name),
          apiClient.sync.history(service.name, 1),
          apiClient.services.runs(service.name),
          apiClient.services.safetyReport(service.name),
        ]);
        setProbe(health);
        setRuns(serviceRuns);
        setSafety(safety);
        setLatestSync(syncHistory[0]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load service detail");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [service.name]);

  async function runProbe() {
    const r = await apiClient.services.status(service.name);
    setProbe(r);
    toast.success(ts("runStatusProbe"));
  }

  async function runSafety() {
    const r = await apiClient.services.test(service.name);
    setSafety(r);
    toast.success(ts("runSafetySuite"));
  }

  async function discover() {
    const r = await apiClient.services.discover(service.name);
    toast.success(r.message);
  }

  async function approve() {
    const r = await apiClient.services.approve(service.name);
    if (r.ok) {
      toast.success(t("pipeline.runCompleted"));
    } else {
      toast.error(r.message);
    }
  }

  async function syncNow() {
    const r = await apiClient.services.sync(service.name);
    if (r.ok) toast.success(t("sync.triggered"));
    else toast.error(r.message);
  }

  async function remove() {
    const r = await apiClient.services.remove(service.name);
    if (r.ok) {
      toast.success(ts("removedToast", { name: service.name }));
      router.push("/services");
    } else {
      toast.error(r.message);
    }
  }

  const connectionRows = Object.entries(redactConnectionConfig(service.connection_config));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/services")} className="px-2">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-lg font-semibold text-foreground">{service.name}</h1>
          <StatusBadge kind="status" value={service.status} />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="connection">{t("tabConnection")}</TabsTrigger>
          <TabsTrigger value="schema">{t("tabSchema")}</TabsTrigger>
          <TabsTrigger value="safety">{t("tabSafety")}</TabsTrigger>
          <TabsTrigger value="pipeline">{t("tabPipeline")}</TabsTrigger>
          <TabsTrigger value="sync">{t("tabSync")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {service.status === "pending" && (
                <Button size="sm" onClick={approve}>
                  <Play className="mr-2 size-3.5" />
                  {ts("approve")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={runProbe}>
                <Database className="mr-2 size-3.5" />
                {ts("runStatusProbe")}
              </Button>
              <Button size="sm" variant="outline" onClick={discover}>
                <RefreshCw className="mr-2 size-3.5" />
                {ts("discover")}
              </Button>
              <Button size="sm" variant="outline" onClick={syncNow}>
                <RefreshCw className="mr-2 size-3.5" />
                {ts("syncNow")}
              </Button>
            </div>

            <Card>
              <CardContent className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-2">
                <DetailRow label={t("overview.status")} value={<StatusBadge kind="status" value={service.status} />} />
                <DetailRow label={t("overview.displayName")} value={service.display_name} />
                <DetailRow label={t("overview.adapter")} value={<span className="font-mono text-xs">{service.adapter}</span>} />
                <DetailRow label={t("overview.host")} value={<span className="font-mono text-xs">{service.host}</span>} />
                <DetailRow label={t("overview.lastDiscovery")} value={fmtDateTime(service.last_discovery_at)} />
                <DetailRow label={t("overview.safetyStatus")} value={<StatusBadge kind="safety" value={service.safety_status} />} />
                <DetailRow label={t("overview.lastSafetyCheck")} value={fmtDateTime(service.last_safety_check_at)} />
                <DetailRow label={t("overview.lastSync")} value={service.last_sync_at ? fmtDateTime(service.last_sync_at) : tc("never")} />
                <DetailRow label={t("overview.syncStatus")} value={<StatusBadge kind="sync" value={service.sync_status} />} />
                <DetailRow label={t("overview.tablesSynced")} value={<span className="font-mono">{fmtRows(service.tables_synced)}</span>} />
                <DetailRow label={t("overview.rowsSynced")} value={<span className="font-mono">{fmtRows(service.rows_synced)}</span>} />
              </CardContent>
            </Card>

            {probe && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("overview.probe")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <DetailRow
                    label={t("overview.probeConnected")}
                    value={
                      <span className={probe.connected ? "text-emerald-600" : "text-red-600"}>
                        {probe.connected ? t("overview.probeConnected") : t("overview.probeNotConnected")}
                      </span>
                    }
                  />
                  <DetailRow
                    label={t("overview.probeReadOnly")}
                    value={
                      <span className={probe.read_only ? "text-emerald-600" : "text-red-600"}>
                        {probe.read_only ? t("overview.probeReadOnly") : t("overview.probeReadWrite")}
                      </span>
                    }
                  />
                  <DetailRow label={t("overview.probeLatency")} value={<span className="font-mono">{probe.latency_ms} ms</span>} />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="connection" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t("connection.title")}</CardTitle>
              <p className="text-xs text-muted-foreground">{t("connection.subtitle")}</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <tbody>
                    {connectionRows.map(([k, v]) => (
                      <tr key={k} className="border-b last:border-b-0">
                        <td className="bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">{k}</td>
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("connection.redacted")}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schema" className="mt-4">
          {service.schema_manifest ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label={t("schema.dbType")} value={<span className="font-mono">{service.schema_manifest.db_type}</span>} />
                <Stat label={t("schema.totalTables")} value={<span className="font-mono">{service.schema_manifest.total_tables}</span>} />
                <Stat label={t("schema.totalRows")} value={<span className="font-mono">{fmtRows(service.schema_manifest.total_rows)}</span>} />
              </div>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("schema.topTables")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">{t("schema.colSchema")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("schema.colTable")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("schema.colRows")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("schema.colColumns")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {service.schema_manifest.tables.map((tbl) => (
                          <tr key={`${tbl.schema_name}.${tbl.table_name}`} className="border-b last:border-b-0">
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tbl.schema_name}</td>
                            <td className="px-3 py-2 font-mono text-xs text-foreground">{tbl.table_name}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{fmtRows(tbl.row_count)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{tbl.column_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tc("noResults")}</p>
          )}
        </TabsContent>

        <TabsContent value="safety" className="mt-4">
          <div className="flex flex-col gap-4">
            <Button size="sm" variant="outline" className="w-fit" onClick={runSafety}>
              <ShieldCheck className="mr-2 size-3.5" />
              {ts("runSafetySuite")}
            </Button>
            {loading ? (
              <Skeleton className="h-40 rounded-lg" />
            ) : (
              <SafetyChecklist report={safety} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4">
          <div className="flex flex-col gap-4">
            {service.status === "pending" && (
              <Button size="sm" className="w-fit" onClick={approve}>
                <Play className="mr-2 size-3.5" />
                {ts("approve")}
              </Button>
            )}
            {runs.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">{t("pipeline.noRuns")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {runs.map((run) => (
                  <Card key={run.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="font-mono text-xs font-medium text-muted-foreground">
                          {run.id}
                        </CardTitle>
                        <StatusBadge kind="run" value={run.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {fmtDateTime(run.started_at)}
                        {run.completed_at && ` → ${fmtDateTime(run.completed_at)}`}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <PipelineStepper steps={run.steps} />
                      {run.error_message && (
                        <p className="mt-3 text-xs text-red-600">{run.error_message}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <div className="flex flex-col gap-4">
            <Button size="sm" variant="outline" className="w-fit" onClick={syncNow}>
              <RefreshCw className="mr-2 size-3.5" />
              {ts("syncNow")}
            </Button>
            {latestSync ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("sync.latestRun")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <DetailRow label={t("sync.duration")} value={<span className="font-mono">{latestSync.duration_seconds}s</span>} />
                  <DetailRow label={tc("actions")} value={<StatusBadge kind="syncRun" value={latestSync.status} />} />
                  <DetailRow label={t("sync.records")} value={<span className="font-mono">{fmtRows(latestSync.records_processed)}</span>} />
                  <DetailRow label={t("overview.lastSync")} value={fmtDateTime(latestSync.started_at)} />
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">{t("sync.noRuns")}</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-2 border-t pt-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-2 size-3.5" />
              {ts("removeService")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{ts("removeConfirmTitle", { name: service.name })}</AlertDialogTitle>
              <AlertDialogDescription>{ts("removeConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">
                {ts("removeConfirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}