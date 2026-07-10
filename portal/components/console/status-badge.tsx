import { cn } from "@/lib/utils";
import {
  statusTone,
  safetyTone,
  syncTone,
  runTone,
  stepTone,
  syncRunTone,
  safetyTestTone,
} from "@/lib/ontology/format";
import type {
  ServiceStatus,
  SafetyStatus,
  SyncStatus,
  RunStatus,
  StepStatus,
  SyncRunStatus,
  SafetyTestResult,
} from "@/lib/ontology/types";
import { useTranslations } from "next-intl";

type BadgeKind = "status" | "safety" | "sync" | "run" | "step" | "syncRun" | "safetyTest";

const TONE_FNS: Record<BadgeKind, (s: string) => string> = {
  status: (s) => statusTone(s as ServiceStatus),
  safety: (s) => safetyTone(s as SafetyStatus),
  sync: (s) => syncTone(s as SyncStatus),
  run: (s) => runTone(s as RunStatus),
  step: (s) => stepTone(s as StepStatus),
  syncRun: (s) => syncRunTone(s as SyncRunStatus),
  safetyTest: (s) => safetyTestTone(s as SafetyTestResult),
};

const NS: Record<BadgeKind, string> = {
  status: "badges",
  safety: "badges",
  sync: "badges",
  run: "serviceDetail.pipeline",
  step: "serviceDetail.pipeline",
  syncRun: "badges",
  safetyTest: "serviceDetail.safety",
};

const KEY: Record<BadgeKind, (s: string) => string> = {
  status: (s) => `status${s.charAt(0).toUpperCase()}${s.slice(1)}`,
  safety: (s) => `safety${s.charAt(0).toUpperCase()}${s.slice(1)}`,
  sync: (s) => `sync${s.charAt(0).toUpperCase()}${s.slice(1)}`,
  run: (s) => `status${s.charAt(0).toUpperCase()}${s.slice(1)}`,
  step: (s) => `status${s.charAt(0).toUpperCase()}${s.slice(1)}`,
  syncRun: (s) => (s === "success" ? "syncSuccess" : s === "failed" ? "syncFailed" : "syncRunning"),
  safetyTest: (s) => `result${s.charAt(0).toUpperCase()}${s.slice(1)}`,
};

export function StatusBadge({
  kind,
  value,
  className,
}: {
  kind: BadgeKind;
  value: string;
  className?: string;
}) {
  const t = useTranslations(NS[kind]);
  const tone = TONE_FNS[kind](value);
  const label = t(KEY[kind](value));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}
