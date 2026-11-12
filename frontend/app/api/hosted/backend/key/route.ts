import type { NextRequest } from "next/server";
import { backendKey, MULTI_PLATFORM } from "@/lib/ontology/server/backend";

export const dynamic = "force-dynamic";

/** A key for the backend to hold, made in the caller's name and answered this once. */
export async function POST(req: NextRequest): Promise<Response> {
  if (!MULTI_PLATFORM) return Response.json({ error: "Not a hosted console" }, { status: 404 });
  return Response.json(await backendKey(req.headers.get("authorization")));
}
