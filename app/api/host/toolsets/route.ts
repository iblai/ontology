// The toolsets the host can offer a server.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { loadCatalog } from "@/lib/host/toolsets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => json((await loadCatalog()).toolsets));
  } catch (error) {
    return fail(error);
  }
}
