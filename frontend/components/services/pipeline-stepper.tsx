"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Check, X, Loader2, MinusCircle, Clock } from "lucide-react";
import type { ProvisioningStep, StepStatus } from "@/lib/ontology/types";
import { fmtDuration } from "@/lib/ontology/format";

const STEP_KEYS = [
  "stepCacheSchema",
  "stepTextTemplates",
  "stepMcpTools",
  "stepSyncSchedules",
  "stepDockerCompose",
  "stepValidation",
] as const;

const STATUS_ICONS: Record<StepStatus, typeof Check> = {
  pending: Clock,
  running: Loader2,
  completed: Check,
  failed: X,
  skipped: MinusCircle,
};

// Grey throughout; only a failure is coloured, like an error message anywhere else.
const STATUS_TONES: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-muted-foreground",
  completed: "text-muted-foreground",
  failed: "text-red-600",
  skipped: "text-muted-foreground",
};

export function PipelineStepper({ steps }: { steps: ProvisioningStep[] }) {
  const t = useTranslations("serviceDetail.pipeline");
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  return (
    <ol className="flex flex-col gap-0">
      {ordered.map((step, i) => {
        const Icon = STATUS_ICONS[step.status];
        const label = t(STEP_KEYS[step.order]);
        return (
          <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < ordered.length - 1 && (
              <span className="bg-border absolute top-6 left-[11px] h-[calc(100%-1rem)] w-px" />
            )}
            <span className="border-border bg-background z-10 flex size-6 flex-shrink-0 items-center justify-center rounded-full border">
              <Icon
                className={cn(
                  "size-3.5",
                  STATUS_TONES[step.status],
                  step.status === "running" && "animate-spin",
                )}
              />
            </span>
            <div className="flex flex-1 flex-col gap-1 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground text-sm font-medium">{label}</span>
                {step.started_at && step.completed_at && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {fmtDuration(
                      (new Date(step.completed_at).getTime() -
                        new Date(step.started_at).getTime()) /
                        1000,
                    )}
                  </span>
                )}
              </div>
              {step.status === "skipped" &&
                step.output &&
                typeof step.output.skipped === "string" && (
                  <p className="text-muted-foreground text-xs">{step.output.skipped}</p>
                )}
              {step.status === "failed" && step.error_message && (
                <p className="text-xs text-red-600">{step.error_message}</p>
              )}
              {step.status === "failed" &&
                step.output &&
                typeof step.output.error === "string" &&
                !step.error_message && <p className="text-xs text-red-600">{step.output.error}</p>}
              {step.status === "completed" &&
                step.output &&
                "tables" in step.output &&
                Array.isArray(step.output.tables) && (
                  <p className="text-muted-foreground text-xs">
                    {String((step.output.tables as unknown[]).length)} tables validated
                  </p>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
