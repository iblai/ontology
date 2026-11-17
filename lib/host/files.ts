// The host's files under ONTOLOGY_HOME: safe paths, atomic writes, and the secrets env.
//
//   engine-key                    the key the server made for its own engine, 0600 (hostPath)
//   platforms/<folder>/           one platform's files (homePath); <folder>: platformFolder
//     engine.json                 {"url","key"}: the platform's own engine, the operator's
//     env                         KEY=value lines, mode 0600: what the runtime's ${KEY} reads
//     labels.json                 what admins call their systems, by database name
//     apis.yaml                   custom HTTP APIs
//     actions.yaml                hand-written write tools, optional
//     servers/<slug>/tools.yaml   the config the runtime loads
//     servers/<slug>/flags.json   the draft, the revision counter, enabled, the port
//     servers/<slug>/revisions/   <n>-<id>.yaml, one per save
//     servers/<slug>/pid          the runtime's process id
//     servers/<slug>/toolbox.log  the runtime's own output
//     servers/<slug>/gateway.log  what the gateway saw, one JSON object per line

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ontologyHome } from "./env";
import { HostError } from "./errors";
import { currentPlatform } from "./platform";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const API_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
// Names the console's own routes take: the page /mcp/new and /api/host/servers/preview.
const RESERVED = new Set(["new", "preview"]);

/** A server's slug, as it appears in /<platform>/<slug>/mcp; refuses names the console takes. */
export function assertSlug(slug: string): string {
  if (!SLUG.test(slug)) {
    throw new HostError(
      400,
      "A server’s name is lowercase letters, digits and -, starting with a letter or digit, " +
        "63 characters at most.",
    );
  }
  if (RESERVED.has(slug)) {
    throw new HostError(400, `The console itself uses “${slug}”: choose another name.`);
  }
  return slug;
}

/** A custom API's name: starts with a letter, then lowercase letters, digits or -. */
export function assertName(name: string): string {
  if (!API_NAME.test(name)) {
    throw new HostError(
      400,
      "An API’s name starts with a letter, then lowercase letters, digits or -, " +
        "63 characters at most.",
    );
  }
  return name;
}

/** A name safe for a source, a toolset and a file: lowercase, runs of other characters as -. */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new HostError(400, `“${name}” has no letter or digit to be named by.`);
  return slug;
}

/** A platform's folder: its key, each character but a-z 0-9 - _ as ~<hex>~ ("Acme" → "~41~cme"). */
export function platformFolder(key: string): string {
  return key.replace(/[^a-z0-9_-]/g, (c) => `~${c.codePointAt(0)!.toString(16)}~`);
}

// A path under `root`, or HostError 400 if the parts would leave it.
function inside(root: string, parts: string[], what: string): string {
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new HostError(400, `That path leaves ${what}.`);
  }
  return full;
}

/** A host-wide path, directly under ONTOLOGY_HOME. Throws HostError 400 if the parts leave it. */
export function hostPath(...parts: string[]): string {
  return inside(ontologyHome(), parts, "the host’s folder");
}

/** A path in the current platform's folder. Throws HostError 400 if the parts leave it. */
export function homePath(...parts: string[]): string {
  const folder = hostPath("platforms", platformFolder(currentPlatform()));
  return inside(folder, parts, "the platform’s folder");
}

/** The file's text, or null when there is no such file. */
export async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Writes through a temporary file and a rename, creating the directory. */
export async function writeAtomic(file: string, text: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { mode: mode ?? 0o666 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The secrets env as a map. Never logged, never sent to a browser. */
export async function readEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const line of ((await readText(homePath("env"))) ?? "").split("\n")) {
    const cut = line.indexOf("=");
    const name = line.slice(0, cut);
    if (cut > 0 && ENV_NAME.test(name)) env[name] = line.slice(cut + 1);
  }
  return env;
}

// ponytail: one queue per process for the env and the labels, so two writes never lose each
// other; a file lock for two processes.
let envQueue: Promise<unknown> = Promise.resolve();

/** Sets one secret in the env file (0600), keeping the others. */
export async function setEnv(name: string, value: string): Promise<void> {
  if (!ENV_NAME.test(name)) {
    throw new HostError(400, `${name} is not an env name: capitals, digits and _, capital first.`);
  }
  if (/[\r\n]/.test(value)) {
    throw new HostError(
      400,
      `The value of ${name} holds a line break: the env file keeps one line.`,
    );
  }
  const write = envQueue.then(async () => {
    const env = { ...(await readEnv()), [name]: value };
    const text = Object.entries(env)
      .map(([key, kept]) => `${key}=${kept}\n`)
      .join("");
    await writeAtomic(homePath("env"), text, 0o600);
  });
  envQueue = write.catch(() => undefined);
  await write;
}

/** What admins call their systems, by the database's name; a system without one is not in it. */
export async function readLabels(): Promise<Record<string, string>> {
  const text = await readText(homePath("labels.json"));
  if (text === null) return {};
  const found: unknown = JSON.parse(text);
  if (typeof found !== "object" || found === null) return {};
  return Object.fromEntries(
    Object.entries(found).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Keeps a system's label; an empty one, or the name itself, forgets it. */
export async function setLabel(name: string, label: string): Promise<void> {
  const write = envQueue.then(async () => {
    const labels = await readLabels();
    const before = labels[name];
    if (label && label !== name) labels[name] = label;
    else delete labels[name];
    if (labels[name] === before) return;
    await writeAtomic(homePath("labels.json"), `${JSON.stringify(labels, null, 2)}\n`);
  });
  envQueue = write.catch(() => undefined);
  await write;
}

/** The env name for a system's password or an API's key: "sis-eu" → "SIS_EU_DB_PASSWORD". */
export function envName(name: string, suffix: "DB_PASSWORD" | "API_KEY"): string {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  // An env name starts with a letter; a database's name may start with a digit.
  return `${/^[A-Z]/.test(upper) ? upper : `X${upper}`}_${suffix}`;
}
