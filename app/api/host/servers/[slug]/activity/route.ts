// What the gateway saw for one server: calls, counters, sparklines and the log tail.

import { fail, json } from "@/lib/host/errors";
import { assertSlug } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import { activity } from "@/lib/host/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return await asConsole(request, async () =>
      json(await activity(assertSlug((await params).slug))),
    );
  } catch (error) {
    return fail(error);
  }
}
