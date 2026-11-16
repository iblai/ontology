// A server installed from a link: whether a platform holds it, and the call that sets it up.

import { parseAuthorization, resolveCaller } from "@/lib/host/dm";
import { fail, HostError, json } from "@/lib/host/errors";
import { relay } from "@/lib/host/relay";
import { pending, setUp } from "@/lib/host/setup";
import type { HostSetup, HostSetupDone } from "@/lib/host/types";
import { isPlatformKey, PLATFORM_HEADER } from "@/lib/platform";
import { relaying } from "@/lib/server-address";
import { optionalText, readBody } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No sign-in: the installer and the console ask before anyone could hold one here.
export async function GET(request: Request) {
  try {
    if (relaying()) return await relay(request);
    const state: HostSetup = { set_up: !(await pending()) };
    return json(state);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    if (relaying()) return await relay(request);
    const platform = request.headers.get(PLATFORM_HEADER);
    if (!isPlatformKey(platform)) throw new HostError(400, "This call names no platform.");
    const authorization = request.headers.get("authorization");
    if (parseAuthorization(authorization)?.scheme !== "Token") {
      throw new HostError(401, "Sign in with ibl.ai.");
    }
    const code = optionalText(await readBody(request), "code");
    const caller = await resolveCaller(authorization, platform);
    const done: HostSetupDone = { ok: true, platform: await setUp(code, caller) };
    return json(done);
  } catch (error) {
    return fail(error);
  }
}
