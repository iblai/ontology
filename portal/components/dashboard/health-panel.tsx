import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";

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
  const Icon = status === "healthy" ? CheckCircle2 : status === "down" ? XCircle : AlertCircle;
  const tone =
    status === "healthy"
      ? "text-emerald-600"
      : status === "down"
        ? "text-red-600"
        : "text-amber-600";
  const statusLabel =
    status === "healthy" ? healthyLabel : status === "down" ? downLabel : degradedLabel;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-foreground">{title}</CardTitle>
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
            <Icon className="size-3.5" />
            {statusLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={cn("font-mono", r.value ? "text-foreground" : "text-red-600")}>
              {r.value ? "ok" : "fail"}
            </span>
          </div>
        ))}
        <p className="pt-2 text-xs text-muted-foreground">{lastChecked}</p>
      </CardContent>
    </Card>
  );
}
