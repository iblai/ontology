import { describe, expect, it } from "vitest";

import { formatLine, parseLog, refusalTurn, summarize, type LogEntry } from "./log";

const now = Date.parse("2026-11-17T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const REJECTED = "rejected origin https://x (not in --allowed-origins)";

const call = (at: string, tool: string, agent: string): LogEntry => ({
  at,
  level: "INFO",
  text: `mcp tools/call ${tool} origin=- 12ms 200`,
  call: { tool, agent, user: "—", session: "—", status: "ok", ms: 12 },
});

// Oldest first, as the file holds them.
const entries: LogEntry[] = [
  call(ago(25 * HOUR), "list_courses", "advisor"),
  call(ago(2 * HOUR), "list_courses", "advisor"),
  { at: ago(HOUR + MIN), level: "WARN", text: REJECTED },
  call(ago(30 * MIN), "at_risk_students", "tutor"),
  call(ago(10 * MIN), "at_risk_students", "advisor"),
];

describe("formatLine", () => {
  it("prints the mock's Runtime Log line", () => {
    const entry: LogEntry = { at: "2026-11-17T14:02:11.000Z", level: "INFO", text: "mcp ping" };
    const time = new Date(entry.at).toTimeString().slice(0, 8); // the host's own time
    expect(formatLine(entry)).toBe(`${time} INFO  mcp ping`);
    expect(formatLine({ ...entry, level: "ERROR" })).toBe(`${time} ERROR mcp ping`);
  });
});

describe("parseLog", () => {
  it("keeps the entries and skips what is not one", () => {
    const text = `${JSON.stringify(entries[2])}\n{torn\n\n${JSON.stringify(entries[3])}\n`;
    expect(parseLog(text)).toEqual([entries[2], entries[3]]);
  });
});

describe("summarize", () => {
  const summary = summarize(entries, now);

  it("counts the last 24 hours and names the most called tool", () => {
    expect(summary.calls24h).toBe(3);
    expect(summary.top).toBe("at_risk_students");
    expect(summary.byAgent).toEqual({ advisor: 2, tutor: 1 });
  });

  it("lists calls newest first and log lines oldest first", () => {
    expect(summary.calls.map((c) => c.at)).toEqual([
      ago(10 * MIN),
      ago(30 * MIN),
      ago(2 * HOUR),
      ago(25 * HOUR),
    ]);
    expect(summary.calls[0]).toMatchObject({ tool: "at_risk_students", agent: "advisor" });
    expect(summary.log).toHaveLength(5);
    const time = new Date(entries[2].at).toTimeString().slice(0, 8); // the host's own time
    expect(summary.log[2]).toBe(`${time} WARN  ${REJECTED}`);
  });

  it("buckets the last 16 hours, oldest first, for every call and for the top tool", () => {
    const calls = Array.from({ length: 16 }, () => 0);
    calls[15] = 2;
    calls[13] = 1;
    const top = Array.from({ length: 16 }, () => 0);
    top[15] = 2;
    expect(summary.spark).toEqual({ calls, top });
  });

  it("answers zeros and no top tool for an empty log", () => {
    const empty = summarize([], now);
    expect(empty).toMatchObject({ calls: [], log: [], calls24h: 0, top: null, byAgent: {} });
    expect(empty.spark.calls).toEqual(Array.from({ length: 16 }, () => 0));
  });
});

describe("refusalTurn", () => {
  it("writes twenty a minute per server, says so once, then drops", () => {
    const turns = Array.from({ length: 23 }, () => refusalTurn("/a/gateway.log", now));
    expect(turns.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => "write"));
    expect(turns.slice(20)).toEqual(["last", "drop", "drop"]);
    expect(refusalTurn("/b/gateway.log", now)).toBe("write");
    expect(refusalTurn("/a/gateway.log", now + MIN)).toBe("write");
  });
});
