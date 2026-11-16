import { describe, expect, it } from "vitest";
import type { HostServer } from "@/lib/host/types";
import { activityView, feedRows, serverRow } from "./servers";
import { ago, clock } from "./time";

const now = Date.parse("2026-11-17T12:00:00Z");
const minutes = (m: number) => new Date(now - m * 60_000).toISOString();

describe("ago", () => {
  it("reads <n><unit>, — for never", () => {
    expect(ago(null, now)).toBe("—");
    expect(ago(minutes(0.5), now)).toBe("30s");
    expect(ago(minutes(12), now)).toBe("12m");
    expect(ago(minutes(180), now)).toBe("3h");
    expect(ago(minutes(6 * 1440), now)).toBe("6d");
    expect(ago(minutes(14 * 1440), now)).toBe("2w");
    expect(ago(minutes(60 * 1440), now)).toBe("2mo");
    expect(ago(minutes(400 * 1440), now)).toBe("1y");
  });

  it("prints a clock time in local time", () => {
    expect(clock(new Date(2026, 10, 17, 14, 2, 9).toISOString())).toBe("14:02:09");
  });
});

describe("serverRow", () => {
  const s: HostServer = {
    slug: "institution",
    revision: 8,
    enabled: true,
    running: true,
    toolsets: 3,
    tools: 19,
    bytes: 10035,
    port: 5001,
    deployedAt: minutes(12),
    calls24h: 2314,
    top: null,
    draft: { toolsets: ["advising"], auth: { platform: true }, origins: ["https://a"], hosts: [] },
  };

  it("fills the list row, — where nothing was called", () => {
    expect(serverRow(s, "https://x/university/institution/mcp", 2, now)).toMatchObject({
      url: "https://x/university/institution/mcp",
      agents: 2,
      top: "—",
      deployedAgo: "12m",
      toolsetNames: ["advising"],
      origins: ["https://a"],
    });
    expect(serverRow({ ...s, deployedAt: null }, "", 0, now).deployedAgo).toBe("—");
  });
});

describe("activityView and feedRows", () => {
  it("prints call times and merges the feed newest first", () => {
    const at = new Date(2026, 10, 17, 9, 5, 1).toISOString();
    const v = activityView({
      calls: [{ at, tool: "t", agent: "a", user: "—", session: "—", status: "ok", ms: 3 }],
      log: ["09:05:01 INFO  x"],
      calls24h: 1,
      top: "t",
      spark: { calls: [1], top: [1] },
      byAgent: { a: 1 },
    });
    expect(v.calls[0]).toEqual({
      t: "09:05:01",
      tool: "t",
      agent: "a",
      user: "—",
      session: "—",
      status: "ok",
    });
    const rows = feedRows(
      [{ tag: "deploy", tone: "green", text: "institution rev 8", at: minutes(12), source: "TB" }],
      { at: minutes(180), terms: 14 },
      [{ name: "agentAI", server: "institution", connectedAt: minutes(1) }],
      now,
    );
    expect(rows).toEqual([
      { tag: "agent", tone: "gray", text: "agentAI connected to institution", when: "1m" },
      { tag: "deploy", tone: "green", text: "institution rev 8", when: "12m" },
      { tag: "compile", tone: "gray", text: "compiled · 14 terms", when: "3h" },
    ]);
  });
});
