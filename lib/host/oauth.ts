// OAuth 2.0 for a custom API: the host asks for a token, keeps it in memory and renews it.
// The token is never written to a file; its secrets are in the env file, the gateway's alone.

import { apiAddress } from "./address";
import { HostError } from "./errors";
import { envName, readEnv, setEnv } from "./files";
import { currentPlatform } from "./platform";
import type { HostApiOAuth } from "./types";

export type TokenAsk = {
  oauth: HostApiOAuth;
  baseUrl: string;
  clientSecret: string;
  refreshToken: string;
};

export type TokenAnswer = {
  token: string;
  seconds: number; // how long it lasts
  refreshToken: string | null; // the one to use next, when the answer gave one
};

type Kept = { token: string; until: number };
type Fetcher = typeof fetch;

const TIMEOUT_MS = 10_000;
// ponytail: checked after the whole answer is read, which the timeout bounds; a streamed cap if
// a token endpoint is ever hostile.
const CAP = 64 * 1024;
const MARGIN_MS = 60_000; // a token with less than this left is renewed
// ponytail: an answer without expires_in is trusted this long; a vendor's 401 drops it sooner.
const DEFAULT_S = 300;
const DAY_S = 86_400;

// "<platform>/<api>" → its token, the request under way, and how often its sign-in was
// forgotten; one set per process, as ./platform.
type Tokens = {
  kept: Map<string, Kept>;
  asking: Map<string, Promise<string>>;
  dropped: string[];
  forgotten?: Map<string, number>; // absent from a set made before it was added
};
const shared = globalThis as { ontologyApiTokens?: Tokens };
const none: Tokens = { kept: new Map(), asking: new Map(), dropped: [] };
const tokens = (shared.ontologyApiTokens ??= none);
const { kept, asking, dropped } = tokens;
const forgotten = (tokens.forgotten ??= new Map());

const keyOf = (api: string) => `${currentPlatform()}/${api}`;
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A token address in full: a path stands on the base URL's origin. HostError 400 otherwise. */
export function tokenUrlOf(tokenUrl: string, baseUrl: string): string {
  const typed = tokenUrl.trim();
  if (typed.startsWith("/")) return new URL(baseUrl).origin + typed;
  if (!URL.canParse(typed)) {
    throw new HostError(400, `“${tokenUrl}” is not a token address: one starts with https:// or /`);
  }
  return typed;
}

/**
 * One token request, as RFC 6749 writes it: a form, the client's ID and secret in a Basic header
 * or in the form. Throws Error in the token endpoint's own words, the secrets masked.
 */
export async function requestToken(ask: TokenAsk, fetcher: Fetcher = fetch): Promise<TokenAnswer> {
  const { oauth, clientSecret, refreshToken } = ask;
  const url = tokenUrlOf(oauth.tokenUrl, ask.baseUrl);
  await apiAddress(url);
  const form = new URLSearchParams({ grant_type: oauth.grant });
  if (oauth.grant === "refresh_token") form.set("refresh_token", refreshToken);
  if (oauth.scope) form.set("scope", oauth.scope);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (oauth.clientAuth === "basic") {
    const pair = Buffer.from(`${oauth.clientId}:${clientSecret}`).toString("base64");
    headers.authorization = `Basic ${pair}`;
  } else {
    form.set("client_id", oauth.clientId);
    if (clientSecret) form.set("client_secret", clientSecret);
  }

  const host = new URL(url).host;
  const hidden = [clientSecret, refreshToken].filter((secret) => secret.length >= 6);
  const hide = (text: string) =>
    hidden.reduce((t, secret) => t.split(secret).join("********"), text);
  let answer: Response;
  let text: string;
  try {
    answer = await fetcher(url, {
      method: "POST",
      headers,
      body: form.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await answer.text();
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new Error(hide(`${host} did not answer the sign-in: ${reason(cause)}`));
  }
  if (text.length > CAP) throw new Error(`${host} answered the sign-in with more than 64 KB.`);
  let said: Record<string, unknown> = {};
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) said = body as Record<string, unknown>;
  } catch {
    // not JSON: refused below, by its status
  }
  if (!answer.ok || typeof said.access_token !== "string" || !said.access_token) {
    const code = typeof said.error === "string" ? ` ${said.error.slice(0, 100)}` : "";
    // Hidden before it is cut: a secret across the cut would otherwise show in part.
    const why =
      typeof said.error_description === "string"
        ? `: ${hide(said.error_description).slice(0, 300)}`
        : "";
    throw new Error(`${hide(`${host} refused the sign-in (${answer.status}${code})`)}${why}`);
  }
  const type = said.token_type;
  if (typeof type === "string" && type.toLowerCase() !== "bearer") {
    throw new Error(
      `${host} answered a ${type.slice(0, 40)} token, and only a bearer token is sent.`,
    );
  }
  const given = Number(said.expires_in);
  return {
    token: said.access_token,
    seconds: Number.isFinite(given) && given > 0 ? Math.min(given, DAY_S) : DEFAULT_S,
    refreshToken:
      typeof said.refresh_token === "string" && said.refresh_token ? said.refresh_token : null,
  };
}

/**
 * The API's token for now: the one kept, or a new one when none is kept or it is about to end.
 * A refresh token the answer replaced is written back before the token is given.
 * Throws Error with the reason.
 */
export async function tokenFor(
  // since: forgetsOf(name) as it was before the API was read; a token asked for after a later
  // forget is not kept, being from settings that have changed.
  api: { name: string; baseUrl: string; oauth: HostApiOAuth; since?: number },
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const key = keyOf(api.name);
  const hit = kept.get(key);
  if (hit && hit.until - now() > MARGIN_MS) return hit.token;
  const under = asking.get(key);
  if (under) return under;
  const ask = (async () => {
    const since = api.since ?? forgotten.get(key) ?? 0;
    const env = await readEnv();
    const refreshEnv = envName(api.name, "OAUTH_REFRESH_TOKEN");
    const clientSecret = env[envName(api.name, "OAUTH_CLIENT_SECRET")] ?? "";
    const refreshToken = env[refreshEnv] ?? "";
    const answer = await requestToken(
      { oauth: api.oauth, baseUrl: api.baseUrl, clientSecret, refreshToken },
      fetcher,
    );
    if (answer.refreshToken && answer.refreshToken !== refreshToken) {
      // Only over the one just used: an admin may have saved another meanwhile.
      await setEnv(refreshEnv, answer.refreshToken, refreshToken);
    }
    // Forgotten while it was asked for, as when its sign-in changed: this call alone gets it.
    if ((forgotten.get(key) ?? 0) !== since) {
      retire(answer.token);
      return answer.token;
    }
    drop(key);
    kept.set(key, { token: answer.token, until: now() + answer.seconds * 1000 });
    return answer.token;
  })().finally(() => asking.delete(key));
  asking.set(key, ask);
  return ask;
}

/** How often the API's sign-in was forgotten, for tokenFor's `since`. */
export const forgetsOf = (api: string) => forgotten.get(keyOf(api)) ?? 0;

/** Drops the API's kept token: its sign-in changed, or the API refused the token. */
export function forget(api: string): void {
  const key = keyOf(api);
  forgotten.set(key, (forgotten.get(key) ?? 0) + 1);
  drop(key);
}

function drop(key: string): void {
  const hit = kept.get(key);
  if (!hit) return;
  kept.delete(key);
  retire(hit.token);
}

// A token no longer given out may still be valid: it stays masked.
function retire(token: string): void {
  dropped.push(token);
  // ponytail: the last 64 dropped; each ends by itself, and a restart forgets them all.
  if (dropped.length > 64) dropped.shift();
}

/** Every token kept or lately dropped, for masking an answer or a log line. */
export function liveTokens(): string[] {
  return [...[...kept.values()].map((entry) => entry.token), ...dropped];
}
