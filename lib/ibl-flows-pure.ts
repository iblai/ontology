// The pure half of lib/ibl-flows.ts: what it reads out of the platform's answers and how it
// undoes a connection that failed half way. No SDK and no store, so the tests load it alone.

import type { KeyRow } from "@/lib/view/types";
import { ALL_TOOLSETS, NAME, POLICY_PREFIX, ROOT } from "@/lib/ontology-rbac";
import { isPlatformKey } from "@/lib/platform";

/** The toolsets a policy's resources grant; the whole-toolsets resource or the root is `all`. */
export function readToolsets(resources: readonly string[]): { toolsets: string[]; all: boolean } {
  const names = new Set<string>();
  let all = false;
  for (const resource of resources) {
    const path = resource.endsWith("/") ? resource : `${resource}/`;
    // The root, or a parent of it, covers everything beneath, as in the DM.
    if (ROOT.startsWith(path) || path === ALL_TOOLSETS) {
      all = true;
      continue;
    }
    if (!path.startsWith(ALL_TOOLSETS)) continue;
    const name = path.slice(ALL_TOOLSETS.length, -1);
    if (NAME.test(name)) names.add(name);
  }
  return { toolsets: [...names].sort(), all };
}

/** Whether a role's actions hold `verb`; `*` is any run of characters, as in the DM. */
export function holds(actions: readonly string[] | undefined, verb: string): boolean {
  const escape = (part: string) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return (actions ?? []).some((action) =>
    new RegExp(`^${action.split("*").map(escape).join(".*")}$`).test(verb),
  );
}

/** The slug and `?agent=` label of a registration at `<appOrigin>/<platform>/<slug>/mcp`. */
export function matchRegistration(
  url: string,
  appOrigin: string,
  platform: string,
): { slug: string; label: string } | null {
  if (!isPlatformKey(platform)) return null;
  const prefix = `${appOrigin.replace(/\/+$/, "")}/${encodeURIComponent(platform)}/`;
  if (!url.startsWith(prefix)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const [slug, tail, ...more] = url.slice(prefix.length).split(/[?#]/)[0].split("/");
  if (!slug || tail !== "mcp" || more.length) return null;
  return { slug, label: parsed.searchParams.get("agent") ?? "" };
}

const safe = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** An agent's key name, `ontology-<slug>-<agent>`, in letters, digits and dashes only. */
export function keyNameFor(slug: string, agentName: string): string {
  const agent = safe(agentName).slice(0, 40).replace(/-+$/, "");
  return `ontology-${safe(slug) || "server"}-${agent || "agent"}`;
}

/** The settings write that adds a server: tool_slugs ∪ {"mcp"}, mcp_servers ∪ {id}, tools on. */
export function withServer(
  settings: unknown,
  serverId: number,
): { tool_slugs: string[]; can_use_tools: true; mcp_servers: number[] } {
  const s = (settings ?? {}) as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const tools = list(s.tool_slugs).length ? list(s.tool_slugs) : list(s.tools);
  const slugs = new Set<string>(["mcp"]);
  for (const t of tools) {
    const slug = t && typeof t === "object" ? (t as { slug?: unknown }).slug : t;
    if (typeof slug === "string" && slug) slugs.add(slug);
  }
  const servers = new Set<number>([serverId]);
  for (const v of list(s.mcp_servers)) {
    const id = Number(v && typeof v === "object" ? (v as { id?: unknown }).id : v);
    if (Number.isInteger(id)) servers.add(id);
  }
  return {
    tool_slugs: [...slugs].sort(),
    can_use_tools: true,
    mcp_servers: [...servers].sort((a, b) => a - b),
  };
}

/** An API key as the platform's detail read gives it. */
export type KeyDetail = {
  name: string;
  created: string | null;
  expires: string | null;
  policies?: { id: number; name?: string | null }[];
  groups?: { id: number; name?: string | null }[];
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** The keys that carry at least one ontology policy, as the Tokens table shows them. */
export function keyRows(keys: readonly KeyDetail[]): KeyRow[] {
  const names = (list: { name?: string | null }[] | undefined) =>
    (list ?? []).map((x) => x.name ?? "").filter(Boolean);
  return keys
    .filter((k) => names(k.policies).some((p) => p.startsWith(POLICY_PREFIX)))
    .map((k) => ({
      id: k.name,
      name: k.name,
      created: day(k.created),
      expires: day(k.expires),
      policies: names(k.policies),
      groups: names(k.groups),
    }));
}

/* ---------- errors ---------- */

/** The platform's own words out of a DRF body, which may arrive as JSON text. */
function words(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object") return words(parsed);
    } catch {
      // not JSON: the text is the reason
    }
    return value.trim();
  }
  if (Array.isArray(value)) return value.map(words).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("detail" in o) return words(o.detail);
    return Object.entries(o)
      .map(([k, v]) => [k, words(v)])
      .filter(([, w]) => w)
      .map(([k, w]) => (k === "non_field_errors" || k === "error" ? w : `${k}: ${w}`))
      .join("; ");
  }
  return value == null ? "" : String(value);
}

/** Why a call failed, in the platform's words; "" when it gave none. */
export function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as { status?: unknown; data?: unknown; error?: unknown };
    const said = words(o.data ?? o.error).slice(0, 400);
    if (said) return typeof o.status === "number" ? `${said} (HTTP ${o.status})` : said;
    if (typeof o.status === "number") return `HTTP ${o.status}, with no reason given`;
    return "";
  }
  return words(err).slice(0, 400);
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** "<step> failed: <why>.", or says plainly that the platform gave no reason. */
export function failed(step: string, err: unknown): string {
  const why = reason(err);
  if (!why) return `${step} failed, and the platform gave no reason.`;
  return sentence(`${step} failed: ${why}`);
}

/** What a later failure takes back. */
export type Undo = { what: string; run: () => Promise<unknown> };
/** One write; it returns how to take it back, if it can be. */
export type Step = { step: string; run: () => Promise<Undo | void> };

/** Runs the steps in order; when one fails, undoes the earlier ones in reverse and says so. */
export async function withUndo(steps: readonly Step[]): Promise<void> {
  const done: Undo[] = [];
  for (const { step, run } of steps) {
    try {
      const undo = await run();
      if (undo) done.push(undo);
    } catch (err) {
      const undone: string[] = [];
      const kept: string[] = [];
      for (const undo of done.reverse()) {
        try {
          await undo.run();
          undone.push(undo.what);
        } catch (failure) {
          kept.push(`${undo.what} (${reason(failure) || "no reason given"})`);
        }
      }
      let message = failed(step, err);
      if (undone.length) message += ` Undone: ${undone.join(", ")}.`;
      if (kept.length) message += ` Not undone, remove it on the platform: ${kept.join("; ")}.`;
      throw new Error(message);
    }
  }
}
