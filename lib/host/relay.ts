// A console that serves pages only hands every /api/host/* call to the platform's own server.
// As the old console's forward() (frontend/app/api/ontology/[...path]/route.ts).

import { PLATFORM_HEADER } from "@/lib/platform";
import { SERVER_HEADER } from "@/lib/server-address";
import { apiAddress } from "./address";
import { HostError } from "./errors";

const FORWARDED = ["authorization", "content-type", PLATFORM_HEADER];
const RETURNED = ["content-type", "content-disposition"];
const ANSWER_MS = 60_000;

// The address the browser named, if this console may send a sign-in there.
async function serverOf(request: Request): Promise<string> {
  const named = request.headers.get(SERVER_HEADER);
  if (!named) throw new HostError(404, "No ontology server is connected for this platform.");
  const found = await apiAddress(named);
  if (found.private) {
    const host = new URL(found.address).hostname;
    throw new HostError(400, `${host} is on a private network: a server’s address is public.`);
  }
  return found.address.replace(/\/+$/, "");
}

/** Forwards the call to the server the browser named and returns that server's answer. */
export async function relay(request: Request): Promise<Response> {
  const base = await serverOf(request);
  const { pathname, search } = new URL(request.url);
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const bodiless = request.method === "GET" || request.method === "HEAD";
  const { host } = new URL(base);
  let answer: Response;
  try {
    answer = await fetch(`${base}${pathname}${search}`, {
      method: request.method,
      headers,
      body: bodiless ? undefined : await request.arrayBuffer(),
      // The sign-in goes to the address named, and nowhere that address sends us on to.
      redirect: "manual",
      signal: AbortSignal.timeout(ANSWER_MS),
      cache: "no-store",
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new HostError(502, `The ontology server at ${host} did not answer (${why}).`);
  }
  if (answer.status >= 300 && answer.status < 400) {
    throw new HostError(
      502,
      `The ontology server at ${host} answered with a redirect, which is not followed.`,
    );
  }
  const returned = new Headers();
  for (const name of RETURNED) {
    const value = answer.headers.get(name);
    if (value) returned.set(name, value);
  }
  return new Response(answer.body, { status: answer.status, headers: returned });
}
