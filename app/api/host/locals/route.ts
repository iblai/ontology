// Filesystems: the ones in locals.yaml, and adding one.

import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { LOCAL_SCHEME, listLocals, saveLocal } from "@/lib/host/local";
import type { HostLocal } from "@/lib/host/types";
import { localInput, readBody } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => {
      const locals: HostLocal[] = (await listLocals()).map(({ name, path }) => ({
        name,
        url: LOCAL_SCHEME + path,
      }));
      return json(locals);
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return await asConsole(request, async () =>
      json(await saveLocal(localInput(await readBody(request)))),
    );
  } catch (error) {
    return fail(error);
  }
}
