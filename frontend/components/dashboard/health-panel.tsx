import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/console/status-pill";

export interface HealthRow {
  label: string;
  value: boolean;
}

export function HealthPanel({
  title,
  healthy,
  rows,
  lastChecked,
  healthyLabel,
  degradedLabel,
  downLabel,
}: {
  title: string;
  healthy: boolean;
  rows: HealthRow[];
  lastChecked: string;
  healthyLabel: string;
  degradedLabel: string;
  downLabel: string;
}) {
  const allOk = healthy && rows.every((r) => r.value);
  const anyDown = rows.some((r) => !r.value);
  const status = allOk ? "healthy" : anyDown ? "down" : "degraded";
  const statusLabel =
    status === "healthy" ? healthyLabel : status === "down" ? downLabel : degradedLabel;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-foreground text-sm font-medium">{title}</CardTitle>
          <StatusPill
            tone={status === "healthy" ? "success" : status === "down" ? "error" : "warning"}
          >
            {statusLabel}
          </StatusPill>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={r.value ? "text-foreground" : "text-red-600"}>
              {r.value ? "ok" : "fail"}
            </span>
          </div>
        ))}
        <p className="text-muted-foreground pt-2 text-xs">{lastChecked}</p>
      </CardContent>
    </Card>
  );
}
