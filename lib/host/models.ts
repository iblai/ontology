// The model the engine calls: a loopback route that turns its calls into OpenAI's. The engine is
// told two fixed model names and sends three embedding fields OpenAI's API does not take.

import { createHash, timingSafeEqual } from "node:crypto";
import { modelKeyFile, openai } from "./env";
import { readText } from "./files";

// The engine's vector column is fixed at this width (vdb/postgres.py at the pinned commit).
const DIMENSIONS = 2048;
const NVIDIA_ONLY = new Set(["input_type", "truncate", "modality"]);
const RETURNED = ["content-type", "retry-after"];

type Body = Record<string, unknown>;
type Models = { model: string; embeddingModel: string };

// Each call as OpenAI takes it. No other path is served: for reranking the engine falls back.
const SERVED: Record<string, (body: Body, to: Models) => Body> = {
  "chat/completions": (body, to) => ({ ...body, model: to.model }),
  embeddings: (body, to) => ({
    ...Object.fromEntries(Object.entries(body).filter(([field]) => !NVIDIA_ONLY.has(field))),
    model: to.embeddingModel,
    dimensions: DIMENSIONS,
  }),
};

// An answer in OpenAI's error shape, which is what the engine's client reads.
const refuse = (status: number, message: string) =>
  Response.json({ error: { message, type: "invalid_request_error" } }, { status });

const digest = (text: string) => createHash("sha256").update(text).digest();

// Whether the caller holds the engine's model key; null when this server keeps none.
async function holdsKey(request: Request): Promise<boolean | null> {
  const file = modelKeyFile();
  const key = file ? (await readText(file))?.trim() : "";
  if (!key) return null;
  const sent = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  // Digests, so the comparison takes the same time whatever was sent.
  return timingSafeEqual(digest(sent.trim()), digest(key));
}

/** One model call from the engine, sent on to OPENAI_API_BASE_URL. `path` is what follows /v1/. */
export async function serveModel(request: Request, path: string): Promise<Response> {
  const held = await holdsKey(request);
  if (held === null) return refuse(404, "This server has no model route.");
  if (!held) return refuse(401, "That is not this server’s model key.");
  const translate = Object.hasOwn(SERVED, path) ? SERVED[path] : null;
  if (!translate) return refuse(404, `This server sends on chat and embedding calls, not ${path}.`);
  const { key, base, ...models } = openai();
  if (!key) return refuse(403, "No model is set on this server: its operator sets OPENAI_API_KEY.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "The request body is not JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return refuse(400, "The request body is not a JSON object.");
  }

  const host = URL.canParse(base) ? new URL(base).host : base;
  let answer: Response;
  try {
    answer = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(translate(body as Body, models)),
      // The key goes to the configured address, and nowhere that address sends us on to.
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const why = cause instanceof Error ? cause.message : String(cause);
    return refuse(502, `The model at ${host} did not answer (${why}).`);
  }
  if (answer.status >= 300 && answer.status < 400) {
    return refuse(502, `The model at ${host} answered with a redirect, which is not followed.`);
  }
  const returned = new Headers();
  for (const name of RETURNED) {
    const value = answer.headers.get(name);
    if (value) returned.set(name, value);
  }
  return new Response(answer.body, { status: answer.status, headers: returned });
}
