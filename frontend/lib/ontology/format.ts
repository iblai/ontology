import type {
  ServiceStatus,
  SafetyStatus,
  SyncStatus,
  RunStatus,
  StepStatus,
  SyncRunStatus,
  SafetyTestResult,
} from "./types";

const SECRET_RE = /(password|secret|api_key|api-key|token|client_secret|key)$/i;

export function redactConnectionConfig(cfg: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) {
    out[k] = SECRET_RE.test(k) ? "********" : v;
  }
  return out;
}

export function fmtRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb * 1024)} KB`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** A status's tone; `StatusPill` paints it as the dot colour. */
export type Palette = "success" | "error" | "warning" | "info" | "neutral" | "neutralMuted";

const SERVICE_STATUS_PALETTE: Record<ServiceStatus, Palette> = {
  pending: "warning",
  active: "success",
  inactive: "neutral",
  error: "error",
};

const SAFETY_STATUS_PALETTE: Record<SafetyStatus, Palette> = {
  passed: "success",
  failed: "error",
  pending: "warning",
  error: "error",
};

const SYNC_STATUS_PALETTE: Record<SyncStatus, Palette> = {
  never_run: "neutral",
  success: "success",
  failed: "error",
  running: "info",
};

const RUN_PALETTE: Record<RunStatus, Palette> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "error",
  rolled_back: "warning",
};

const STEP_PALETTE: Record<StepStatus, Palette> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "error",
  skipped: "neutralMuted",
};

const SYNC_RUN_PALETTE: Record<SyncRunStatus, Palette> = {
  running: "info",
  success: "success",
  failed: "error",
};

const SAFETY_TEST_PALETTE: Record<SafetyTestResult, Palette> = {
  passed: "success",
  failed: "error",
  error: "warning",
};

function toneFor<T extends string>(map: Record<T, Palette>, value: T): Palette {
  return map[value];
}

export function statusTone(status: ServiceStatus): Palette {
  return toneFor(SERVICE_STATUS_PALETTE, status);
}

export function safetyTone(status: SafetyStatus): Palette {
  return toneFor(SAFETY_STATUS_PALETTE, status);
}

export function syncTone(status: SyncStatus): Palette {
  return toneFor(SYNC_STATUS_PALETTE, status);
}

export function runTone(status: RunStatus): Palette {
  return toneFor(RUN_PALETTE, status);
}

export function stepTone(status: StepStatus): Palette {
  return toneFor(STEP_PALETTE, status);
}

export function syncRunTone(status: SyncRunStatus): Palette {
  return toneFor(SYNC_RUN_PALETTE, status);
}

export function safetyTestTone(result: SafetyTestResult): Palette {
  return toneFor(SAFETY_TEST_PALETTE, result);
}
