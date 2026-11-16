// Host settings, read from the process environment. A missing value is a 503 that names it.

import fs from "node:fs";
import path from "node:path";
import config from "@/lib/iblai/config";
import { HostError } from "./errors";

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new HostError(503, `${name} is not set.`);
  return value;
};

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
  return path.resolve(process.env.ONTOLOGY_HOME || ".ontology");
}

/**
 * The DM's address: ONTOLOGY_DM_URL, read as the server runs, else NEXT_PUBLIC_API_BASE_URL
 * (default https://api.iblai.app) + "/dm", which the build fixes.
 */
export function dmUrl(): string {
  return process.env.ONTOLOGY_DM_URL?.replace(/\/+$/, "") || config.dmUrl();
}

/** The code a server installed from a link is claimed with: ONTOLOGY_SETUP_CODE, else null. */
export function setupCode(): string | null {
  return process.env.ONTOLOGY_SETUP_CODE || null;
}

/** The host's own engine and its service key: AO_URL (no trailing slash) and AO_API_KEY. */
export function hostEngine(): { url: string; key: string } {
  return {
    url: required("AO_URL", process.env.AO_URL).replace(/\/+$/, ""),
    key: required("AO_API_KEY", process.env.AO_API_KEY),
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
