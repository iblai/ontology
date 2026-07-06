// Shared helpers for the mock gate route handlers (guide §2 conventions).
// Auth is bypassed in this dev mock — a real backend derives the caller from the token.

import { GateStoreError } from "@/lib/gate/mock-store";

export function platformKeyParam(req: Request): string {
  return new URL(req.url).searchParams.get("platform_key") ?? "";
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Business error envelope: `{ error: <machine_code>, detail }` (guide §2). */
export function gateError(status: number, code: string, detail: string): Response {
  return Response.json({ error: code, detail }, { status });
}

/** Maps a thrown GateStoreError to its HTTP envelope; anything else is a 500. */
export function handleGateError(e: unknown): Response {
  if (e instanceof GateStoreError) return gateError(e.status, e.code, e.detail);
  const detail = e instanceof Error ? e.message : "Unexpected error";
  return gateError(500, "server_error", detail);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function submissionId(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  return Number(id);
}
