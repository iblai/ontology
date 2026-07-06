// §5.1 Gate status — the one call that drives the applicant entry point.
import { gateStore } from "@/lib/gate/mock-store";
import { gateError, json, platformKeyParam } from "../../../route-helpers";

export async function GET(req: Request) {
  const key = platformKeyParam(req);
  if (!key) return gateError(400, "missing_platform_key", "platform_key is required.");
  if (!gateStore.activeForm(key)) {
    return gateError(404, "no_active_form", `No active form for platform: ${key}`);
  }
  return json(gateStore.gate(key));
}
