// Request bodies of /api/host/*: their shape is checked here, their rules by the modules.

import { HostError } from "@/lib/host/errors";
import type {
  HostApiEndpoint,
  HostApiInput,
  HostAuth,
  HostServerDraft,
  HostSystemInput,
} from "@/lib/host/types";

type Body = Record<string, unknown>;

const isObject = (value: unknown): value is Body =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const bad = (field: string, why = "is not valid") => new HostError(400, `“${field}” ${why}.`);

/** The request's JSON object. */
export async function readBody(request: Request): Promise<Body> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HostError(400, "The request body is not JSON.");
  }
  if (!isObject(body)) throw new HostError(400, "The request body is not a JSON object.");
  return body;
}

export function text(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw bad(field, "is not text");
  return value;
}

/** A text field that may be left out, as "". */
export function optionalText(body: Body, field: string): string {
  return body[field] === undefined || body[field] === null ? "" : text(body, field);
}

function flag(body: Body, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") throw bad(field, "is not true or false");
  return value;
}

function strings(body: Body, field: string): string[] {
  const value = body[field];
  if (!isStrings(value)) throw bad(field, "is not a list of text");
  return value;
}

export function systemInput(body: Body): HostSystemInput {
  return {
    url: text(body, "url"),
    scope: strings(body, "scope"),
    pii: flag(body, "pii"),
    probing: flag(body, "probing"),
    label: labelOf(body),
  };
}

// What to call a system: one line, 60 characters at most; none keeps the database's name.
function labelOf(body: Body): string {
  const label = optionalText(body, "label").trim();
  if (label.length > 60 || [...label].some((c) => c < " " || c === "\u007f")) {
    throw bad("label", "is one line of 60 characters at most");
  }
  return label;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// The text values of a map; anything else in it is left out.
const textsOf = (value: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export function apiInput(body: Body): HostApiInput {
  const endpoints = body.endpoints;
  if (!Array.isArray(endpoints)) throw bad("endpoints", "is not a list");
  return {
    name: text(body, "name"),
    baseUrl: text(body, "baseUrl"),
    authHeader: text(body, "authHeader"),
    endpoints: endpoints.map((item, i): HostApiEndpoint => {
      if (!isObject(item)) throw bad(`endpoints[${i}]`);
      const method = text(item, "method");
      if (!METHODS.includes(method)) throw bad(`endpoints[${i}].method`);
      return {
        name: text(item, "name"),
        method: method as HostApiEndpoint["method"],
        path: text(item, "path"),
        description: text(item, "description"),
        query: strings(item, "query"),
        ...(isObject(item.notes) ? { notes: textsOf(item.notes) } : {}),
      };
    }),
  };
}

const HOST =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

// A host name, "*.name" for every name under it, or "*" for any host.
const isHost = (value: string) =>
  value === "*" || HOST.test(value.startsWith("*.") ? value.slice(2) : value);

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

// Each sign-in option keeps only its own fields, each non-empty text.
const PROVIDERS = {
  entra: ["tenant", "audience"],
  google: ["audience"],
  oidc: ["issuer", "audience"],
};

function auth(value: unknown): HostAuth {
  if (!isObject(value) || typeof value.platform !== "boolean") throw bad("auth");
  const result: HostAuth = { platform: value.platform };
  for (const [name, fields] of Object.entries(PROVIDERS)) {
    const option = value[name];
    if (option === undefined || option === null) continue;
    if (!isObject(option)) throw bad(`auth.${name}`);
    const kept: Record<string, string> = {};
    for (const field of fields) {
      const item = option[field];
      if (typeof item !== "string" || !item.trim()) throw bad(`auth.${name}.${field}`);
      kept[field] = item.trim();
    }
    Object.assign(result, { [name]: kept });
  }
  return result;
}

export function draft(value: unknown): HostServerDraft {
  if (!isObject(value)) throw bad("draft");
  const toolsets = strings(value, "toolsets");
  const origins = strings(value, "origins");
  const hosts = strings(value, "hosts");
  const origin = origins.find((item) => !isOrigin(item));
  if (origin !== undefined) throw bad("origins", `holds “${origin}”, not an http or https origin`);
  const host = hosts.find((item) => !isHost(item));
  if (host !== undefined) throw bad("hosts", `holds “${host}”, not a host name or *.name`);
  return { toolsets, auth: auth(value.auth), origins, hosts };
}

/** A failure without the password in its words: an engine's error may quote what it was sent. */
export function withoutSecret(error: unknown, secret: string): unknown {
  if (!(error instanceof Error) || !secret || !error.message.includes(secret)) return error;
  const message = error.message.replaceAll(secret, "********");
  return error instanceof HostError ? new HostError(error.status, message) : new Error(message);
}
