// The door agents come through: POST /<platform>/<slug>/mcp, JSON-RPC 2.0, one message or a batch.
// Ported from the old product's mcp_server/server.py. Every refusal comes before any serving.

import type { NextRequest } from "next/server";

import { resolveCaller } from "@/lib/host/dm";
import { HostError } from "@/lib/host/errors";
import { assertSlug } from "@/lib/host/files";
import { recordRefusal } from "@/lib/host/log";
import {
  checkRate,
  handleMessage,
  hostAllowed,
  originAllowed,
  type RpcContext,
} from "@/lib/host/mcp";
import { assertServed, inPlatform } from "@/lib/host/platform";
import { serving, type Serving } from "@/lib/host/servers";
import { isPlatformKey } from "@/lib/platform";
import { relaying } from "@/lib/server-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ platform: string; slug: string }> };
type HeaderMap = Record<string, string>;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const AGENT = /^[A-Za-z0-9 ._-]{1,64}$/;
const ALLOW = { Allow: "POST, OPTIONS" };
const CHALLENGE = 'Token realm="ontology", Api-Token realm="ontology", Bearer realm="ontology"';

const answer = (body: unknown, status: number, headers: HeaderMap = {}) =>
  Response.json(body, { status, headers });
const missing = (slug: string) => answer({ error: `no server named ${slug}` }, 404);

// No stream to offer: the spec's answer to GET (and every other method) is 405.
const notAllowed = () => new Response(null, { status: 405, headers: ALLOW });
export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;

export async function OPTIONS(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { platform, slug } = await params;
    return await within(platform, slug, async () => {
      const gate = await admit(request, slug);
      if (gate instanceof Response) return gate;
      const preflight: HeaderMap = gate.origin
        ? {
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers":
              request.headers.get("access-control-request-headers") ??
              "authorization, content-type, mcp-protocol-version",
            "Access-Control-Max-Age": "600",
          }
        : {};
      return new Response(null, {
        status: 204,
        headers: { ...ALLOW, ...gate.cors, ...preflight },
      });
    });
  } catch (error) {
    return refused(error, {});
  }
}

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  let cors: HeaderMap = {};
  try {
    const { platform, slug } = await params;
    return await within(platform, slug, async () => {
      const gate = await admit(request, slug);
      if (gate instanceof Response) return gate;
      cors = gate.cors;

      const forward: HeaderMap = {};
      request.headers.forEach((value, name) => {
        if (name.toLowerCase().endsWith("_token")) forward[name.toLowerCase()] = value;
      });
      const authorization = request.headers.get("authorization");
      if ((authorization || Object.keys(forward).length) && !secure(request)) {
        const error = "token rejected over cleartext connection; use HTTPS";
        return answer({ error }, 403, cors);
      }
      const caller = await resolveCaller(authorization, platform);

      const text = await request.text();
      let body: unknown;
      let parsed = true;
      try {
        body = JSON.parse(text || "{}");
      } catch {
        parsed = false;
      }
      const messages: unknown[] = Array.isArray(body) ? body : [body];
      // A batch counts each tools/call, as the old limiter weighed it.
      const calls = parsed ? messages.filter((m) => isObject(m) && m.method === "tools/call") : [];
      for (let i = 0; i < Math.max(calls.length, 1); i++) checkRate(caller.hash, calls.length > 0);
      if (!parsed) return answer({ error: "invalid JSON" }, 400, cors);
      if (!messages.every(isObject)) {
        return answer({ error: "invalid JSON-RPC message" }, 400, cors);
      }

      const agent = request.nextUrl.searchParams.get("agent");
      const ctx: RpcContext = {
        slug: gate.slug,
        caller,
        serving: gate.served,
        origin: gate.origin,
        agent: agent && AGENT.test(agent) ? agent : null,
        forward,
      };
      const responses: unknown[] = [];
      for (const message of messages) {
        const response = await handleMessage(ctx, message);
        if (response !== null) responses.push(response);
      }
      if (responses.length === 0) return new Response(null, { status: 202, headers: cors });
      return answer(Array.isArray(body) ? responses : responses[0], 200, cors);
    });
  } catch (error) {
    return refused(error, cors);
  }
}

// The platform the address names: one that cannot be a key has no server, like a missing one.
async function within(
  platform: string,
  slug: string,
  run: () => Promise<Response>,
): Promise<Response> {
  if (relaying()) {
    const error =
      "This address serves the console’s pages: call the ontology server’s own address.";
    return answer({ error }, 404);
  }
  if (!isPlatformKey(platform)) return missing(assertSlug(slug));
  assertServed(platform);
  return inPlatform(platform, run);
}

type Gate = { slug: string; served: Serving; origin: string | null; cors: HeaderMap };

// The server, then the origin and the host; the CORS headers every later answer carries.
async function admit(request: NextRequest, raw: string): Promise<Gate | Response> {
  const slug = assertSlug(raw);
  const served = await serving(slug);
  if (!served) return missing(slug);

  const origin = request.headers.get("origin");
  const cors: HeaderMap = {};
  if (origin) {
    if (!originAllowed(origin, served.draft.origins)) {
      await recordRefusal(slug, `rejected origin ${origin} (not in --allowed-origins)`);
      return answer({ error: `origin ${origin} is not allowed on ${slug}` }, 403);
    }
    cors["Access-Control-Allow-Origin"] = origin;
    cors.Vary = "Origin";
  }

  const host = hostName(request);
  const { hosts } = served.draft;
  if (hosts.length && !LOOPBACK.has(host) && !hostAllowed(host, hosts)) {
    await recordRefusal(slug, `rejected host ${host} (not in --allowed-hosts)`);
    return answer({ error: `host ${host} is not allowed on ${slug}` }, 403, cors);
  }
  return { slug, served, origin, cors };
}

// The Host header without its port: "[::1]:3000" → "::1", "x.edu:443" → "x.edu".
function hostName(request: NextRequest): string {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

// A credential is taken only over https, or from this machine.
function secure(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  if (proto === "https" || request.nextUrl.protocol === "https:") return true;
  return LOOPBACK.has(hostName(request));
}

function refused(error: unknown, cors: HeaderMap): Response {
  if (!(error instanceof HostError)) {
    return answer({ error: error instanceof Error ? error.message : String(error) }, 500, cors);
  }
  const headers = { ...cors };
  if (error.status === 401) headers["WWW-Authenticate"] = CHALLENGE;
  if (error.status === 429) headers["Retry-After"] = "60";
  return answer({ error: error.message }, error.status, headers);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
