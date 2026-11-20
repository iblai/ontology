// One folder under ONTOLOGY_LOCAL_ROOT, for the file picker.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { browse } from "@/lib/host/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () =>
      json(await browse(new URL(request.url).searchParams.get("path") || undefined)),
    );
  } catch (error) {
    return fail(error);
  }
}
