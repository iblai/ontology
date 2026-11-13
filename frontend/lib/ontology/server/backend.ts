/**
 * Hosted mode (`ONTOLOGY_MULTI_PLATFORM=true`, no `ONTOLOGY_API_URL`): one Ontology Frontend
 * for every platform. A platform keeps its backend's address as a record, written by an
 * admin from "Connect a backend" (or by `ontology platform address` on the server); the
 * signed-in admin's DM token reads it, so the platform is the token's own and the browser
 * never names one.
 *
 * `ONTOLOGY_BACKEND_STORE=browser` is for platforms that keep no ontology records yet: each
 * admin's browser keeps the address and names it on every call, and this server uses it
 * once the address answers as a backend that takes the caller's sign-in. The platform is
 * not asked from here in that mode: its edge refuses calls that come from a hosting network.
 *
 * A backend installed with no platform is set up from Connect: it is sent the code of its
 * install's link and the platform chosen, and makes its own key with the caller's sign-in.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import config from "@/lib/iblai/config";

export const MULTI_PLATFORM =
  process.env.ONTOLOGY_MULTI_PLATFORM === "true" && !process.env.ONTOLOGY_API_URL;
/** The address is each browser's to keep and name, not a record of the platform. */
export const BROWSER_STORE = MULTI_PLATFORM && process.env.ONTOLOGY_BACKEND_STORE === "browser";
/** The header a browser names its platform's backend in. */
export const NAMED = "x-ontology-backend";

/** Where a caller's backend is, or the answer to give instead. */
export type Backend = { url: string } | { status: number; error: string };

/** A hosted action: done, or the one sentence that says why not. */
export type Answer<T> = ({ ok: true } & T) | { ok: false; message: string };

const RECORD = "/v1/ontology/kinds/backend/records/default";
const TTL_MS = 60_000;
const KEPT_MAX = 5_000;
const ANSWER_MS = 10_000;
// ponytail: one map per process, so a replaced address lasts a minute elsewhere; a shared cache if that hurts.
const kept = new Map<string, { at: number; backend: Backend }>();
// Per sign-in, and per address where the browser names one.
const keptAs = (authorization: string, named = "") =>
  createHash("sha256").update(`${authorization}\n${named}`).digest("hex");

/** Whether an address is one the open internet routes: not loopback, private or link-local. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = address.toLowerCase();
  // An IPv4 address in IPv6 clothes is judged as the IPv4 address it is.
  if (v6.startsWith("::ffff:")) return isIP(v6.slice(7)) === 4 && isPublicAddress(v6.slice(7));
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

/** The address, if this server may send a user's token there: https, and a public host. */
async function publicUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  // A developer's own machine, as `ontology platform address` takes it; never when deployed.
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (!local) {
    // ponytail: resolved here and again by fetch; pin the address if DNS rebinding matters.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const found = await lookup(host, { all: true }).catch(() => []);
    if (!found.length || !found.every(({ address }) => isPublicAddress(address))) return null;
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

async function ask(authorization: string): Promise<Backend> {
  let res: Response;
  try {
    res = await fetch(`${config.dmUrl()}${RECORD}`, {
      headers: { authorization },
      cache: "no-store",
      redirect: "manual",
    });
  } catch (e) {
    return { status: 502, error: `The ibl.ai platform did not answer: ${(e as Error).message}` };
  }
  if (res.status === 404) return { status: 404, error: "no_backend" };
  if (res.status === 401) return { status: 401, error: "not_signed_in" };
  // The record is its platform's admins' to read.
  if (res.status === 403) return { status: 403, error: "not_admin" };
  if (!res.ok) return { status: 502, error: `The ibl.ai platform answered ${res.status}.` };
  const record = (await res.json().catch(() => null)) as { data?: { url?: unknown } } | null;
  const address = record?.data?.url;
  const url = typeof address === "string" ? await publicUrl(address) : null;
  // An address only the platform's own network reaches is no backend from here.
  return url ? { url } : { status: 404, error: "bad_backend" };
}

/** What a server said in refusing, on one line. */
async function said(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).trim();
  try {
    const { error, detail } = JSON.parse(text) as { error?: unknown; detail?: unknown };
    if (typeof error === "string") return error;
    if (typeof detail === "string") return detail;
  } catch {}
  return text.replace(/\s+/g, " ").slice(0, 200) || `HTTP ${res.status}`;
}

type Refused = { status: number; error: string; message: string };

/** What Connect sends a backend to set itself up with: the platform chosen, and an install link's code. */
export type Setup = { platform?: string; code?: string };

/**
 * Have the backend at `url` set itself up, or say that it is: a fresh one takes the code of
 * its install's link and makes its own key with the caller's sign-in. Null when it is set up
 * for the caller's platform, or older than this and has no such route.
 */
async function setUp(authorization: string, url: string, setup: Setup): Promise<Refused | null> {
  const no = (status: number, message: string) => ({ status, error: message, message });
  let res: Response;
  try {
    res = await fetch(`${url}/setup`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ platform: setup.platform ?? "", code: setup.code ?? "" }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch (e) {
    return no(502, `No answer from ${url}: ${(e as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) return no(502, `The backend at ${url} could not be set up: ${await said(res)}`);
  const answer = (await res.json().catch(() => null)) as {
    ok?: unknown;
    message?: unknown;
  } | null;
  if (answer?.ok === true) return null;
  // The backend's own sentence: a wrong code, another platform's server, a platform not ready.
  return no(
    409,
    typeof answer?.message === "string" && answer.message
      ? answer.message
      : `The backend at ${url} did not say whether it is set up.`,
  );
}

/** `raw` as a backend that takes this sign-in: its address and platform, or the refusal as a code and in words. */
async function proved(
  authorization: string,
  raw: string,
  /** Connect alone: the backend sets itself up first, or says it is. */
  setup?: Setup,
): Promise<{ url: string; platform: string } | Refused> {
  const no = (status: number, message: string, error = message) => ({ status, error, message });
  const url = await publicUrl(raw.trim());
  if (!url)
    return no(
      404,
      "The address must be a public https one, such as https://ontology.example.edu.",
      "bad_backend",
    );
  if (setup) {
    const refused = await setUp(authorization, url, setup);
    if (refused) return refused;
  }
  let counts: Response;
  try {
    counts = await fetch(`${url}/counts`, {
      headers: { authorization },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch (e) {
    return no(502, `No answer from ${url}: ${(e as Error).message}`);
  }
  if (counts.status === 401 || counts.status === 403) {
    const words = `The backend at ${url} does not take your sign-in: ${await said(counts)}`;
    // A member the backend knows and does not let in is not its platform's admin.
    return no(counts.status, words, counts.status === 403 ? "not_admin" : words);
  }
  const answer = counts.ok ? ((await counts.json().catch(() => null)) as unknown) : null;
  const platform = (answer as { platform?: unknown } | null)?.platform;
  if (platform === "")
    return no(404, `The backend at ${url} was installed without a platform.`, "bad_backend");
  // A platform's key, and nothing that could not be sent as a header.
  if (typeof platform !== "string" || !/^[\w.-]+$/.test(platform))
    return no(404, `${url} did not answer as an ontology backend of this version.`, "bad_backend");
  return { url, platform };
}

/** The backend a browser names: taken once it answers as a backend that takes the caller's sign-in. */
async function claimed(authorization: string, named: string | null): Promise<Backend> {
  if (!named) return { status: 404, error: "no_backend_here" };
  // ponytail: anyone can have this server ask a public address for /counts; nothing is sent on until it proves itself.
  const found = await proved(authorization, named);
  return "url" in found ? { url: found.url } : { status: found.status, error: found.error };
}

/**
 * The backend of the caller's platform: its record, or the address the browser names where
 * browsers keep it. An address or a refused caller is asked once a minute per sign-in.
 */
export async function backendFor(
  authorization: string | null,
  named: string | null = null,
): Promise<Backend> {
  if (!authorization) return { status: 401, error: "not_signed_in" };
  const key = keptAs(authorization, BROWSER_STORE ? (named ?? "") : "");
  const now = Date.now();
  const held = kept.get(key);
  if (held && now - held.at < TTL_MS) return held.backend;
  const backend = BROWSER_STORE ? await claimed(authorization, named) : await ask(authorization);
  // Not kept: a platform that could not be asked, and "no backend yet", which connecting ends.
  if ("url" in backend || backend.status === 401 || backend.status === 403) {
    if (kept.size >= KEPT_MAX) for (const [k, v] of kept) if (now - v.at >= TTL_MS) kept.delete(k);
    kept.set(key, { at: now, backend });
  }
  return backend;
}

/**
 * Keep `raw` as the address of the caller's platform's backend, once it answers as that
 * backend: in the platform's record, or (`browser: true`) for the browser that asked to keep.
 * A backend installed with no platform is set up first, with the code in `setup`.
 */
export async function connectBackend(
  authorization: string | null,
  raw: string,
  setup: Setup = {},
): Promise<Answer<{ url: string; browser?: true }>> {
  const no = (message: string) => ({ ok: false as const, message });
  if (!authorization) return no("Sign in first.");
  // The record is asked before the address is, so only a platform's admin sends this server
  // anywhere. Where the browser keeps the address, the backend's own answer is the judge.
  const held = BROWSER_STORE ? null : await ask(authorization);
  if (held && "status" in held) {
    if (held.status === 401) return no("Your sign-in has ended: sign in again.");
    if (held.status === 403)
      return no("Only an administrator of this platform connects its backend.");
    if (held.status >= 500) return no(held.error);
  }

  const found = await proved(authorization, raw, setup);
  if (!("url" in found)) return no(found.message);
  const { url, platform } = found;
  if (BROWSER_STORE) {
    // Nothing is written: the browser keeps it, and the next call proves it again.
    kept.delete(keptAs(authorization, url));
    return { ok: true, url, browser: true };
  }

  let saved: Response;
  try {
    saved = await fetch(`${config.dmUrl()}${RECORD}`, {
      method: "PUT",
      // The backend's platform, so the ibl.ai platform refuses an address that is another's.
      headers: { authorization, "iblai-org": platform, "content-type": "application/json" },
      // Text, sent with its length: the platform answers 411 to a chunked body.
      body: JSON.stringify({ data: { url }, unique_key: null }),
      cache: "no-store",
      redirect: "manual",
    });
  } catch (e) {
    return no(`The ibl.ai platform did not answer: ${(e as Error).message}`);
  }
  if (!saved.ok) {
    const words = await said(saved);
    return no(
      saved.status === 403 && words.includes("iblai-org")
        ? `That backend belongs to the platform ${platform}, not to the one you are signed in to.`
        : `The ibl.ai platform did not keep the address: ${words}`,
    );
  }
  kept.delete(keptAs(authorization));
  return { ok: true, url };
}

/** Tests only. */
export function forgetBackends(): void {
  kept.clear();
}
