// Host settings, read from the process environment. A missing value is a 503 that names it.

import fs from "node:fs";
import path from "node:path";
import config from "@/lib/iblai/config";
import { isPlatformKey } from "@/lib/platform";
import { HostError } from "./errors";

// As @toolbox-sdk/server's bin/run.js names the package holding each platform's binary.
const RUNTIMES: Record<string, string> = {
  "darwin-arm64": "server-darwin-arm64",
  "darwin-x64": "server-darwin-x64",
  "linux-x64": "server-linux-x64",
  "win32-arm64": "server-win32-arm64",
  "win32-x64": "server-win32-x64",
};

/** Where the host keeps what the runtime reads: ONTOLOGY_HOME, default ".ontology" under cwd. */
export function ontologyHome(): string {
  // An empty value is the default too: the cwd itself would put secrets beside the source.
  // Chosen as the server runs: the build must not trace it, or it takes the whole repo.
  return path.resolve(/*turbopackIgnore: true*/ process.env.ONTOLOGY_HOME || ".ontology");
}

/**
 * The DM's address: ONTOLOGY_DM_URL, read as the server runs, else NEXT_PUBLIC_API_BASE_URL
 * (default https://api.iblai.app) + "/dm", which the build fixes.
 */
export function dmUrl(): string {
  return process.env.ONTOLOGY_DM_URL?.replace(/\/+$/, "") || config.dmUrl();
}

/** The one platform this server serves: ONTOLOGY_PLATFORM, else null. Required beside AO_URL. */
export function ownPlatform(): string | null {
  const named = process.env.ONTOLOGY_PLATFORM || null;
  if (named !== null && !isPlatformKey(named)) {
    throw new HostError(503, "ONTOLOGY_PLATFORM is not a platform’s key.");
  }
  if (named === null && process.env.AO_URL) {
    throw new HostError(
      503,
      "ONTOLOGY_PLATFORM is not set: it names the platform this server’s engine (AO_URL) belongs to.",
    );
  }
  return named;
}

/** Whether this server answers on its own machine only: ONTOLOGY_HOST is "localhost". */
export function localOnly(): boolean {
  return process.env.ONTOLOGY_HOST === "localhost";
}

/** The server's own engine without a trailing slash: AO_URL, else null. */
export function engineUrl(): string | null {
  return process.env.AO_URL?.replace(/\/+$/, "") || null;
}

/** The engine admin the server makes its key as: AO_ADMIN_EMAIL, AO_ADMIN_PASSWORD_FILE. */
export function engineAdmin(
  url: string,
): { email: string; passwordFile: string; origin: string } | null {
  const email = process.env.AO_ADMIN_EMAIL;
  const passwordFile = process.env.AO_ADMIN_PASSWORD_FILE;
  if (!email || !passwordFile) return null;
  // The engine's sign-in takes its own APP_URL as the origin, not the address it is called on.
  const origin = process.env.AO_ORIGIN || (URL.canParse(url) ? new URL(url).origin : url);
  return { email, passwordFile, origin: origin.replace(/\/+$/, "") };
}

/** The file with the key the engine presents on /internal/models/v1: ONTOLOGY_MODEL_KEY_FILE. */
export function modelKeyFile(): string | null {
  return process.env.ONTOLOGY_MODEL_KEY_FILE || null;
}

/** Where the engine's model calls are sent on: OPENAI_API_KEY (null: nowhere) and three more. */
export function openai(): {
  key: string | null;
  base: string;
  model: string;
  embeddingModel: string;
} {
  return {
    key: process.env.OPENAI_API_KEY || null,
    base: (process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
  };
}

/** The runtime binary: TOOLBOX_BIN, else the one @toolbox-sdk/server installed for this OS. */
export function toolboxBin(): string {
  if (process.env.TOOLBOX_BIN) return process.env.TOOLBOX_BIN;
  const key = `${process.platform}-${process.arch}`;
  const runtime = RUNTIMES[key];
  if (!runtime) throw new HostError(503, `The runtime has no build for ${key}: set TOOLBOX_BIN.`);
  const missing = `@toolbox-sdk/${runtime} is not installed: run pnpm install, or set TOOLBOX_BIN.`;
  let from: string;
  try {
    from = fs.realpathSync(path.join(process.cwd(), "node_modules", "@toolbox-sdk", "server"));
  } catch {
    throw new HostError(503, missing);
  }
  const name = process.platform === "win32" ? "toolbox.exe" : "toolbox";
  // As require.resolve from the package's real directory: each node_modules on the way up.
  for (let dir = from; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", "@toolbox-sdk", runtime, "bin", name);
    if (fs.existsSync(bin)) return bin;
    if (path.dirname(dir) === dir) throw new HostError(503, missing);
  }
}

/** The console's public origin without a trailing slash: NEXT_PUBLIC_APP_URL, else null. */
export function appUrl(): string | null {
  return config.appUrl() || null;
}
