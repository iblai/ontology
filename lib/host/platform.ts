// The platform one call on the host is for. Every file and the engine it reaches are that
// platform's: homePath() and engine() read it from here, and refuse when there is none.

import { AsyncLocalStorage } from "node:async_hooks";
import { isPlatformKey } from "@/lib/platform";
import { ownPlatform } from "./env";
import { HostError } from "./errors";

// One store per process, on globalThis so a dev reload of this module keeps running calls in scope.
const shared = globalThis as { ontologyPlatform?: AsyncLocalStorage<string> };
const scope = (shared.ontologyPlatform ??= new AsyncLocalStorage<string>());

/** A platform key, or HostError 400. */
export function assertPlatform(key: unknown): string {
  if (!isPlatformKey(key)) throw new HostError(400, "That is not a platform’s key.");
  return key;
}

/** Throws unless this server serves `platform`: 403 for another's, 503 while it names none. */
export function assertServed(platform: string): void {
  const own = ownPlatform();
  if (own !== null && own !== platform) {
    throw new HostError(403, "This server serves another platform.");
  }
}

/** Runs `run` for one platform, awaited calls included. Only after ibl.ai confirmed the caller. */
export function inPlatform<T>(platform: string, run: () => T): T {
  return scope.run(assertPlatform(platform), run);
}

/** The platform this call is for. Throws outside inPlatform, so nothing is read for no one. */
export function currentPlatform(): string {
  const platform = scope.getStore();
  if (!platform) throw new HostError(500, "This call was made for no platform.");
  return platform;
}
