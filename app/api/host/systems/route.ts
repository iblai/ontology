// The connected systems: the engine's connections, and connecting a new one.

import { aoJson, connectionOf } from "@/lib/host/ao";
import { fail, json } from "@/lib/host/errors";
import { envName, readEnv, readLabels, setEnv, setLabel } from "@/lib/host/files";
import { asConsole } from "@/lib/host/guard";
import { forgetReading, readEngine, systemsOf } from "@/lib/host/reading";
import type { HostSystem } from "@/lib/host/types";
import { readBody, systemInput, withoutSecret } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The engines the runtime has a source kind for.
const SERVED = ["postgresql", "mysql", "clickhouse", "snowflake"];

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () =>
      json(systemsOf(await readEngine(), Object.keys(await readEnv()), await readLabels())),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let password = "";
  try {
    return await asConsole(request, async () => {
      const input = systemInput(await readBody(request));
      const found = connectionOf(input);
      password = found.password;
      const { connection, database } = found;
      const put = (path: string, enabled: boolean) =>
        aoJson(path, { method: "PUT", body: JSON.stringify({ enabled }) });
      await setEnv(envName(database, "DB_PASSWORD"), password);
      try {
        await put("/configurations/pii-detection", input.pii);
        await put("/configurations/distinct-value-probing", input.probing);
        await aoJson("/connections", { method: "POST", body: JSON.stringify({ connection }) });
        await setLabel(database, input.label ?? "");
        await put("/configurations/semantic-compilation", true);
      } finally {
        forgetReading();
      }
      const labels = await readLabels();
      const systems = systemsOf(await readEngine(), Object.keys(await readEnv()), labels);
      const system: HostSystem = systems.find((item) => item.name === database) ?? {
        name: database,
        label: labels[database] ?? database,
        engine: connection.type,
        url: found.url,
        tables: null,
        scoped: Boolean(connection.schemas?.length || connection.table_allow_regex),
        piiColumns: null,
        terms: null,
        status: "ingesting",
        serve: SERVED.includes(connection.type),
      };
      return json(system, 201);
    });
  } catch (error) {
    return fail(withoutSecret(error, password));
  }
}
