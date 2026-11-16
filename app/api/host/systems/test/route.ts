// Trying a system's URL on the engine before it is connected.

import type { AoConnectionTestResponse } from "@/lib/ao-types";
import { aoJson, connectionOf } from "@/lib/host/ao";
import { fail, HostError, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import type { HostSystemTest } from "@/lib/host/types";
import { readBody, systemInput, withoutSecret } from "../../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let password = "";
  try {
    return await asConsole(request, async () => {
      const found = connectionOf(systemInput(await readBody(request)));
      password = found.password;
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      let result: HostSystemTest;
      try {
        const answer = await aoJson<AoConnectionTestResponse>("/connections/test", {
          method: "POST",
          body: JSON.stringify({ connection: found.connection }),
        });
        const n = answer.schemas.length;
        // The engine lists schemas for a few kinds only; for the rest an empty list says nothing.
        const message =
          n === 0 ? "the database answered" : `${n} ${n === 1 ? "schema" : "schemas"} visible`;
        result = { ok: true, message, ms: ms(), tables: null };
      } catch (error) {
        // The engine's own refusal of the connection is the test's answer; anything else fails.
        if (!(error instanceof HostError) || error.status < 400 || error.status >= 500) throw error;
        const { message } = withoutSecret(error, password) as HostError;
        result = { ok: false, message, ms: ms(), tables: null };
      }
      return json(result);
    });
  } catch (error) {
    return fail(withoutSecret(error, password));
  }
}
