// The servers on this host: their files under servers/<slug>/ and the steps of a save.

import { readdir, rm, stat } from "node:fs/promises";
import { HostError } from "./errors";
import { assertSlug, homePath, readText, writeAtomic } from "./files";
import { record, stats } from "./log";
import { currentPlatform } from "./platform";
import { SEMANTIC_TOOLS, SEMANTIC_TOOLSET } from "./semantic";
import { confirmLoaded, launchChanged, start as startRuntime, status, stop } from "./toolbox";
import {
  MARK,
  members,
  parseConfig,
  renderConfig,
  validateDocs,
  writingToolsets,
  type ToolboxDoc,
} from "./toolbox-config";
import { loadCatalog, serverDocs } from "./toolsets";
import type {
  HostPreview,
  HostRevision,
  HostServer,
  HostServerDetail,
  HostServerDraft,
} from "./types";

/** What the gateway needs on every call. */
export type Serving = {
  draft: HostServerDraft;
  members: Record<string, string[]>; // toolset → tool names, from tools.yaml
  writes: string[]; // toolsets that hold a tool that writes
};

/** flags.json: what the builder saved, the current revision, and whether it is deployed. */
export type Flags = {
  draft: HostServerDraft;
  revision: number;
  enabled: boolean;
  port: number | null; // the port of the last deploy
  deployedAt: string | null;
};

type Members = Record<string, string[]>;
type RevisionFile = { n: number; id: string; base: string };

const path = (slug: string, ...parts: string[]) => homePath("servers", slug, ...parts);
const title = (slug: string, n: number) => `${slug} · rev ${n}`;
// The platform goes into the file's mark, unprinted: the same draft elsewhere is another runtime.
const render = (docs: ToolboxDoc[], slug: string, n: number) =>
  renderConfig(docs, title(slug, n), currentPlatform());
const REVISION = /^(\d+)-([0-9a-f]{12})\.yaml$/;

// Parsed tools.yaml per file path, kept until the file changes.
const parsed = new Map<string, { key: string; members: Members; writes: string[] }>();

/** Every server with files on this host, by slug. */
export async function listServers(): Promise<HostServer[]> {
  const entries = await readdir(homePath("servers"), { withFileTypes: true }).catch(absent([]));
  const all = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => summary(e.name)));
  return all.filter((server): server is HostServer => server !== null);
}

/** One server, or null when there is none. */
export async function readServer(slug: string): Promise<HostServerDetail | null> {
  assertSlug(slug);
  const head = await summary(slug);
  if (!head) return null;
  const yaml = (await readText(path(slug, "tools.yaml"))) ?? "";
  const revisions = await Promise.all((await revisionFiles(slug)).map((r) => describe(slug, r)));
  return { ...head, yaml, revisions };
}

/** The config a draft would write, without writing it. */
export async function previewServer(slug: string, draft: HostServerDraft): Promise<HostPreview> {
  assertSlug(slug);
  checkDraft(draft);
  const docs = serverDocs(await loadCatalog(), draft);
  validateDocs(docs);
  const next = ((await revisionFiles(slug))[0]?.n ?? 0) + 1;
  const { yaml } = render(docs, slug, next);
  return { yaml, ...count(withSemantic(members(docs), draft)) };
}

/**
 * Builds the draft's documents from what the host can offer, validates them, and writes
 * tools.yaml, flags.json and a new revision. With `start` the server is deployed: the runtime
 * is brought up on the file (restarted when origins or hosts changed) and the save only
 * succeeds once the runtime answers for the file's mark.
 */
export async function saveServer(
  slug: string,
  draft: HostServerDraft,
  start: boolean,
): Promise<HostServerDetail> {
  assertSlug(slug);
  checkDraft(draft);
  const docs = serverDocs(await loadCatalog(), draft);
  validateDocs(docs);
  const [prev, before, revisions] = await Promise.all([
    readFlags(slug),
    readText(path(slug, "tools.yaml")),
    revisionFiles(slug),
  ]);
  // Proves a deployed runtime against the mark it has loaded, before the file changes it.
  if (prev?.enabled) await status(slug);

  let n = (revisions[0]?.n ?? 0) + 1;
  let config = render(docs, slug, n);
  let wrote = true;
  if (prev && before !== null && canon(prev.draft) === canon(draft)) {
    const again = render(docs, slug, prev.revision);
    if (again.yaml === before) {
      n = prev.revision;
      config = again;
      wrote = false;
    }
  }
  const base = `${n}-${config.id}`;
  const flags: Flags = {
    enabled: false,
    port: null,
    deployedAt: null,
    ...prev,
    draft,
    revision: n,
  };
  if (wrote) {
    await writeAtomic(path(slug, "revisions", `${base}.yaml`), config.yaml);
    const draftJson = `${JSON.stringify(draft, null, 2)}\n`;
    await writeAtomic(path(slug, "revisions", `${base}.json`), draftJson);
    await writeAtomic(path(slug, "tools.yaml"), config.yaml);
    await writeFlags(slug, flags);
  }

  // A deployed server's runtime reloads tools.yaml on its own, so any save of it is a deploy.
  if (start || prev?.enabled) {
    try {
      await deploy(slug, flags, config.mark, count(withSemantic(members(docs), draft)));
    } catch (error) {
      if (!prev?.enabled) {
        await stop(slug); // the draft stays saved; the server stays undeployed
      } else if (wrote) {
        if (before !== null) await writeAtomic(path(slug, "tools.yaml"), before);
        await writeFlags(slug, prev);
        await rm(path(slug, "revisions", `${base}.yaml`), { force: true });
        await rm(path(slug, "revisions", `${base}.json`), { force: true });
      }
      throw error;
    }
  }
  return (await readServer(slug)) as HostServerDetail;
}

/** Puts the previous revision's file and draft back, and reloads the runtime if deployed. */
export async function rollbackServer(slug: string): Promise<HostServerDetail> {
  assertSlug(slug);
  const flags = await readFlags(slug);
  if (!flags) throw new HostError(404, `There is no server “${slug}”.`);
  const target = (await revisionFiles(slug)).find((r) => r.n < flags.revision);
  if (!target) throw new HostError(400, "There is no earlier revision.");
  const [yaml, draftText, before] = await Promise.all([
    readText(path(slug, "revisions", `${target.base}.yaml`)),
    readText(path(slug, "revisions", `${target.base}.json`)),
    readText(path(slug, "tools.yaml")),
  ]);
  if (yaml === null || draftText === null) {
    throw new HostError(500, `Revision ${target.n} has lost its file or its draft.`);
  }
  const back: Flags = {
    ...flags,
    draft: JSON.parse(draftText) as HostServerDraft,
    revision: target.n,
  };
  if (flags.enabled) await status(slug); // proves the runtime before the file changes, as a save
  await writeAtomic(path(slug, "tools.yaml"), yaml);
  await writeFlags(slug, back);
  if (flags.enabled) {
    try {
      const counted = count(withSemantic(members(parseConfig(yaml)), back.draft));
      await deploy(slug, back, MARK + target.id, counted);
    } catch (error) {
      if (before !== null) await writeAtomic(path(slug, "tools.yaml"), before);
      await writeFlags(slug, flags);
      throw error;
    }
  }
  return (await readServer(slug)) as HostServerDetail;
}

/** What a deployed server serves; null when there is no such server or it is only a draft. */
export async function serving(slug: string): Promise<Serving | null> {
  assertSlug(slug);
  const flags = await readFlags(slug);
  if (!flags?.enabled) return null;
  const file = path(slug, "tools.yaml");
  const info = await stat(file);
  const key = `${info.mtimeMs}:${info.size}`;
  let hit = parsed.get(file);
  if (hit?.key !== key) {
    const docs = parseConfig((await readText(file)) ?? "");
    hit = { key, members: members(docs), writes: writingToolsets(docs) };
    parsed.set(file, hit);
  }
  const served = withSemantic(hit.members, flags.draft);
  return { draft: flags.draft, members: served, writes: hit.writes };
}

/** flags.json, or null when the server was never saved. */
export async function readFlags(slug: string): Promise<Flags | null> {
  const text = await readText(path(slug, "flags.json"));
  return text === null ? null : (JSON.parse(text) as Flags);
}

/* ---------- inside ---------- */

// Brings the runtime up on the file now in tools.yaml, and marks the server deployed once it
// answers for `mark`.
async function deploy(
  slug: string,
  flags: Flags,
  mark: string,
  counted: { tools: number; toolsets: number },
): Promise<void> {
  const now = await status(slug);
  if (!now.running || (await launchChanged(slug))) await startRuntime(slug);
  await confirmLoaded(slug, mark);
  const up = await status(slug);
  await writeFlags(slug, {
    ...flags,
    enabled: true,
    port: up.port,
    deployedAt: new Date().toISOString(),
  });
  const words = `${counted.tools} tools · ${counted.toolsets} toolsets`;
  await record(slug, "INFO", `config reloaded tools.yaml (rev ${flags.revision}) · ${words}`);
}

async function summary(slug: string): Promise<HostServer | null> {
  const flags = await readFlags(slug);
  if (!flags) return null;
  const [text, now, calls] = await Promise.all([
    readText(path(slug, "tools.yaml")),
    status(slug),
    stats(slug),
  ]);
  const docs = text ? parseConfig(text) : [];
  return {
    slug,
    revision: flags.revision,
    enabled: flags.enabled,
    running: now.running,
    ...count(withSemantic(members(docs), flags.draft)),
    bytes: text ? Buffer.byteLength(text) : 0,
    port: now.running ? now.port : null,
    deployedAt: flags.deployedAt,
    calls24h: calls.calls24h,
    top: calls.top,
    draft: flags.draft,
  };
}

// Newest first.
async function revisionFiles(slug: string): Promise<RevisionFile[]> {
  const names = await readdir(path(slug, "revisions")).catch(absent<string[]>([]));
  return names
    .flatMap((name) => {
      const match = REVISION.exec(name);
      return match ? [{ n: Number(match[1]), id: match[2], base: `${match[1]}-${match[2]}` }] : [];
    })
    .sort((a, b) => b.n - a.n);
}

async function describe(slug: string, revision: RevisionFile): Promise<HostRevision> {
  const file = path(slug, "revisions", `${revision.base}.yaml`);
  const [text, draftText, info] = await Promise.all([
    readText(file),
    readText(path(slug, "revisions", `${revision.base}.json`)),
    stat(file),
  ]);
  const draft = draftText ? (JSON.parse(draftText) as HostServerDraft) : null;
  return {
    n: revision.n,
    id: revision.id,
    at: info.mtime.toISOString(),
    ...count(withSemantic(members(text ? parseConfig(text) : []), draft)),
    bytes: Buffer.byteLength(text ?? ""),
  };
}

async function writeFlags(slug: string, flags: Flags): Promise<void> {
  await writeAtomic(path(slug, "flags.json"), `${JSON.stringify(flags, null, 2)}\n`);
}

// The semantic toolset is served by the gateway and has no document in tools.yaml.
function withSemantic(found: Members, draft: HostServerDraft | null): Members {
  if (!draft?.toolsets.includes(SEMANTIC_TOOLSET)) return found;
  return { ...found, [SEMANTIC_TOOLSET]: SEMANTIC_TOOLS.map((tool) => tool.name) };
}

function count(found: Members): { tools: number; toolsets: number } {
  return {
    tools: new Set(Object.values(found).flat()).size,
    toolsets: Object.keys(found).length,
  };
}

// Origins and hosts become comma-separated lists on the runtime's command line.
function checkDraft(draft: HostServerDraft): void {
  const bad = [...draft.origins, ...draft.hosts].filter((value) => !/^[^\s,]+$/.test(value));
  if (bad.length > 0) {
    const listed = bad.map((value) => `“${value}”`).join(", ");
    throw new HostError(400, `An origin or a host holds a space or a comma: ${listed}.`);
  }
}

// JSON with sorted keys, so two drafts compare by content.
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  );
}

function absent<T>(fallback: T) {
  return (error: NodeJS.ErrnoException): T => {
    if (error.code === "ENOENT") return fallback;
    throw error;
  };
}
