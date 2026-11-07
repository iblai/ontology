import type { NextRequest } from "next/server";
import { readBackendConfig } from "@/lib/ontology/config-files";
import { route } from "@/lib/ontology/server/routes";

export const dynamic = "force-dynamic";

/** Unset or empty → the in-memory mock; set → every call is forwarded there with the caller's headers. */
const UPSTREAM = process.env.ONTOLOGY_API_URL || undefined;
const FORWARDED = ["authorization", "x-edx-jwt", "content-type"];
const hasBody = (method: string) => method !== "GET" && method !== "DELETE";

async function handle(req: NextRequest): Promise<Response> {
  const rest = req.nextUrl.pathname.slice("/api/ontology/".length);
  if (UPSTREAM) {
    if (rest === "config") return Response.json(readBackendConfig());
    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    try {
      const upstream = await fetch(`${UPSTREAM.replace(/\/$/, "")}/${rest}${req.nextUrl.search}`, {
        method: req.method,
        headers,
        body: hasBody(req.method) ? await req.text() : undefined,
        cache: "no-store",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  const path = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const handler = route(req.method, path);
  if (!handler) return Response.json({ error: `No route ${req.method} /${rest}` }, { status: 404 });
  const body = hasBody(req.method) ? await req.json().catch(() => undefined) : undefined;
  return Response.json(handler(req.nextUrl.searchParams, body) ?? null);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
