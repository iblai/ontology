// Whether a server answers here. No sign-in: the container, the installer and the console ask.

import { ownPlatform } from "@/lib/host/env";
import { fail, json } from "@/lib/host/errors";
import { relay } from "@/lib/host/relay";
import type { HostHealth } from "@/lib/host/types";
import { relaying } from "@/lib/server-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (relaying()) return await relay(request);
    // A server whose settings refuse every call is not healthy.
    ownPlatform();
    const health: HostHealth = { ok: true };
    return json(health);
  } catch (error) {
    return fail(error);
  }
}
