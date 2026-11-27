// An OpenAPI 3, Swagger 2 or Google Discovery document as endpoints, and the rules an endpoint's
// names keep. Types are its only imports: scripts/library.mjs loads this file as it is.

import type { HostApiEndpoint, HostApiMethod, HostSpec } from "./types";

export const METHODS: HostApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const BODIES = ["POST", "PUT", "PATCH"]; // the methods a JSON body goes with
export const TOOL_NAME_MAX = 64; // what an agent's model takes for a tool's name
const NOTE_MAX = 300; // characters of what a parameter means
const PATH_MAX = 2048; // no API's path is longer; a longer one meets no pattern
// ponytail: a document past these is cut short, the rest counted as left; raise them when a
// vendor's own document reaches them (the largest read so far holds 2,670 operations).
const OPERATIONS_MAX = 5000;
const PARAMS_MAX = 100; // parameters read per operation: Graph's lists have 8, Gmail's 6
const DEPTH_MAX = 32; // how deep a Discovery document's resources nest
// A value in a path as it is entered, `{id}`: a parameter's name, so 64 characters at most.
export const PLACE = /\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g;
// Plain characters, Google's ':' and '@' (…/{range}:append, users/@me), and {name} for a value.
const SEGMENT = /^(?:[A-Za-z0-9._~:@-]|\{[A-Za-z][A-Za-z0-9_]{0,63}\})+$/;
// What an agent's model takes for a parameter's name, after a leading $ the gateway hides.
export const QUERY = /^\$?[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export const placesOf = (path: string) => [...path.matchAll(PLACE)].map((match) => match[1]);

/** A query name as an agent sees it: Graph's `$filter` is `filter`. */
export const agentName = (name: string) => name.replace(/^\$/, "");

/** Whether a path starts with / and holds plain segments and {name} for a value. */
export function pathFits(path: string): boolean {
  if (!path.startsWith("/") || path.length > PATH_MAX) return false;
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  return (
    // The runtime would read a ':' before the first '/' as the address's scheme.
    !segments[0].includes(":") &&
    segments.every((segment) => SEGMENT.test(segment)) &&
    !segments.some((segment) => segment === "." || segment === "..")
  );
}

/**
 * Whether an endpoint's parameters stay apart as an agent sees them, case aside: its path's
 * values, its query names without their $, and `body` on a method that takes one.
 */
export function namesApart(method: HostApiMethod, path: string, query: string[]): boolean {
  const names = [
    ...new Set(placesOf(path)),
    ...query.map(agentName),
    ...(BODIES.includes(method) ? ["body"] : []),
  ].map(lower);
  return new Set(names).size === names.length;
}

export const words = (value: unknown) =>
  typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ") : "";

// The runtime would read "${" as a setting of its own.
const plain = (text: string) => text.replaceAll("${", "$ {");

/** One line a tool can carry about a parameter. */
export const noteOf = (value: unknown) => plain(words(value)).slice(0, NOTE_MAX);

// One operation as a document writes it, before it is an endpoint.
type Operation = {
  method: HostApiMethod;
  path: string; // its values named as parameters are: "/users/{user_id}"
  renamed: Map<string, string>; // a value's name as written → as in `path`
  params: Record<string, unknown>[]; // { name, in, description }, `in` being "path" or "query"
  dropped: number; // parameters past PARAMS_MAX, left unread
  id: string;
  says: string;
};

// A document's operations, up to OPERATIONS_MAX, and how many more there were.
type Read = { title: string; operations: Operation[]; beyond: number };

/**
 * The operations of a parsed OpenAPI 3, Swagger 2 or Google Discovery document, as endpoints a
 * save takes. Left out and counted in `left`: an operation whose path is not one a tool can call,
 * or whose parameters an agent would see alike, and a query parameter whose name a tool cannot
 * carry. Throws Error when the document is none of the three.
 */
export function endpointsFromSpec(doc: unknown): HostSpec {
  const { title, operations, beyond } =
    isRecord(doc) && doc.kind === "discovery#restDescription"
      ? discoveryOperations(doc)
      : openApiOperations(doc);
  const taken = new Set<string>();
  const next = new Map<string, number>(); // a name → the suffix to try next for it
  const endpoints: HostApiEndpoint[] = [];
  const left = { operations: beyond, parameters: 0 };
  for (const op of operations) {
    if (!pathFits(op.path) || !namesApart(op.method, op.path, [])) {
      left.operations++;
      continue;
    }
    left.parameters += op.dropped;
    const places = placesOf(op.path);
    const used = new Set([...places, ...(BODIES.includes(op.method) ? ["body"] : [])].map(lower));
    const query: string[] = [];
    const kept = new Set<string>();
    const notes: Record<string, string> = {};
    for (const param of op.params) {
      const name = param.name as string;
      const said = noteOf(param.description);
      if (param.in === "path") {
        const place = op.renamed.get(name) ?? name;
        if (said && places.includes(place)) notes[place] = said;
      } else if (param.in === "query") {
        // The same parameter again: the later says it, as an operation's own beats its path's.
        if (kept.has(name)) {
          if (said) notes[name] = said;
          continue;
        }
        // Two names an agent would see alike, such as filter and $filter, keep the first.
        if (!QUERY.test(name) || used.has(lower(agentName(name)))) {
          left.parameters++;
          continue;
        }
        used.add(lower(agentName(name)));
        kept.add(name);
        query.push(name);
        if (said) notes[name] = said;
      }
    }
    const says = op.says || `${op.method} ${op.path}`;
    endpoints.push({
      name: unique(snake(op.id || `${op.method} ${op.path}`), taken, next),
      method: op.method,
      path: op.path,
      description: plain(says),
      query,
      ...(Object.keys(notes).length ? { notes } : {}),
    });
  }
  return { title, endpoints, ...(left.operations || left.parameters ? { left } : {}) };
}

function openApiOperations(doc: unknown): Read {
  const openapi = isRecord(doc) && typeof doc.openapi === "string" && doc.openapi.startsWith("3.");
  const swagger = isRecord(doc) && doc.swagger === "2.0";
  if (!isRecord(doc) || !(openapi || swagger) || !isRecord(doc.paths)) {
    throw new Error(
      "That is not an OpenAPI 3, Swagger 2 or Google Discovery document with operations.",
    );
  }
  const operations: Operation[] = [];
  let beyond = 0;
  for (const [written, item] of Object.entries(doc.paths as Record<string, unknown>)) {
    if (!isRecord(item)) continue;
    const { path, renamed } = named(written);
    const shared = paramsOf(doc, item.parameters);
    for (const [key, op] of Object.entries(item)) {
      const method = key.toUpperCase() as HostApiMethod;
      if (!METHODS.includes(method) || !isRecord(op)) continue;
      if (operations.length >= OPERATIONS_MAX) {
        beyond++;
        continue;
      }
      operations.push({
        method,
        path,
        renamed,
        params: [...shared, ...paramsOf(doc, op.parameters)].filter(
          (param) => typeof param.name === "string",
        ),
        dropped: beyondMax(item.parameters) + beyondMax(op.parameters),
        id: typeof op.operationId === "string" ? op.operationId.trim() : "",
        says: words(op.summary) || words(op.description),
      });
    }
  }
  const title = isRecord(doc.info) && typeof doc.info.title === "string" ? doc.info.title : "";
  return { title, operations, beyond };
}

// A Discovery document's methods, at any depth of `resources`. Each path stands under the
// document's rootUrl and servicePath, as Google's own clients call it.
function discoveryOperations(doc: Record<string, unknown>): Read {
  const operations: Operation[] = [];
  let beyond = 0;
  // Of the parameters every method takes, `fields` alone is one an agent asks for: it picks what
  // an answer carries.
  const fields = isRecord(doc.parameters) ? doc.parameters.fields : undefined;
  // A YAML alias puts one object under many names: each is read once.
  const seen = new Set<object>();
  const walk = (node: Record<string, unknown>, depth: number) => {
    if (depth > DEPTH_MAX || seen.has(node)) return;
    seen.add(node);
    const methods = isRecord(node.methods) && !seen.has(node.methods) ? node.methods : {};
    seen.add(methods);
    for (const method of Object.values(methods)) {
      if (!isRecord(method) || seen.has(method)) continue;
      seen.add(method);
      const verb = (
        typeof method.httpMethod === "string" ? method.httpMethod.toUpperCase() : ""
      ) as HostApiMethod;
      if (!METHODS.includes(verb)) continue;
      if (operations.length >= OPERATIONS_MAX) {
        beyond++;
        continue;
      }
      // flatPath names each segment of a {+name} value; a {+name} left fails pathFits.
      const written = typeof method.flatPath === "string" ? method.flatPath : method.path;
      const { path, renamed } = named(`/${typeof written === "string" ? written : ""}`);
      const declared =
        isRecord(method.parameters) && !seen.has(method.parameters) ? method.parameters : {};
      seen.add(declared);
      const names = Object.keys(declared);
      const params = names
        .slice(0, PARAMS_MAX)
        .map((name): [string, unknown] => [name, declared[name]]);
      if (isRecord(fields) && !Object.hasOwn(declared, "fields")) params.push(["fields", fields]);
      operations.push({
        method: verb,
        path,
        renamed,
        params: params
          .filter(([, param]) => isRecord(param))
          .map(([name, param]) => ({
            name,
            in: (param as Record<string, unknown>).location,
            description: (param as Record<string, unknown>).description,
          })),
        dropped: Math.max(0, names.length - PARAMS_MAX),
        id: typeof method.id === "string" ? method.id : "",
        says: words(method.description),
      });
    }
    for (const child of Object.values(isRecord(node.resources) ? node.resources : {})) {
      if (isRecord(child)) walk(child, depth + 1);
    }
  };
  walk(doc, 0);
  return { title: typeof doc.title === "string" ? doc.title : "", operations, beyond };
}

// "{user-id}" is "{user_id}" here: a value's name is a parameter's name.
function named(written: string): { path: string; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  // Too long to be a path: left as written, for pathFits to refuse unread.
  if (written.length > PATH_MAX) return { path: written, renamed };
  const path = written.replace(/\{([^{}+]+)\}/g, (_all, name: string) => {
    renamed.set(name, placeName(name));
    return `{${renamed.get(name)}}`;
  });
  return { path, renamed };
}

const lower = (name: string) => name.toLowerCase();

// A value's name as a parameter's: letters, digits and _, starting with a letter.
function placeName(name: string): string {
  const kept = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z]/.test(kept) ? kept : `p_${kept}`;
}

// A list of parameters, up to PARAMS_MAX, each a local $ref resolved once.
function paramsOf(root: Record<string, unknown>, value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, PARAMS_MAX)
    .map((param) => resolve(root, param))
    .filter(isRecord);
}

const beyondMax = (list: unknown) =>
  Array.isArray(list) ? Math.max(0, list.length - PARAMS_MAX) : 0;

function resolve(root: Record<string, unknown>, value: unknown): unknown {
  const ref = isRecord(value) ? value.$ref : undefined;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return value;
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(node)) return null;
    node = node[part.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return node;
}

// Lowercase snake_case, starting with a letter, TOOL_NAME_MAX characters at most.
function snake(text: string): string {
  const name = text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  const lead = /^[a-z]/.test(name) ? name : `op_${name}`;
  return lead.slice(0, TOOL_NAME_MAX).replace(/_+$/, "");
}

// The name, or the name with the first free suffix: _2, _3, …
function unique(name: string, taken: Set<string>, next: Map<string, number>): string {
  let kept = name;
  let n = next.get(name) ?? 2;
  while (taken.has(kept)) {
    kept = `${name.slice(0, TOOL_NAME_MAX - String(n).length - 1)}_${n}`;
    n++;
  }
  next.set(name, n);
  taken.add(kept);
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
