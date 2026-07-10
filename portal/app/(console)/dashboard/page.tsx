"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { HealthSnapshot, QuickCounts } from "@/lib/ontology/types";
import { fmtRows, fmtSize } from "@/lib/ontology/format";
import { SectionHeader } from "@/components/console/section-header";
import { HealthPanel } from "@/components/dashboard/health-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [counts, setCounts] = useState<QuickCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [h, c] = await Promise.all([apiClient.health.all(), apiClient.counts()]);
        setHealth(h);
        setCounts(c);
      } catch (e) {
        console.error("dashboard load failed", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function recheck() {
    setLoading(true);
    const h = await apiClient.health.recheck();
    setHealth(h);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button variant="outline" size="sm" onClick={recheck} disabled={loading}>
            <RefreshCw className="mr-2 size-3.5" />
            {t("recheckAll")}
          </Button>
        }
      />

      {loading || !health ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <HealthPanel
            title={t("healthCache")}
            healthy={health.db.healthy}
            rows={[
              { label: t("tableCount", { n: health.db.table_count }), value: true },
              { label: t("totalRows", { n: fmtRows(health.db.total_rows) }), value: true },
              { label: t("sizeMb", { n: health.db.size_mb.toFixed(1) }), value: true },
              {
                label: t("activeConnections", { n: health.db.active_connections }),
                value: true,
              },
            ]}
            lastChecked={fmtDateTime(health.checked_at)}
            healthyLabel={t("healthy")}
            degradedLabel={t("degraded")}
            downLabel={t("down")}
          />
          <HealthPanel
            title={t("healthMcp")}
            healthy={health.mcp_servers.every((s) => s.reachable)}
            rows={health.mcp_servers.map((s) => ({
              label: `${s.name} · ${t("latency", { n: s.latency_ms })} · ${t("toolCount", { n: s.tool_count })}`,
              value: s.reachable,
            }))}
            lastChecked={fmtDateTime(health.checked_at)}
            healthyLabel={t("healthy")}
            degradedLabel={t("degraded")}
            downLabel={t("down")}
          />
          <HealthPanel
            title={t("healthSync")}
            healthy={health.sync.failed_last_24h === 0}
            rows={[
              { label: t("totalSchedules", { n: health.sync.total_schedules }), value: true },
              {
                label: t("failedLast24h", { n: health.sync.failed_last_24h }),
                value: health.sync.failed_last_24h === 0,
              },
              { label: t("runningNow", { n: health.sync.running ? 1 : 0 }), value: true },
              ...(health.sync.next_due_schedule
                ? [
                    {
                      label: t("nextDue", {
                        schedule: health.sync.next_due_schedule,
                        time: fmtDateTime(health.sync.next_due_at ?? ""),
                      }),
                      value: true,
                    },
                  ]
                : []),
            ]}
            lastChecked={fmtDateTime(health.checked_at)}
            healthyLabel={t("healthy")}
            degradedLabel={t("degraded")}
            downLabel={t("down")}
          />
          <HealthPanel
            title={t("healthStorage")}
            healthy={health.storage.total_files > 0}
            rows={[
              { label: t("totalFiles", { n: health.storage.total_files }), value: true },
              { label: fmtSize(health.storage.total_size_mb), value: true },
              ...health.storage.by_domain.slice(0, 4).map((d) => ({
                label: `${d.domain} · ${d.files} files · ${fmtSize(d.size_mb)}`,
                value: true,
              })),
            ]}
            lastChecked={fmtDateTime(health.checked_at)}
            healthyLabel={t("healthy")}
            degradedLabel={t("degraded")}
            downLabel={t("down")}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("quickCounts")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !counts ? (
            <div className="flex gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-24" />
              ))}
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <CountTile label={t("servicesLabel")} value={counts.services} />
              <CountTile label={t("toolsLabel")} value={counts.tools} />
              <CountTile label={t("toolsetsLabel")} value={counts.toolsets} />
              <CountTile label={t("rolesLabel")} value={counts.roles} />
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
