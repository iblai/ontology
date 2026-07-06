// §5.3 List own applications (plain { results }) and §5.4 Create draft.
import type { ApplicationResponses } from "@iblai/iblai-js/data-layer";
import { gateStore } from "@/lib/gate/mock-store";
import { gateError, handleGateError, json, platformKeyParam, readJson } from "../../route-helpers";

export async function GET(req: Request) {
  const key = platformKeyParam(req);
  if (!key) return gateError(400, "missing_platform_key", "platform_key is required.");
  return json({ results: gateStore.listOwn(key) });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const key = (body.platform_key as string) ?? "";
  if (!key) return gateError(400, "missing_platform_key", "platform_key is required.");
  try {
    const draft = gateStore.create(key, (body.responses as ApplicationResponses) ?? {});
    return json(draft, 201);
  } catch (e) {
    return handleGateError(e);
  }
}
