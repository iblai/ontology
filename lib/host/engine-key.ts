// The key for the server's own engine. Given one (AO_API_KEY) it is used; with none the server
// signs in to the engine as its admin, makes a key and keeps it in $ONTOLOGY_HOME/engine-key.

import { readFile, rm } from "node:fs/promises";
import { engineAdmin } from "./env";
import { HostError } from "./errors";
import { hostPath, readText, writeAtomic } from "./files";

const ANSWER_MS = 15_000;
const NO_KEY =
  "AO_API_KEY is not set, and neither are AO_ADMIN_EMAIL and AO_ADMIN_PASSWORD_FILE for this " +
  "server to make one.";

// One attempt at a time: every call that finds no key waits for the same sign-in.
let making: Promise<string> | null = null;

/** The key for the server's own engine at `url`: AO_API_KEY, else the kept one, else a new one. */
export async function engineKey(url: string): Promise<string> {
  if (process.env.AO_API_KEY) return process.env.AO_API_KEY;
  const kept = (await readText(hostPath("engine-key")))?.trim();
  if (kept) return kept;
  making ??= make(url).finally(() => {
    making = null;
  });
  return making;
}

/** Forgets the kept key if it is the one the engine refused, so the next call makes a new one. */
export async function dropEngineKey(refused: string): Promise<void> {
  const file = hostPath("engine-key");
  if ((await readText(file))?.trim() === refused) await rm(file, { force: true });
}

// As the script that first proved it: sign in with the origin the engine trusts, then make a key.
async function make(url: string): Promise<string> {
  const admin = engineAdmin(url);
  if (!admin) throw new HostError(503, NO_KEY);
  let password: string;
  try {
    password = (await readFile(admin.passwordFile, "utf8")).trim();
  } catch (error) {
    const why = (error as NodeJS.ErrnoException).code ?? "it cannot be read";
    throw new HostError(503, `AO_ADMIN_PASSWORD_FILE names ${admin.passwordFile}: ${why}.`);
  }
  if (!password) throw new HostError(503, "AO_ADMIN_PASSWORD_FILE names an empty file.");

  const headers = { "content-type": "application/json", origin: admin.origin };
  const signIn = await post(url, "/api/auth/sign-in/email", headers, {
    email: admin.email,
    password,
  });
  if (!signIn.ok) {
    throw new HostError(
      502,
      `The engine refused its admin’s sign-in (${signIn.status}): ` +
        `${await wordsOf(signIn, password)}. Check AO_ADMIN_EMAIL, AO_ADMIN_PASSWORD_FILE and ` +
        "AO_ORIGIN, which is the engine’s APP_URL.",
    );
  }
  const cookie = signIn.headers
    .getSetCookie()
    .map((kept) => kept.split(";")[0])
    .join("; ");
  if (!cookie) throw new HostError(502, "The engine signed its admin in without a session.");

  const session = { ...headers, cookie };
  const name = `ontology-server ${new Date().toISOString()}`;
  const made = await post(url, "/api/api-tokens", session, { name });
  if (!made.ok) {
    throw new HostError(
      502,
      `The engine made no key for this server (${made.status}): ${await wordsOf(made, password)}.`,
    );
  }
  const { token } = (await made.json().catch(() => ({}))) as { token?: unknown };
  if (typeof token !== "string" || !token) {
    throw new HostError(502, "The engine made a key for this server and did not return it.");
  }
  await writeAtomic(hostPath("engine-key"), `${token}\n`, 0o600);
  // The key is kept; a sign-out that fails leaves a session that expires by itself.
  await post(url, "/api/auth/sign-out", session, {}).catch(() => undefined);
  return token;
}

async function post(
  url: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  try {
    // No redirect is followed: the admin's sign-in goes to the configured address, nowhere else.
    return await fetch(`${url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new HostError(502, `The engine did not answer: ${reason}`);
  }
}

// The engine's own words for a refusal, never with the password it was sent.
async function wordsOf(response: Response, password: string): Promise<string> {
  const text = await response.text().catch(() => "");
  let words = "";
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") words = body.message;
    else if (typeof body.error === "string") words = body.error;
  } catch {
    // not JSON: the status says it
  }
  return (words || response.statusText || "no reason given")
    .replaceAll(password, "********")
    .replace(/\.$/, "");
}
