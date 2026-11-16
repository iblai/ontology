// Who a caller is and what the ibl.ai platform grants them, asked with their own credential.
// The host holds no ibl.ai secret. Answers are kept in memory, keyed by the credential's hash
// and the platform. Ported from the old product's api/auth.py and identity/middleware.py.

import { createHash } from "node:crypto";
import { ROOT } from "@/lib/ontology-rbac";
import { dmUrl } from "./env";
import { HostError } from "./errors";
import { adminScope, reaches, scopeOf, type Grants, type Scope } from "./grants";
import { assertPlatform } from "./platform";

export type Scheme = "Token" | "Api-Token";

/** Who a session token or an API key belongs to, as the platform says. */
export type Member = { username: string; email: string; adminHere: boolean };

export type Caller = {
  platform: string; // the platform ibl.ai confirmed this credential for
  scheme: Scheme;
  subject: string; // "ibl:<username>", or "ibl-key:<12 hex>" for a key with no owner
  username: string | null;
  admin: boolean; // an active admin of that platform
  scope: Scope;
  hash: string; // sha256 of the credential, hex: the rate limiter's key, never the credential
};

const VERIFY_PATH = "/api/core/token/verify/";
const PLATFORMS_PATH = "/api/core/users/platforms/";
const GRANTS_PATH = "/v1/rbac/permissions/";
const ANSWER_MS = 10_000;
const MEMBER_MS = 300_000;
const GRANTS_MS = 60_000; // grants, a refusal of them, and "no owner"
// ponytail: 5,000 answers per map in this process, oldest dropped; a shared cache for several.
const KEPT_MAX = 5_000;

// What each scheme carries, in a refusal's words.
const KIND: Record<Scheme, string> = { Token: "token", "Api-Token": "API key" };
const SCHEMES: Record<string, Scheme | "Bearer"> = {
  token: "Token",
  "api-token": "Api-Token",
  bearer: "Bearer",
};

type Kept<T> = { until: number; value: T };
const members = new Map<string, Kept<Member>>();
const unowned = new Map<string, Kept<true>>();
const grantsKept = new Map<string, Kept<{ grants: Grants } | { refused: string }>>();

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// One credential never shares a kept answer across platforms: the platform is part of the key.
const keyOf = (scheme: Scheme, credential: string, platform: string) =>
  `${sha256(`${scheme} ${credential}`)} ${platform}`;

function recall<T>(map: Map<string, Kept<T>>, key: string): T | undefined {
  const kept = map.get(key);
  if (kept && kept.until > Date.now()) return kept.value;
  map.delete(key);
  return undefined;
}

function keep<T>(map: Map<string, Kept<T>>, key: string, value: T, ms: number): void {
  map.delete(key);
  map.set(key, { until: Date.now() + ms, value });
  const oldest = map.keys().next();
  if (map.size > KEPT_MAX && !oldest.done) map.delete(oldest.value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A refusal by the platform: the credential is no good here. Distinct from its silence (503).
const refused = (message: string) => new HostError(401, message);
const isRefusal = (error: unknown): error is HostError =>
  error instanceof HostError && error.status === 401;

/** One GET to the DM with the caller's credential; silence (no answer, 5xx, 429) is a 503. */
async function ask(
  path: string,
  scheme: Scheme,
  credential: string,
  unavailable: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = dmUrl() + path;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `${scheme} ${credential}`, ...headers },
      signal: AbortSignal.timeout(ANSWER_MS),
      cache: "no-store",
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new HostError(503, `${unavailable}: ${why}`);
  }
  // 429: the platform throttles this call, which says nothing about the credential.
  if (res.status >= 500 || res.status === 429) {
    throw new HostError(503, `${unavailable}: the platform answered ${res.status}`);
  }
  return res;
}

async function getJson(path: string, scheme: Scheme, credential: string, what: string) {
  const unavailable = `${what} verification unavailable`;
  const res = await ask(path, scheme, credential, unavailable);
  if (res.status !== 200) throw refused(`${what} rejected.`);
  return res.json().catch(() => {
    throw new HostError(503, `${unavailable}: the platform’s answer is not JSON`);
  }) as Promise<unknown>;
}

/** What the platform said when it refused: its `detail`, or the start of its answer. */
async function words(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let said: unknown;
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body)) said = body.detail;
  } catch {
    // not JSON: the text itself is what it said
  }
  if (said) return typeof said === "string" ? said : JSON.stringify(said);
  return text.slice(0, 200) || `HTTP ${res.status}`;
}

async function askPlatform(scheme: Scheme, credential: string, platform: string): Promise<Member> {
  const what = scheme === "Token" ? "DM token" : "API key";
  const user = await getJson(VERIFY_PATH, scheme, credential, what);
  if (!isRecord(user)) throw refused(`${what} rejected.`);
  const username = typeof user.username === "string" ? user.username : "";
  if (!username) throw refused(`${what} response has no username.`);
  // The DM answers a user about their own memberships with the credential alone.
  const query = new URLSearchParams({ username });
  const memberships = await getJson(
    `${PLATFORMS_PATH}?${query}`,
    scheme,
    credential,
    "Platform memberships",
  );
  if (!Array.isArray(memberships)) throw refused("Platform memberships rejected.");
  return {
    username,
    email: typeof user.email === "string" ? user.email : "",
    adminHere: memberships.some(
      (m) =>
        isRecord(m) && m.username === username && !!m.active && !!m.is_admin && m.key === platform,
    ),
  };
}

/** The caller's grants on `platform`, refused unless it is the credential's own. Kept 60 s. */
export async function platformGrants(
  scheme: Scheme,
  credential: string,
  platform: string,
): Promise<Grants> {
  const key = keyOf(scheme, credential, platform);
  let kept = recall(grantsKept, key);
  if (!kept) {
    const query = new URLSearchParams({ resource_paths: ROOT, recursive: "true" });
    const res = await ask(`${GRANTS_PATH}?${query}`, scheme, credential, "Grants unavailable", {
      "iblai-org": platform,
    });
    if (res.status !== 200) kept = { refused: await words(res) };
    else {
      const body: unknown = await res.json().catch(() => null);
      if (!isRecord(body)) {
        throw new HostError(503, "Grants unavailable: the platform’s answer is no map");
      }
      kept = { grants: body as Grants };
    }
    keep(grantsKept, key, kept, GRANTS_MS);
  }
  if ("refused" in kept) throw refused(kept.refused);
  return kept.grants;
}

/** Who the credential belongs to; null for an API key limited to its own policies. */
export async function platformOwner(
  scheme: Scheme,
  credential: string,
  platform: string,
): Promise<Member | null> {
  const key = keyOf(scheme, credential, platform);
  if (recall(unowned, key)) return null;
  const known = recall(members, key);
  if (known) return known;
  try {
    const member = await askPlatform(scheme, credential, platform);
    keep(members, key, member, MEMBER_MS);
    return member;
  } catch (error) {
    if (!isRefusal(error)) throw error;
    keep(unowned, key, true, GRANTS_MS);
    return null;
  }
}

/** The scheme and credential of an Authorization header, or null when it carries none. */
export function parseAuthorization(
  header: string | null,
): { scheme: Scheme | "Bearer"; credential: string } | null {
  const value = header ?? "";
  const cut = value.indexOf(" ");
  const word = value.slice(0, Math.max(cut, 0)).toLowerCase();
  const scheme = Object.hasOwn(SCHEMES, word) ? SCHEMES[word] : undefined;
  const credential = cut > 0 ? value.slice(cut + 1).trim() : "";
  return scheme && credential ? { scheme, credential } : null;
}

/** The schemes a credential is tried under, in order: Bearer is a token, then an API key. */
export function schemesFor(scheme: Scheme | "Bearer"): Scheme[] {
  return scheme === "Bearer" ? ["Token", "Api-Token"] : [scheme];
}

/**
 * The caller behind an Authorization header on `platform`: `Token`, `Api-Token`, or `Bearer`
 * tried as both. 401 without a usable credential of that platform, 403 with no ontology grant,
 * 503 when the platform is silent.
 */
export async function resolveCaller(
  authorization: string | null,
  platform: string,
): Promise<Caller> {
  assertPlatform(platform);
  const given = parseAuthorization(authorization);
  if (!given) throw new HostError(401, "Authentication required.");
  const { credential } = given;
  const said: Partial<Record<Scheme, string>> = {};
  for (const scheme of schemesFor(given.scheme)) {
    let grants: Grants;
    try {
      grants = await platformGrants(scheme, credential, platform);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      said[scheme] = error.message;
      continue;
    }
    const who = await platformOwner(scheme, credential, platform);
    const hash = sha256(credential);
    const held = scopeOf(grants);
    const scope = who?.adminHere ? adminScope(held) : held;
    if (!reaches(scope)) {
      throw new HostError(403, "This credential holds no ontology grant on this platform.");
    }
    return {
      platform,
      scheme,
      // Never the key: twelve characters of its hash tell one key's calls from another's.
      subject: who ? `ibl:${who.username}` : `ibl-key:${hash.slice(0, 12)}`,
      username: who?.username ?? null,
      admin: !!who?.adminHere,
      scope,
      hash,
    };
  }
  throw new HostError(
    401,
    given.scheme === "Bearer"
      ? `The ibl.ai platform refused it as a token (${said.Token}) and as an API key (${said["Api-Token"]}).`
      : `The ibl.ai platform refused this ${KIND[given.scheme]}: ${said[given.scheme]}`,
  );
}
