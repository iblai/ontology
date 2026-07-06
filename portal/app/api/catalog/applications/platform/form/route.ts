// §5.2 Fetch active form — returns the form object with `schema` and `version`.
import { gateStore } from "@/lib/gate/mock-store";
import { gateError, json, platformKeyParam } from "../../../route-helpers";

export async function GET(req: Request) {
  const key = platformKeyParam(req);
  if (!key) return gateError(400, "missing_platform_key", "platform_key is required.");
  const form = gateStore.activeForm(key);
  if (!form) return gateError(404, "no_active_form", "This platform has no active form.");
  return json(form);
}
