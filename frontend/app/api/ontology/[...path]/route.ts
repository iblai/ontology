import type { NextRequest } from "next/server";
import { configFromBackend, type BackendConfigPayload } from "@/lib/ontology/config-files";
import { backendFor, MULTI_PLATFORM } from "@/lib/ontology/server/backend";
import { route } from "@/lib/ontology/server/routes";

export const dynamic = "force-dynamic";

/**
 * Set → every call is forwarded there with the caller's token. Unset or empty → hosted mode
 * finds each caller's own backend (`ONTOLOGY_MULTI_PLATFORM`), else the in-memory mock answers.
 */
const UPSTREAM = process.env.ONTOLOGY_API_URL || undefined;
const FORWARDED = ["authorization", "content-type"];
const hasBody = (method: string) => method !== "GET" && method !== "DELETE";

async function forward(req: NextRequest, rest: string, base: string): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const relay = (upstream: Response) =>
    new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  // A backend its platform named may not send this server on to another address.
  const redirect = UPSTREAM ? "follow" : "manual";
  try {
    if (rest === "config") {
      // The backend sends its files as text; the page's summaries are made here.
      const sent = await fetch(`${base}/config`, { headers, cache: "no-store", redirect });
      if (!sent.ok) return relay(sent);
      return Response.json(configFromBackend((await sent.json()) as BackendConfigPayload));
    }
    const upstream = await fetch(`${base}/${rest}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody(req.method) ? await req.text() : undefined,
      cache: "no-store",
      redirect,
    });
    return relay(upstream);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

async function handle(req: NextRequest): Promise<Response> {
  const rest = req.nextUrl.pathname.slice("/api/ontology/".length);
  if (UPSTREAM) return forward(req, rest, UPSTREAM.replace(/\/$/, ""));
  if (MULTI_PLATFORM) {
    const backend = await backendFor(req.headers.get("authorization"));
    if ("url" in backend) return forward(req, rest, backend.url);
    return Response.json({ error: backend.error }, { status: backend.status });
  }
  const path = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const handler = route(req.method, path);
  if (!handler) return Response.json({ error: `No route ${req.method} /${rest}` }, { status: 404 });
  const body = hasBody(req.method) ? await req.json().catch(() => undefined) : undefined;
  return Response.json(handler(req.nextUrl.searchParams, body) ?? null);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
