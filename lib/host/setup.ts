// A server installed from a link serves one platform: the one whose admin opened the link.
// The claim is $ONTOLOGY_HOME/engine-platform, the file that names the engine's platform.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import { isPlatformKey } from "@/lib/platform";
import type { Caller } from "./dm";
import { setupCode } from "./env";
import { HostError } from "./errors";
import { hostPath, readText } from "./files";

const NOT_SET_UP = "This server is not set up yet: open the link its installer printed.";
const ANOTHERS = "This server belongs to another platform.";
const UNNAMED = "The host’s engine-platform file names no platform.";

/** The platform that holds this host, or null when none has claimed it. */
export async function claimed(): Promise<string | null> {
  const named = await readText(hostPath("engine-platform"));
  if (named === null) return null;
  if (!isPlatformKey(named.trim())) throw new HostError(503, UNNAMED);
  return named.trim();
}

// Written aside and linked in: the claim is exclusive, and nobody reads it half written.
async function claim(platform: string): Promise<string> {
  const file = hostPath("engine-platform");
  await mkdir(hostPath(), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${platform}\n`, { flag: "wx", mode: 0o600 });
  try {
    await link(temp, file);
    return platform;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await rm(temp, { force: true });
  }
  const holder = await claimed();
  if (holder === null) throw new HostError(503, UNNAMED);
  return holder;
}

/**
 * The platform the host's own engine serves. With no setup code the first platform to ask claims
 * it; with one, only setUp does.
 */
export async function serves(platform: string): Promise<string> {
  const holder = await claimed();
  if (holder !== null) return holder;
  if (setupCode() !== null) throw new HostError(503, NOT_SET_UP);
  return claim(platform);
}

/** Whether this server waits for its installer's link: it has a setup code and no platform yet. */
export async function pending(): Promise<boolean> {
  return setupCode() !== null && (await claimed()) === null;
}

/** Throws unless this host serves `platform`. A host with no setup code serves any platform. */
export async function assertServes(platform: string): Promise<void> {
  if (setupCode() === null) return;
  const holder = await claimed();
  if (holder === null) throw new HostError(503, NOT_SET_UP);
  if (holder !== platform) throw new HostError(403, "This server serves another platform.");
}

const digest = (text: string) => createHash("sha256").update(text).digest();

/**
 * Sets the server up for the caller's platform with its installer's code: an administrator of
 * that platform only. Asking again for the platform that holds it changes nothing.
 */
export async function setUp(code: string, caller: Caller): Promise<string> {
  const own = setupCode();
  if (own === null) throw new HostError(404, "This host is not set up from a link.");
  if (!caller.admin) {
    throw new HostError(403, "Only an administrator of the platform can set this server up.");
  }
  const holder = await claimed();
  if (holder !== null) {
    if (holder === caller.platform) return holder;
    throw new HostError(409, ANOTHERS);
  }
  // Digests, so the comparison takes the same time whatever was sent.
  if (!timingSafeEqual(digest(code), digest(own))) {
    throw new HostError(
      403,
      "That is not this server’s code. Run the install command again to see its link.",
    );
  }
  if ((await claim(caller.platform)) !== caller.platform) throw new HostError(409, ANOTHERS);
  return caller.platform;
}
