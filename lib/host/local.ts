// Filesystems: a folder or one file on the server's own disk, addressed local:///path, served
// by the gateway itself as the toolset <name>-files. Every rule is checked on every call.

import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { ontologyHome, ownPlatform } from "./env";
import { HostError } from "./errors";
import { homePath, readText, writeAtomic } from "./files";
import type {
  HostFolder,
  HostFolderEntry,
  HostLocal,
  HostLocalInput,
  HostTool,
  McpTool,
  McpToolResult,
} from "./types";

export const LOCAL_SCHEME = "local://";
export const FILES_SUFFIX = "-files";

/** A filesystem as kept in locals.yaml. */
export type StoredLocal = { name: string; path: string }; // path: the real path at save time

const NAME = /^[a-z][a-z0-9-]{0,52}$/;
const MAX_ENTRIES = 1000; // a listing stops here and says truncated
const LIMIT = 65536; // bytes a read answers by default
const LIMIT_MIN = 4; // one whole UTF-8 character
const LIMIT_MAX = 262144;

export const filesToolset = (name: string): string => `${name}${FILES_SUFFIX}`;

/** Whether a toolset's name is a filesystem's. Pure. */
export const isFilesToolset = (toolset: string): boolean =>
  toolset.endsWith(FILES_SUFFIX) && toolset.length > FILES_SUFFIX.length;

const nameOf = (toolset: string) => toolset.slice(0, -FILES_SUFFIX.length);
const toolNames = (toolset: string) => {
  const snake = nameOf(toolset).replaceAll("-", "_");
  return { list: `${snake}_list_files`, read: `${snake}_read_file` };
};

/** The two tools of a filesystem's toolset, as an MCP client lists them. Pure: no disk, no env. */
export function filesTools(toolset: string): McpTool[] {
  const { list, read } = toolNames(toolset);
  const where = `Paths are relative to the ${nameOf(toolset)} filesystem’s folder.`;
  return [
    {
      name: list,
      description: `Lists the files and folders in a folder, folders first. ${where}`,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The folder to list; leave out for the top." },
        },
      },
    },
    {
      name: read,
      description:
        `Reads a text file, a piece at a time. ${where} ` +
        "The answer’s next is the offset to ask for next, and is null at the end of the file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file to read." },
          offset: { type: "integer", description: "The byte to start at; 0 by default." },
          limit: {
            type: "integer",
            description: `Bytes to read, ${LIMIT_MIN} to ${LIMIT_MAX}; ${LIMIT} by default.`,
          },
        },
        required: ["path"],
      },
    },
  ];
}

/** The same two as the server builder lists them. Pure. */
export function filesNotes(toolset: string): HostTool[] {
  const { list, read } = toolNames(toolset);
  return [
    { name: list, sig: `${list}(path?)`, note: "→ files" },
    { name: read, sig: `${read}(path, offset?, limit?)`, note: "→ text" },
  ];
}

/** The folder nothing outside may be shared from: ONTOLOGY_LOCAL_ROOT, else the home folder. */
export async function localRoot(): Promise<string> {
  if (ownPlatform() === null) {
    throw new HostError(
      503,
      "A filesystem needs a server that serves one platform: set ONTOLOGY_PLATFORM.",
    );
  }
  const root = process.env.ONTOLOGY_LOCAL_ROOT || os.homedir();
  let real: string;
  try {
    real = await realpath(root);
  } catch {
    throw new HostError(503, `ONTOLOGY_LOCAL_ROOT names ${root}, which does not exist.`);
  }
  if (path.parse(real).root === real) {
    throw new HostError(503, "ONTOLOGY_LOCAL_ROOT is the whole disk: name a folder.");
  }
  return real;
}

const within = (real: string, folder: string) =>
  real === folder || real.startsWith(folder + path.sep);

// The real path of `full` if the root may share it; a plain Error in `given`'s words if not.
async function contained(root: string, full: string, given: string): Promise<string> {
  // ponytail: a hard link to a file outside is not seen; refusing st_nlink > 1 if it matters.
  let real: string;
  try {
    real = await realpath(full);
  } catch {
    throw new Error(`${given}: no such file or folder.`);
  }
  if (!within(real, root)) throw new Error(`${given} is outside the folder this server shares.`);
  if (
    path
      .relative(root, real)
      .split(path.sep)
      .some((part) => part.startsWith("."))
  ) {
    throw new Error(`${given} is hidden: a name that starts with a dot is never shared.`);
  }
  const home = await realpath(ontologyHome()).catch(() => null);
  if (home !== null && within(real, home)) throw new Error(`${given} is the server’s own folder.`);
  return real;
}

// A tool's path, confined to its source as checked against the current root.
async function inSource(source: string, given: string): Promise<string> {
  const root = await localRoot();
  const base = await contained(root, source, "This filesystem");
  // A filesystem that is one file answers for it under its own name too.
  if (given === path.basename(base) && (await stat(base)).isFile()) return base;
  const real = await contained(root, path.resolve(base, given), given || ".");
  if (!within(real, base)) throw new Error(`${given} leaves this filesystem.`);
  return real;
}

const asBad = (error: unknown) =>
  error instanceof HostError ? error : new HostError(400, (error as Error).message);

// One folder's entries, or the file itself when `real` is a file.
async function listing(real: string): Promise<{ entries: HostFolderEntry[]; truncated: boolean }> {
  const info = await lstat(real);
  if (info.isFile()) return { entries: [entry(path.basename(real), info)], truncated: false };
  const entries: HostFolderEntry[] = [];
  let truncated = false;
  const dir = await opendir(real);
  try {
    for await (const item of dir) {
      // Symlinks and special files are skipped, as rclone does by default.
      if (item.name.startsWith(".") || !(item.isFile() || item.isDirectory())) continue;
      if (entries.length === MAX_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push(entry(item.name, await lstat(path.join(real, item.name))));
    }
  } finally {
    await dir.close().catch(() => undefined);
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { entries, truncated };
}

const entry = (name: string, info: Stats): HostFolderEntry => ({
  name,
  dir: info.isDirectory(),
  size: info.isDirectory() ? 0 : Number(info.size),
  modified: info.mtime.toISOString(),
});

/** One folder under the root for the file picker; none is the root. Throws HostError 400. */
export async function browse(given?: string): Promise<HostFolder> {
  const root = await localRoot();
  try {
    const real = given ? await contained(root, path.resolve(root, given), given) : root;
    if (!(await stat(real)).isDirectory()) throw new Error(`${given} is not a folder.`);
    const { entries, truncated } = await listing(real);
    return {
      root,
      path: real,
      parent: real === root ? null : path.dirname(real),
      entries,
      truncated,
    };
  } catch (error) {
    throw asBad(error);
  }
}

/** Every filesystem in locals.yaml; an absent file is none. */
export async function listLocals(): Promise<StoredLocal[]> {
  const text = await readText(homePath("locals.yaml"));
  if (text === null) return [];
  const value: unknown = parse(text);
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HostError(500, "locals.yaml is not a list of filesystems.");
  return value as StoredLocal[];
}

/** Checks a filesystem and keeps it in locals.yaml, replacing its name. Throws HostError 400. */
export async function saveLocal(input: HostLocalInput): Promise<HostLocal> {
  if (!NAME.test(input.name)) {
    throw new HostError(
      400,
      "A filesystem’s name starts with a letter, then lowercase letters, digits or -, " +
        "53 characters at most.",
    );
  }
  const given = input.url.startsWith(LOCAL_SCHEME) ? input.url.slice(LOCAL_SCHEME.length) : "";
  if (!given.startsWith("/")) {
    throw new HostError(
      400,
      "A filesystem’s address is local:// and an absolute path, such as local:///srv/data.",
    );
  }
  const root = await localRoot();
  let real: string;
  try {
    real = await contained(root, given, given);
    const info = await stat(real);
    if (!info.isFile() && !info.isDirectory()) throw new Error(`${given} is not a file or folder.`);
  } catch (error) {
    throw asBad(error);
  }
  const local: StoredLocal = { name: input.name, path: real };
  const locals = await listLocals();
  const at = locals.findIndex((other) => other.name === local.name);
  const next = at < 0 ? [...locals, local] : locals.map((other, i) => (i === at ? local : other));
  await writeAtomic(homePath("locals.yaml"), stringify(next));
  return { name: local.name, url: LOCAL_SCHEME + real };
}

const answer = (value: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

function integer(
  args: Record<string, unknown>,
  field: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = args[field] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

// The end of the last whole UTF-8 character in buf[0, n); never 0.
function wholeEnd(buf: Buffer, n: number): number {
  let lead = n - 1;
  while (lead > 0 && (buf[lead] & 0xc0) === 0x80) lead--;
  const byte = buf[lead];
  const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
  return lead + length <= n || lead === 0 ? n : lead;
}

async function readPiece(real: string, given: string, offset: number, limit: number) {
  // ponytail: a parent folder swapped for a link after the check is followed (O_NOFOLLOW covers
  // the last name only); openat2 RESOLVE_BENEATH if someone untrusted can write in the folder.
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${given} is not a file.`);
    const buf = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buf, 0, limit, offset);
    if (buf.subarray(0, bytesRead).includes(0)) throw new Error(`${given} is not a text file.`);
    const atEnd = offset + bytesRead >= info.size;
    const kept = atEnd ? bytesRead : wholeEnd(buf, bytesRead);
    const text = buf.subarray(0, kept).toString("utf8");
    return { path: given, size: info.size, offset, next: atEnd ? null : offset + kept, text };
  } finally {
    await handle.close();
  }
}

/** Runs one of a filesystem's two tools. A refusal is a plain Error in the caller's words. */
export async function callLocal(
  toolset: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const name = nameOf(toolset);
  const source = (await listLocals()).find((local) => local.name === name);
  if (!source) throw new Error(`no filesystem named ${name}`);
  const { list, read } = toolNames(toolset);
  const given = args.path ?? "";
  if (typeof given !== "string") throw new Error("path is text.");
  try {
    if (tool === list) {
      const real = await inSource(source.path, given);
      const { entries, truncated } = await listing(real);
      return answer({
        path: given,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.dir ? "folder" : "file",
          size: e.size,
          modified: e.modified,
        })),
        truncated,
      });
    }
    if (tool === read) {
      const offset = integer(args, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = integer(args, "limit", LIMIT, LIMIT_MIN, LIMIT_MAX);
      const real = await inSource(source.path, given);
      return answer(await readPiece(real, given, offset, limit));
    }
  } catch (error) {
    // The disk's own failure carries the real path: an agent gets its code and the path it gave.
    if (error instanceof Error && "code" in error) {
      throw new Error(`${given || "."}: ${String(error.code)}`);
    }
    throw error;
  }
  throw new Error(`${toolset} has no tool named ${tool}.`);
}
