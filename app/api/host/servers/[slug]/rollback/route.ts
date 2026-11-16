// Putting a server's previous revision back.

import { fail, json } from "@/lib/host/errors";
import { assertSlug } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import { rollbackServer } from "@/lib/host/servers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return await asConsole(request, async () =>
      json(await rollbackServer(assertSlug((await params).slug))),
    );
  } catch (error) {
    return fail(error);
  }
}
