// The browser's way to the engine: only the allowed paths, with the host's key.

import { aoAllowed, aoError, aoFetch } from "@/lib/host/ao";
import { fail, HostError } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import { forgetReading } from "@/lib/host/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "/api/host/ao";

async function handle(request: Request): Promise<Response> {
  try {
    return await asConsole(request, async () => {
      const { method } = request;
      const url = new URL(request.url);
      // The raw path, still encoded, is what is checked and what is sent on.
      const path = url.pathname.slice(PREFIX.length);
      if (!aoAllowed(method, path))
        throw new HostError(404, `No such engine call: ${method} ${path}`);
      const body = method === "GET" ? undefined : (await request.text()) || undefined;
      const answer = await aoFetch(`${path}${url.search}`, {
        method,
        body,
        headers: body ? { "content-type": "application/json" } : undefined,
      });
      if (method !== "GET") forgetReading();
      // A refused key is the host's fault; relayed as is, the browser would read it as its own.
      if (answer.status === 401 || answer.status === 403) throw await aoError(answer);
      const headers = new Headers({
        "content-type": answer.headers.get("content-type") ?? "application/json",
      });
      const disposition = answer.headers.get("content-disposition");
      if (disposition) headers.set("content-disposition", disposition);
      return new Response(answer.body, { status: answer.status, headers });
    });
  } catch (error) {
    return fail(error);
  }
}

export { handle as GET, handle as PATCH, handle as PUT, handle as POST };
