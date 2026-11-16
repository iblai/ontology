// The tools.yaml a draft would write, without writing it.

import { fail, json } from "@/lib/host/errors";
import { assertSlug } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import { previewServer } from "@/lib/host/servers";
import { draft, readBody, text } from "../../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await asConsole(request, async () => {
      const body = await readBody(request);
      return json(await previewServer(assertSlug(text(body, "slug")), draft(body.draft)));
    });
  } catch (error) {
    return fail(error);
  }
}
