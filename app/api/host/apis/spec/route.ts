// An OpenAPI document fetched by the host, as endpoints to choose from.

import { parse } from "yaml";
import { apiAddress } from "@/lib/host/address";
import { askForSpec, endpointsFromSpec, specHeader, type SpecMiss } from "@/lib/host/apis";
import { fail, HostError, json } from "@/lib/host/errors";
import { readEnv } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import type { HostSpec } from "@/lib/host/types";
import { optionalText, readBody, text } from "../../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAP = 2 * 1024 * 1024;

const said = (miss: SpecMiss) =>
  "status" in miss ? `answered ${miss.status}` : `did not answer (${miss.reason})`;

export async function POST(request: Request) {
  try {
    return await asConsole(request, async () => {
      const body = await readBody(request);
      const url = text(body, "url").trim();
      // ponytail: the name is resolved again by fetch; pin the checked address if rebinding matters.
      await apiAddress(url);
      const auth = optionalText(body, "authHeader");
      const env = auth.trim() ? await readEnv() : {};
      const { headers, withheld } = specHeader(url, optionalText(body, "baseUrl"), auth, env);
      const secret = Object.values(headers)[0] ?? "";
      const get = async (sent: Record<string, string>): Promise<Response | SpecMiss> => {
        try {
          const answer = await fetch(url, {
            headers: sent,
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          if (answer.ok) return answer;
          await answer.body?.cancel();
          return { status: answer.status };
        } catch (error) {
          const cause =
            error instanceof Error && error.cause instanceof Error ? error.cause : error;
          const reason = cause instanceof Error ? cause.message : String(cause);
          // An invalid header value is quoted in fetch's own words.
          return { reason: secret ? reason.replaceAll(secret, "********") : reason };
        }
      };
      // With the auth header three times, then once without it.
      const { got, withAuth } = await askForSpec(get, headers);
      if (!(got instanceof Response)) {
        if (withAuth) {
          const tried = `${said(withAuth)} with the auth header, tried three times`;
          throw new HostError(400, `${url} ${tried}, and ${said(got)} without it.`);
        }
        if ("reason" in got) throw new HostError(400, `${url} did not answer: ${got.reason}`);
        const denied = got.status === 401 || got.status === 403;
        const why =
          withheld && denied ? " The auth header is sent only to the API’s own address." : "";
        throw new HostError(400, `${url} answered ${got.status}.${why}`);
      }
      const source = await readCapped(got);
      let document: unknown;
      try {
        document = JSON.parse(source);
      } catch {
        try {
          document = parse(source);
        } catch {
          throw new HostError(400, "The document is neither JSON nor YAML.");
        }
      }
      const spec: HostSpec = endpointsFromSpec(document);
      return json(withAuth ? { ...spec, withoutAuth: `${url} ${said(withAuth)}` } : spec);
    });
  } catch (error) {
    return fail(error);
  }
}

async function readCapped(answer: Response): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = answer.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CAP) {
      await reader.cancel();
      throw new HostError(400, "The document is larger than 2 MB.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
