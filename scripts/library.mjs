// Builds the ready-made API definitions in lib/library/ from the pick files in scripts/library/
// and the vendor documents they name. A build step for developers: the console fetches nothing.
//
//   node scripts/library.mjs                    every system
//   node scripts/library.mjs canvas             one
//   node scripts/library.mjs canvas --check     one, built and checked, nothing written
//   node scripts/library.mjs canvas --list users   the operations its documents hold, by a word
//
// A pick file: { id, name, abbr, color, baseUrl, example, hint, auth, sources: [{ url, prefix? }],
// pick: ["GET /path" | { op, name?, says?, query? }], extra?: [endpoint], ask?: [name] }.
// A source is an OpenAPI 3, Swagger 2 or Google Discovery document.
// `extra` are endpoints written by hand; `ask` names the POSTs that only ask a question.
// Each id's tile draws public/logos/<id>.svg, the vendor's own mark.

import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const picksDir = path.join(root, "scripts", "library");
const outDir = path.join(root, "lib", "library");
// The console's own reading of a document, so a definition holds what a save takes.
const { endpointsFromSpec, pathFits, placesOf, QUERY, TOOL_NAME_MAX } = await import(
  pathToFileURL(path.join(root, "lib", "host", "openapi.ts")).href
);

const NAME = /^[a-z][a-z0-9_]*$/;
const args = process.argv.slice(2);
const dry = args.includes("--check");
const [only, flag, word] = args.filter((arg) => arg !== "--check");

async function documentAt(url) {
  const answer = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json, application/yaml, */*" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
  const text = await answer.text();
  try {
    return JSON.parse(text);
  } catch {
    return parse(text, { maxAliasCount: -1 });
  }
}

// Every operation of a system's documents, each path under its document's prefix.
async function operationsOf(pick) {
  const found = [];
  const versions = [];
  for (const source of pick.sources) {
    const doc = await documentAt(source.url);
    // A Discovery document has no info; its revision is the day it was cut.
    versions.push({ url: source.url, version: String(doc.info?.version ?? doc.revision ?? "") });
    for (const endpoint of endpointsFromSpec(doc).endpoints) {
      found.push({ ...endpoint, path: `${source.prefix ?? ""}${endpoint.path}` });
    }
  }
  return { found, versions };
}

const keyOf = (endpoint) => `${endpoint.method} ${endpoint.path}`;

function endpointOf(pick, entry, found) {
  const asked = typeof entry === "string" ? { op: entry } : entry;
  const from = found.find((endpoint) => keyOf(endpoint) === asked.op);
  if (!from) throw new Error(`${pick.id}: its documents hold no operation "${asked.op}"`);
  const missing = (asked.query ?? []).filter((name) => !from.query.includes(name));
  if (missing.length) {
    throw new Error(`${pick.id}: "${asked.op}" has no query parameter ${missing.join(", ")}`);
  }
  const query = asked.query ?? from.query;
  const description = asked.says ?? from.description;
  if (description === keyOf(from)) {
    throw new Error(`${pick.id}: "${asked.op}" says nothing of itself: give it "says"`);
  }
  // In the path's order, then the query's: Google lists a method's parameters in a new order each
  // time, and a rebuild should change nothing it did not have to.
  const notes = from.notes ?? {};
  const kept = [...new Set([...placesOf(from.path), ...query])]
    .filter((name) => Object.hasOwn(notes, name))
    .map((name) => [name, notes[name]]);
  return {
    name: asked.name ?? from.name,
    method: from.method,
    path: from.path,
    description,
    query,
    ...(kept.length ? { notes: Object.fromEntries(kept) } : {}),
  };
}

function check(pick, endpoints) {
  const seen = new Set();
  for (const endpoint of endpoints) {
    const where = `${pick.id}: ${keyOf(endpoint)}`;
    if (!NAME.test(endpoint.name)) throw new Error(`${where} is named "${endpoint.name}"`);
    // The console puts the API's name before it: "canvas_list_courses".
    if (pick.id.length + 1 + endpoint.name.length > TOOL_NAME_MAX) {
      throw new Error(`${where}: "${endpoint.name}" is too long a name behind "${pick.id}_"`);
    }
    if (seen.has(endpoint.name)) throw new Error(`${where}: two are named "${endpoint.name}"`);
    seen.add(endpoint.name);
    if (!pathFits(endpoint.path)) throw new Error(`${where}: not a path a tool can call`);
    const bad = endpoint.query.filter((name) => !QUERY.test(name));
    if (bad.length) throw new Error(`${where}: not a parameter's name: ${bad.join(", ")}`);
  }
  const unknown = (pick.ask ?? []).filter((name) => !seen.has(name));
  if (unknown.length) throw new Error(`${pick.id}: "ask" names no endpoint: ${unknown.join(", ")}`);
}

const files = (await readdir(picksDir)).filter((file) => file.endsWith(".json")).sort();
const read = async (file) => JSON.parse(await readFile(path.join(picksDir, file), "utf8"));
// --list and --check read only the system named, whatever state the other pick files are in.
const picks =
  only && (dry || flag === "--list")
    ? [await read(`${only}.json`)]
    : await Promise.all(files.map(read));
if (only && !picks.some((one) => one.id === only)) {
  throw new Error(`There is no pick file whose id is "${only}".`);
}

if (flag === "--list") {
  const { found } = await operationsOf(picks.find((one) => one.id === only));
  const holds = (endpoint) =>
    !word || `${keyOf(endpoint)} ${endpoint.description}`.toLowerCase().includes(word);
  for (const endpoint of found.filter(holds)) {
    const query = endpoint.query.length ? `  ?${endpoint.query.join(",")}` : "";
    console.log(
      `${keyOf(endpoint)}  [${endpoint.name}]  ${endpoint.description.slice(0, 90)}${query}`,
    );
  }
  process.exit(0);
}

const written = [];
for (const pick of picks.filter((one) => !only || one.id === only)) {
  const { found, versions } = pick.sources.length
    ? await operationsOf(pick)
    : { found: [], versions: [] };
  const endpoints = [
    ...pick.pick.map((entry) => endpointOf(pick, entry, found)),
    ...(pick.extra ?? []),
  ];
  check(pick, endpoints);
  if (dry) {
    console.log(
      `${pick.id}: ${endpoints.length} endpoints pass: ${endpoints.map((e) => e.name).join(", ")}`,
    );
    continue;
  }
  const { id, name, abbr, color, baseUrl, example, hint, auth, ask } = pick;
  const head = { id, name, abbr, color, baseUrl, example, hint, auth, ...(ask ? { ask } : {}) };
  const ready = { ...head, sources: versions, endpoints };
  const file = path.join(outDir, `${id}.json`);
  await writeFile(file, `${JSON.stringify(ready, null, 2)}\n`);
  written.push(file);
  console.log(`${id}: ${endpoints.length} endpoints`);
}

if (dry) process.exit(0);

// The tiles, by name so a vendor's sit together, and the loaders, for every pick file there is.
const tiles = [...picks]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ id, name, abbr, color }) => `  ${JSON.stringify({ id, name, abbr, color })},`)
  .join("\n");
const loaders = picks
  .map(
    ({ id }) =>
      `  ${JSON.stringify(id)}: async () => (await import("./${id}.json")).default as unknown as ReadyApi,`,
  )
  .join("\n");
const index = path.join(outDir, "index.ts");
await writeFile(
  index,
  `// Generated by scripts/library.mjs from scripts/library/*.json: do not edit by hand.

import type { ReadyApi, ReadyTile } from "./types";

/** The ready-made systems, as the catalog's tiles. */
export const library: ReadyTile[] = [
${tiles}
];

/** A system's definition, loaded when its tile is picked. */
export const load: Record<string, () => Promise<ReadyApi>> = {
${loaders}
};
`,
);
execFileSync("pnpm", ["exec", "oxfmt", ...written, index], { cwd: root, stdio: "inherit" });
