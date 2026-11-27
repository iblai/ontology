// Custom HTTP APIs: the ones in apis.yaml, and adding one.

import { listApis, saveApi } from "@/lib/host/apis";
import { fail, json } from "@/lib/host/errors";
import { asConsole } from "@/lib/host/guard";
import type { HostApi } from "@/lib/host/types";
import { apiInput, readBody } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await asConsole(request, async () => {
      const apis: HostApi[] = (await listApis()).map(
        ({ name, baseUrl, authHeader, endpoints, tools, oauth }) => ({
          name,
          baseUrl,
          authHeader,
          endpoints,
          tools,
          ...(oauth ? { oauth } : {}),
        }),
      );
      return json(apis);
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return await asConsole(request, async () =>
      json(await saveApi(apiInput(await readBody(request)))),
    );
  } catch (error) {
    return fail(error);
  }
}
