// The physical and semantic graphs and the compile status, from one reading of the engine.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { graphOf, readEngine } from "@/lib/host/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => json(graphOf(await readEngine())));
  } catch (error) {
    return fail(error);
  }
}
