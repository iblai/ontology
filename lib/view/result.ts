import type { McpTool, McpToolResult } from "@/lib/host/types";
import type { PlayTool, ToolRun } from "@/lib/view/types";

/** The words to show for a failed answer: the host's `error`, the engine's `detail`, the status. */
export function errorMessage(body: unknown, statusText: string): string {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; detail?: unknown };
    if (typeof b.error === "string" && b.error) return b.error;
    if (typeof b.detail === "string" && b.detail) return b.detail;
    if (Array.isArray(b.detail) && b.detail.length)
      return b.detail.map((d: { msg?: unknown }) => String(d?.msg ?? d)).join("; ");
  }
  // A short plain-text answer is its own words; an HTML page is not.
  if (typeof body === "string" && body.trim() && body.length < 300 && !body.startsWith("<"))
    return body.trim();
  return statusText;
}

/** A JSON body, the last `data:` frame of an event stream, else the text itself. */
export function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const frames = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (frames.length) {
      try {
        return JSON.parse(frames[frames.length - 1]);
      } catch {
        return text;
      }
    }
    return text;
  }
}

type RpcError = { code: number; message: string };

function rpcParts(body: unknown): { result?: unknown; error?: RpcError } {
  if (!body || typeof body !== "object") return {};
  const b = body as { result?: unknown; error?: unknown };
  const e = b.error as RpcError | undefined;
  return {
    result: b.result,
    error: e && typeof e === "object" && typeof e.message === "string" ? e : undefined,
  };
}

/** A tool to start from: one empty value per required property of its input schema. */
export function playTool(t: McpTool): PlayTool {
  const args = Object.fromEntries((t.inputSchema?.required ?? []).map((k) => [k, ""]));
  return { name: t.name, args: JSON.stringify(args) };
}

/** tools/list → the playground's tools; an error answer throws in the gateway's words. */
export function playTools(body: unknown, statusText: string): PlayTool[] {
  const { result, error } = rpcParts(body);
  if (error) throw new Error(error.message);
  const tools = (result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) throw new Error(errorMessage(body, statusText));
  return (tools as McpTool[]).map(playTool);
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { value: v };

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const LISTS = ["data", "items", "results", "records", "rows", "value"];

// The records an API's answer holds: a list, a list under a usual name, or Twenty's
// {data: {people: […]}} and {data: {person: {…}}}; anything else is one record.
// ponytail: these shapes only; an envelope of another shape shows as a single row.
function recordsOf(v: unknown): { rows: unknown[]; total?: number } {
  if (Array.isArray(v)) return { rows: v };
  if (!isObject(v)) return { rows: [v] };
  const total = [v.totalCount, v.total].find((n) => typeof n === "number") as number | undefined;
  for (const key of LISTS) {
    const list = v[key];
    if (Array.isArray(list)) return { rows: list, total };
  }
  const inner = isObject(v.data) ? Object.values(v.data) : [];
  if (inner.length === 1 && Array.isArray(inner[0])) return { rows: inner[0], total };
  if (inner.length === 1 && isObject(inner[0])) return { rows: [inner[0]] };
  return { rows: [v] };
}

// Rows are the JSON of each text content, a list flattened (main2 toolbox_client.py:38-56).
export function toolRun(
  tool: string,
  status: number,
  ms: number,
  body: unknown,
  statusText: string,
): ToolRun {
  const fail = (error: string): ToolRun => ({ ok: false, status, ms, error });
  const { result, error } = rpcParts(body);
  if (error) return fail(error.message);
  const r = result as McpToolResult | undefined;
  if (!r || !Array.isArray(r.content)) return fail(errorMessage(body, statusText));
  const texts = r.content.filter((c) => c.type === "text").map((c) => c.text);
  if (r.isError) return fail(texts.join("\n") || statusText);
  if (tool === "ask_question" && texts.length === 1) {
    const a = asRecord(parseText(texts[0]));
    if (typeof a.answer === "string")
      return {
        ok: true,
        status,
        ms,
        answer: {
          text: a.answer,
          sql: typeof a.sql === "string" ? a.sql : null,
          provenance: typeof a.provenance === "string" ? a.provenance : null,
        },
      };
  }
  const found = texts.map((t) => recordsOf(parseText(t)));
  const rows = found.flatMap((f) => f.rows.map(asRecord));
  const total = found.length === 1 ? found[0].total : undefined;
  return { ok: true, status, ms, rows, ...(total && total > rows.length ? { total } : {}) };
}
