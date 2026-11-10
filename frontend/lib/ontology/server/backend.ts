/**
 * Hosted mode (`ONTOLOGY_MULTI_PLATFORM=true`, no `ONTOLOGY_API_URL`): one Ontology Frontend
 * for every platform. A backend records its own address in its platform
 * (`ontology platform address`); the signed-in admin's DM token reads it, so the platform
 * is the token's own and the browser never names one.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import config from "@/lib/iblai/config";

export const MULTI_PLATFORM =
  process.env.ONTOLOGY_MULTI_PLATFORM === "true" && !process.env.ONTOLOGY_API_URL;

/** Where a caller's backend is, or the answer to give instead. */
export type Backend = { url: string } | { status: number; error: string };

const RECORD = "/v1/ontology/kinds/backend/records/default";
const TTL_MS = 60_000;
const KEPT_MAX = 5_000;
// ponytail: one map per process; a shared cache if the frontend runs many instances.
const kept = new Map<string, { at: number; backend: Backend }>();

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
    /^ff/.test(v6)
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

/** The backend of the caller's platform; asked once a minute per token, a refusal included. */
export async function backendFor(authorization: string | null): Promise<Backend> {
  if (!authorization) return { status: 401, error: "not_signed_in" };
  const key = createHash("sha256").update(authorization).digest("hex");
  const now = Date.now();
  const held = kept.get(key);
  if (held && now - held.at < TTL_MS) return held.backend;
  const backend = await ask(authorization);
  // What the platform said is kept; that it could not be asked is not.
  if ("url" in backend || backend.status < 500) {
    if (kept.size >= KEPT_MAX) for (const [k, v] of kept) if (now - v.at >= TTL_MS) kept.delete(k);
    kept.set(key, { at: now, backend });
  }
  return backend;
}

/** Tests only. */
export function forgetBackends(): void {
  kept.clear();
}
