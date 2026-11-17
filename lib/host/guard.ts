// The first line of every /api/host/* handler.

import { isPlatformKey, PLATFORM_HEADER } from "@/lib/platform";
import { relaying } from "@/lib/server-address";
import { parseAuthorization, resolveCaller, type Caller } from "./dm";
import { HostError } from "./errors";
import { assertServed, inPlatform } from "./platform";
import { relay } from "./relay";

const CLOSED = "Admin access to ibl.ai/ontology is required.";

/**
 * Runs `run` as the signed-in console user of the platform the request names, inside that
 * platform. A console that serves pages only hands the call to the platform's own server instead.
 */
export async function asConsole(
  request: Request,
  run: (caller: Caller) => Response | Promise<Response>,
): Promise<Response> {
  if (relaying()) return relay(request);
  const platform = request.headers.get(PLATFORM_HEADER);
  if (!isPlatformKey(platform)) throw new HostError(400, "This call names no platform.");
  assertServed(platform);
  const caller = await requireConsole(request, platform);
  return inPlatform(platform, () => run(caller));
}

/**
 * The signed-in console user. Takes `Authorization: Token <dm_token>` only, and only a caller
 * the console is open to: an admin of `platform`, or a holder of the console grant there.
 * Throws HostError 401 / 403 / 503.
 */
async function requireConsole(request: Request, platform: string): Promise<Caller> {
  const authorization = request.headers.get("authorization");
  if (parseAuthorization(authorization)?.scheme !== "Token") {
    throw new HostError(401, "Sign in with ibl.ai.");
  }
  let caller: Caller;
  try {
    caller = await resolveCaller(authorization, platform);
  } catch (error) {
    // A token that reaches nothing in the ontology is closed out of the console the same way.
    if (error instanceof HostError && error.status === 403) throw new HostError(403, CLOSED);
    throw error;
  }
  if (!caller.admin && !caller.scope.console) throw new HostError(403, CLOSED);
  return caller;
}
