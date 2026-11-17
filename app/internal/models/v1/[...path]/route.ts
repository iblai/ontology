// The engine's model calls, on loopback only: the proxy answers 404 for /internal/* from outside.

import { serveModel } from "@/lib/host/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return serveModel(request, (await params).path.join("/"));
}
