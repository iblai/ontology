// The newest deploys across every server, for the dashboard.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { deployEvents } from "@/lib/host/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => json(await deployEvents(20)));
  } catch (error) {
    return fail(error);
  }
}
