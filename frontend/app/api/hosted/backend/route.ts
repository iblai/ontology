import type { NextRequest } from "next/server";
import { backendFor, connectBackend, MULTI_PLATFORM, NAMED } from "@/lib/ontology/server/backend";

export const dynamic = "force-dynamic";

const notHosted = () => Response.json({ error: "Not a hosted console" }, { status: 404 });

/** Where the caller's platform keeps its backend, or the browser names it; `reason` says why there is none. */
export async function GET(req: NextRequest): Promise<Response> {
  if (!MULTI_PLATFORM) return notHosted();
  const backend = await backendFor(req.headers.get("authorization"), req.headers.get(NAMED));
  return Response.json(
    "url" in backend ? { url: backend.url } : { url: null, reason: backend.error },
  );
}

/** Connect the caller's platform to the backend at `url`; a refusal is `{ok: false, message}`. */
export async function PUT(req: NextRequest): Promise<Response> {
  if (!MULTI_PLATFORM) return notHosted();
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  return Response.json(await connectBackend(req.headers.get("authorization"), url));
}
