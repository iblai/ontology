"use client";

import { useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Play, ShieldCheck, RefreshCw, Database, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type {
  Service,
  ServiceHealth,
  SafetyReport,
  ProvisioningRun,
  SyncRun,
} from "@/lib/ontology/types";
import { StatusBadge } from "@/components/console/status-badge";
import { StatusPill } from "@/components/console/status-pill";
import { SectionHeader } from "@/components/console/section-header";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { EmptyState } from "@/components/console/empty-state";
import { FactRow, Facts } from "@/components/console/facts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PipelineStepper } from "@/components/services/pipeline-stepper";
import { SafetyChecklist } from "@/components/services/safety-checklist";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";
import { fmtDuration, fmtRows, redactConnectionConfig } from "@/lib/ontology/format";

/** Loads the service by name; a missing one is a 404, a failed load says so. */
export function ServiceDetailClient({ name }: { name: string }) {
  const [state, setState] = useState<{ service?: Service | null; error?: string }>({});
  useEffect(() => {
    let live = true;
    apiClient.services.get(name).then(
      (service) => {
        if (live) setState({ service });
      },
      (e: Error) => {
        if (live) setState({ error: e.message });
      },
    );
    return () => {
      live = false;
    };
  }, [name]);
  if (state.error) return <EmptyState icon={Database} title={state.error} />;
  if (state.service === null) notFound();
  if (!state.service) return <Skeleton className="h-64 rounded-lg" />;
  return <ServiceDetail service={state.service} />;
}

function ServiceDetail({ service }: { service: Service }) {
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

  async function proposeMapping() {
    const r = await apiClient.services.map(service.name);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
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
      <SectionHeader
        title={service.name}
        badge={<StatusBadge kind="status" value={service.status} />}
        subtitle={service.display_name}
      />

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
                <Button size="sm" variant="outline" onClick={approve}>
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
              {service.service_type === "database" && (
                <Button size="sm" variant="outline" onClick={proposeMapping}>
                  <Sparkles className="mr-2 size-3.5" />
                  {ts("proposeMapping")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={syncNow}>
                <RefreshCw className="mr-2 size-3.5" />
                {ts("syncNow")}
              </Button>
            </div>

            <Card>
              <CardContent>
                <Facts>
                  <FactRow
                    label={t("overview.status")}
                    value={<StatusBadge kind="status" value={service.status} />}
                  />
                  <FactRow label={t("overview.displayName")} value={service.display_name} />
                  <FactRow
                    label={t("overview.adapter")}
                    value={<span className="text-xs">{service.adapter}</span>}
                  />
                  <FactRow
                    label={t("overview.host")}
                    value={<span className="text-xs">{service.host}</span>}
                  />
                  <FactRow
                    label={t("overview.lastDiscovery")}
                    value={fmtDateTime(service.last_discovery_at)}
                  />
                  <FactRow
                    label={t("overview.safetyStatus")}
                    value={<StatusBadge kind="safety" value={service.safety_status} />}
                  />
                  <FactRow
                    label={t("overview.lastSafetyCheck")}
                    value={fmtDateTime(service.last_safety_check_at)}
                  />
                  <FactRow
                    label={t("overview.lastSync")}
                    value={service.last_sync_at ? fmtDateTime(service.last_sync_at) : tc("never")}
                  />
                  <FactRow
                    label={t("overview.syncStatus")}
                    value={<StatusBadge kind="sync" value={service.sync_status} />}
                  />
                  <FactRow
                    label={t("overview.tablesSynced")}
                    value={<span className="tabular-nums">{fmtRows(service.tables_synced)}</span>}
                  />
                  <FactRow
                    label={t("overview.rowsSynced")}
                    value={<span className="tabular-nums">{fmtRows(service.rows_synced)}</span>}
                  />
                </Facts>
              </CardContent>
            </Card>

            {probe && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("overview.probe")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Facts>
                    <FactRow
                      label={t("overview.probeConnected")}
                      value={
                        <StatusPill tone={probe.connected ? "success" : "error"}>
                          {probe.connected
                            ? t("overview.probeConnected")
                            : t("overview.probeNotConnected")}
                        </StatusPill>
                      }
                    />
                    <FactRow
                      label={t("overview.probeReadOnly")}
                      value={
                        <StatusPill tone={probe.read_only ? "success" : "error"}>
                          {probe.read_only
                            ? t("overview.probeReadOnly")
                            : t("overview.probeReadWrite")}
                        </StatusPill>
                      }
                    />
                    <FactRow
                      label={t("overview.probeLatency")}
                      value={<span className="tabular-nums">{probe.latency_ms} ms</span>}
                    />
                  </Facts>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="connection" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t("connection.title")}</CardTitle>
              <p className="text-muted-foreground text-xs">{t("connection.subtitle")}</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableBody>
                    {connectionRows.map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="bg-muted/40 text-muted-foreground py-2 text-xs">
                          {k}
                        </TableCell>
                        <TableCell className="text-foreground py-2 text-xs">{v}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">{t("connection.redacted")}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schema" className="mt-4">
          {service.schema_manifest ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label={t("schema.dbType")} value={service.schema_manifest.db_type} />
                <Stat
                  label={t("schema.totalTables")}
                  value={
                    <span className="tabular-nums">{service.schema_manifest.total_tables}</span>
                  }
                />
                <Stat
                  label={t("schema.totalRows")}
                  value={
                    <span className="tabular-nums">
                      {fmtRows(service.schema_manifest.total_rows)}
                    </span>
                  }
                />
              </div>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("schema.topTables")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">{t("schema.colSchema")}</TableHead>
                          <TableHead className="text-xs">{t("schema.colTable")}</TableHead>
                          <TableHead className="text-right text-xs">
                            {t("schema.colRows")}
                          </TableHead>
                          <TableHead className="text-right text-xs">
                            {t("schema.colColumns")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {service.schema_manifest.tables.map((tbl) => (
                          <TableRow key={`${tbl.schema_name}.${tbl.table_name}`}>
                            <TableCell className="text-muted-foreground py-2 text-xs">
                              {tbl.schema_name}
                            </TableCell>
                            <TableCell className="text-foreground py-2 text-xs">
                              {tbl.table_name}
                            </TableCell>
                            <TableCell className="py-2 text-right text-xs tabular-nums">
                              {fmtRows(tbl.row_count)}
                            </TableCell>
                            <TableCell className="py-2 text-right text-xs tabular-nums">
                              {tbl.column_count}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <EmptyState title={tc("noResults")} />
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
              <Button size="sm" variant="outline" className="w-fit" onClick={approve}>
                <Play className="mr-2 size-3.5" />
                {ts("approve")}
              </Button>
            )}
            {runs.length === 0 ? (
              <EmptyState title={t("pipeline.noRuns")} />
            ) : (
              <div className="flex flex-col gap-4">
                {runs.map((run) => (
                  <Card key={run.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-muted-foreground text-xs font-medium">
                          {run.id}
                        </CardTitle>
                        <StatusBadge kind="run" value={run.status} />
                      </div>
                      <p className="text-muted-foreground text-xs">
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
                <CardContent>
                  <Facts>
                    <FactRow
                      label={t("sync.duration")}
                      value={
                        <span className="tabular-nums">
                          {fmtDuration(latestSync.duration_seconds)}
                        </span>
                      }
                    />
                    <FactRow
                      label={t("overview.status")}
                      value={<StatusBadge kind="syncRun" value={latestSync.status} />}
                    />
                    <FactRow
                      label={t("sync.records")}
                      value={
                        <span className="tabular-nums">
                          {fmtRows(latestSync.records_processed)}
                        </span>
                      }
                    />
                    <FactRow
                      label={t("overview.lastSync")}
                      value={fmtDateTime(latestSync.started_at)}
                    />
                  </Facts>
                </CardContent>
              </Card>
            ) : (
              <EmptyState title={t("sync.noRuns")} />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-2 border-t pt-4">
        <ConfirmDelete
          name={service.name}
          label={ts("removeService")}
          title={ts("removeConfirmTitle", { name: service.name })}
          body={ts("removeConfirmBody")}
          action={ts("removeConfirmAction")}
          onConfirm={remove}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-sm">{value}</p>
    </div>
  );
}
