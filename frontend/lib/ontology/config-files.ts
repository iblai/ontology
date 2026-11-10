/**
 * Server-only renderer of the backend's configuration files for the Configuration page.
 *
 * A backend sends its files as text (`GET /config`), masked on its own host
 * (`configFromBackend`); mock mode renders the same files from its state
 * (`configFromTexts`).
 *
 * Secrets are masked BEFORE anything leaves this module: any value whose key
 * looks credential-like is replaced with a mask unless it is a `${ENV_VAR}`
 * reference (references are configuration, not secrets). `.env` values are
 * always masked wholesale.
 */

import YAML from "yaml";
import type { BackendConfigFile, BackendConfigSnapshot } from "./types";

const SECRET_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key|credential|auth)/i;
const ENV_REF_RE = /^\s*\$\{[A-Z0-9_]+\}\s*$/;
const MASK = "••••••••";

/** Mask credential-looking `key: value` / `key=value` lines in raw config text. */
export function maskSecrets(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*-?\s*)([A-Za-z0-9_.-]+)(\s*[:=]\s*)(.+)$/);
      if (!m) return line;
      const [, indent, key, sep, value] = m;
      if (!SECRET_KEY_RE.test(key)) return line;
      const v = value.trim();
      if (!v || ENV_REF_RE.test(v) || v === "null" || v === "~") return line;
      return `${indent}${key}${sep}${MASK}`;
    })
    .join("\n");
}

/** Mask every value in a dotenv-style file — keys stay visible, values never. */
function maskEnvFile(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*(?:export\s+)?[A-Za-z0-9_]+\s*=)(.*)$/);
      return m && m[2].trim() ? `${m[1]}${MASK}` : line;
    })
    .join("\n");
}

type Summarizer = (raw: string) => { label: string; value: string }[];

function yamlKeys(raw: string): Record<string, unknown> {
  return (YAML.parse(raw) ?? {}) as Record<string, unknown>;
}

/** Entry names from a YAML collection that may be a list of objects or a name→config mapping. */
function entryNames(coll: unknown, key = "name"): string[] {
  if (Array.isArray(coll)) {
    return coll.map((e) =>
      e && typeof e === "object" ? String((e as Record<string, unknown>)[key] ?? "?") : String(e),
    );
  }
  if (coll && typeof coll === "object") return Object.keys(coll);
  return [];
}

const summarizers: Record<string, Summarizer> = {
  ontology: (raw) => {
    const doc = yamlKeys(raw);
    return [{ label: "sections", value: Object.keys(doc).join(", ") || "—" }];
  },
  schedules: (raw) => {
    const list = entryNames(yamlKeys(raw).schedules);
    return [
      { label: "schedules", value: String(list.length) },
      { label: "names", value: list.join(", ") || "—" },
    ];
  },
  roles: (raw) => {
    const list = entryNames(yamlKeys(raw).roles);
    return [
      { label: "roles", value: String(list.length) },
      { label: "names", value: list.join(", ") || "—" },
    ];
  },
  tools: (raw) => {
    // MCP Toolbox config: a multi-document YAML stream of source/tool/toolset docs.
    const docs = YAML.parseAllDocuments(raw)
      .map((d) => d.toJS() as Record<string, unknown> | null)
      .filter((d): d is Record<string, unknown> => Boolean(d));
    const byKind = new Map<string, number>();
    for (const d of docs) {
      const kind = String(d.kind ?? "unknown");
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    return [
      { label: "documents", value: String(docs.length) },
      ...[...byKind.entries()].map(([kind, n]) => ({ label: kind, value: String(n) })),
    ];
  },
  catalog: (raw) => {
    const entries = entryNames(yamlKeys(raw).entries);
    return [{ label: "entries", value: String(entries.length) }];
  },
  compose: (raw) => {
    const services = yamlKeys(raw).services;
    const keys = services && typeof services === "object" ? Object.keys(services) : [];
    return [
      { label: "services", value: String(keys.length) },
      { label: "names", value: keys.join(", ") || "—" },
    ];
  },
  caddyfile: (raw) => [{ label: "lines", value: String(raw.split("\n").length) }],
  env: (raw) => {
    const keys = raw
      .split("\n")
      .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=/)?.[1])
      .filter(Boolean);
    return [{ label: "variables", value: String(keys.length) }];
  },
};

interface FileSpec {
  id: string;
  path: string;
  format: BackendConfigFile["format"];
  optional?: boolean;
}

const FILES: FileSpec[] = [
  { id: "ontology", path: "config/ontology.yaml", format: "yaml" },
  { id: "schedules", path: "config/sync-schedules.yaml", format: "yaml" },
  { id: "roles", path: "config/roles.yaml", format: "yaml" },
  { id: "tools", path: "config/tools.yaml", format: "yaml" },
  { id: "catalog", path: "src/iblai_ontology/catalog/catalog.yaml", format: "yaml" },
  { id: "compose", path: "docker-compose.yml", format: "yaml" },
  { id: "caddyfile", path: "config/Caddyfile", format: "caddyfile" },
  { id: "env", path: ".env", format: "env", optional: true },
];

function absent(spec: FileSpec): BackendConfigFile {
  return {
    id: spec.id,
    path: spec.path,
    format: spec.format,
    exists: false,
    optional: Boolean(spec.optional),
    sizeBytes: null,
    modifiedAt: null,
    content: null,
    summary: [],
  };
}

/** The entry for raw content: secrets masked, summary parsed. */
function describe(spec: FileSpec, raw: string, mtime: Date): BackendConfigFile {
  const file = absent(spec);
  const masked = spec.format === "env" ? maskEnvFile(raw) : maskSecrets(raw);
  let summary: BackendConfigFile["summary"] = [];
  try {
    summary = summarizers[spec.id]?.(raw) ?? [];
  } catch (e) {
    file.error = `parse: ${(e as Error).message}`;
  }
  return {
    ...file,
    exists: true,
    sizeBytes: Buffer.byteLength(raw, "utf8"),
    modifiedAt: mtime.toISOString(),
    content: masked,
    summary,
  };
}

/** A snapshot from texts keyed by file id (the mock); files without a text come back absent. */
export function configFromTexts(
  root: string,
  texts: Partial<Record<string, string>>,
): BackendConfigSnapshot {
  const at = new Date();
  return {
    root,
    generatedAt: at.toISOString(),
    files: FILES.map((spec) => {
      const raw = texts[spec.id];
      return raw === undefined ? absent(spec) : describe(spec, raw, at);
    }),
  };
}

/** A backend's `GET /config`: each file as text it has masked, `null` when the file is absent. */
export interface BackendConfigPayload {
  root: string;
  files: { id: string; content: string | null; modified_at: string | null }[];
}

/**
 * A snapshot of what a backend sent, in this page's order and masked a second time.
 * A file it did not send is left out: the ibl.ai platform holds it (roles and schedules
 * with `ONTOLOGY_DATA_STORE=dm`), or the host does.
 */
export function configFromBackend(sent: BackendConfigPayload): BackendConfigSnapshot {
  const byId = new Map(sent.files.map((file) => [file.id, file]));
  return {
    root: sent.root,
    generatedAt: new Date().toISOString(),
    files: FILES.flatMap((spec) => {
      const file = byId.get(spec.id);
      if (!file) return [];
      if (file.content === null) return [absent(spec)];
      return [describe(spec, file.content, new Date(file.modified_at ?? Date.now()))];
    }),
  };
}
