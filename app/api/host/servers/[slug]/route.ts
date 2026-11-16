// One server: reading it, and saving its draft (and deploying it with `start`).

import { fail, HostError, json } from "@/lib/host/errors";
import { assertSlug } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import { readServer, saveServer } from "@/lib/host/servers";
import { draft, readBody } from "../../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return await asConsole(request, async () => {
      const server = await readServer(assertSlug((await params).slug));
      if (!server) throw new HostError(404, "No such server.");
      return json(server);
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    return await asConsole(request, async () => {
      const slug = assertSlug((await params).slug);
      const body = await readBody(request);
      if (typeof body.start !== "boolean") {
        throw new HostError(400, "“start” is not true or false.");
      }
      return json(await saveServer(slug, draft(body.draft), body.start));
    });
  } catch (error) {
    return fail(error);
  }
}
