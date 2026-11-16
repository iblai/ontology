// Every server with files on this host.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { listServers } from "@/lib/host/servers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => json(await listServers()));
  } catch (error) {
    return fail(error);
  }
}
