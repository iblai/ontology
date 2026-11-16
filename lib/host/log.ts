// What the gateway saw, per server: servers/<slug>/gateway.log, one JSON object per line.
// The call counters, the Activity table and the Runtime Log are read from it.

import { appendFile, open, readdir, type FileHandle } from "node:fs/promises";

import { homePath } from "./files";
import { logTail } from "./toolbox";
import type { HostCall, HostEvent, HostServerActivity } from "./types";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogEntry = { at: string; level: LogLevel; text: string; call?: Omit<HostCall, "at"> };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEPT = 200; // calls and log lines one answer carries
// ponytail: the log is unbounded and only its last 2 MB is read; rotate once one passes ~50 MB.
const TAIL_BYTES = 2 * 1024 * 1024;
const RELOADED = "config reloaded";
const REFUSALS = 20; // lines a minute that refusals before sign-in may write, per server
const MINUTE = 60_000;
// ponytail: per process; a shared counter if several processes serve one host.
const refused = new Map<string, { since: number; n: number }>();

const logPath = (slug: string) => homePath("servers", slug, "gateway.log");

/**
 * Appends one line. `text` is what the Runtime Log prints after the time and the level, e.g.
 * `mcp tools/call at_risk_students origin=https://x.edu 164ms 200`, `rejected origin https://x
 * (not in --allowed-origins)`, `config reloaded tools.yaml (rev 8) · 19 tools · 3 toolsets`.
 * `call` is set for a tools/call. Never throws: a log that cannot be written must not fail a call.
 */
export async function record(
  slug: string,
  level: LogLevel,
  text: string,
  call?: Omit<HostCall, "at">,
): Promise<void> {
  try {
    // A caller's tool name lands in `text`: one line, bounded, so it cannot forge another.
    const line = text.replace(/\s+/g, " ").slice(0, 500);
    const entry: LogEntry = { at: new Date().toISOString(), level, text: line };
    if (call) entry.call = call;
    await appendFile(logPath(slug), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`gateway.log of ${slug} not written: ${reason}`);
  }
}

/** Whether a refusal before sign-in is written: the first REFUSALS of a minute, then one "last". */
export function refusalTurn(key: string, now: number): "write" | "last" | "drop" {
  let seen = refused.get(key);
  if (!seen || now - seen.since >= MINUTE) {
    seen = { since: now, n: 0 };
    refused.set(key, seen);
  }
  seen.n += 1;
  return seen.n <= REFUSALS ? "write" : seen.n === REFUSALS + 1 ? "last" : "drop";
}

/** Records an origin or a host the server refused; anyone can cause one, so they are bounded. */
export async function recordRefusal(slug: string, text: string): Promise<void> {
  const turn = refusalTurn(logPath(slug), Date.now());
  if (turn === "write") await record(slug, "WARN", text);
  if (turn === "last") await record(slug, "WARN", "more refusals this minute are not recorded");
}

/** The entries in a log's text, oldest first; a line that is not one is skipped. */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (typeof entry.at === "string" && typeof entry.text === "string") entries.push(entry);
    } catch {
      // a torn write; the tail's first line is already cut by readTail
    }
  }
  return entries;
}

/** "HH:MM:SS LEVEL  text" in the host's own time, the mock's Runtime Log line. */
export function formatLine(entry: LogEntry): string {
  const time = new Date(entry.at).toTimeString().slice(0, 8);
  return `${time} ${entry.level.padEnd(5)} ${entry.text}`;
}

/** What activity() answers from the gateway's own entries, given oldest first. */
export function summarize(entries: LogEntry[], now = Date.now()): HostServerActivity {
  const calls: HostCall[] = entries.flatMap((e) => (e.call ? [{ ...e.call, at: e.at }] : []));
  const recent = calls.filter((c) => now - Date.parse(c.at) < DAY);

  const byTool: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const c of recent) {
    byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
    byAgent[c.agent] = (byAgent[c.agent] ?? 0) + 1;
  }
  let top: string | null = null;
  for (const [tool, n] of Object.entries(byTool)) if (top === null || n > byTool[top]) top = tool;

  // Bucket 15 is the last hour, bucket 0 the hour fifteen hours before it.
  const spark = { calls: new Array<number>(16).fill(0), top: new Array<number>(16).fill(0) };
  for (const c of calls) {
    const bucket = 15 - Math.floor((now - Date.parse(c.at)) / HOUR);
    if (bucket < 0 || bucket > 15) continue;
    spark.calls[bucket] += 1;
    if (c.tool === top) spark.top[bucket] += 1;
  }

  return {
    calls: calls.slice(-KEPT).reverse(),
    log: entries.slice(-KEPT).map(formatLine),
    calls24h: recent.length,
    top,
    spark,
    byAgent,
  };
}

// The end of the log in whole lines; [] when the server has no log yet.
async function readTail(slug: string): Promise<LogEntry[]> {
  let file: FileHandle;
  try {
    file = await open(logPath(slug), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return parseLog(start > 0 ? text.slice(text.indexOf("\n") + 1) : text);
  } finally {
    await file.close();
  }
}

/** The calls, the log tail, the last 24 hours' counters and the sparklines for one server. */
export async function activity(slug: string): Promise<HostServerActivity> {
  const summary = summarize(await readTail(slug));
  if (summary.log.length === 0) summary.log = await logTail(slug, KEPT);
  return summary;
}

/** The last 24 hours' call count and most called tool for one server. */
export async function stats(slug: string): Promise<{ calls24h: number; top: string | null }> {
  const { calls24h, top } = summarize(await readTail(slug));
  return { calls24h, top };
}

/** The newest deploys across every server, as dashboard events. */
export async function deployEvents(limit: number): Promise<HostEvent[]> {
  let slugs: string[];
  try {
    const dirents = await readdir(homePath("servers"), { withFileTypes: true });
    slugs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: HostEvent[] = [];
  for (const slug of slugs) {
    for (const entry of await readTail(slug)) {
      if (!entry.text.startsWith(RELOADED)) continue;
      const text = `${slug} ${entry.text.slice(RELOADED.length).trim()}`;
      events.push({ tag: "deploy", tone: "green", text, at: entry.at, source: "TB" });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
