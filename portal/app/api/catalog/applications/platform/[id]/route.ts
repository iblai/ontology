// §5.5 Update draft — PATCH { responses } is a FULL replacement of the answers.
import type { ApplicationResponses } from "@iblai/iblai-js/data-layer";
import { gateStore } from "@/lib/gate/mock-store";
import { handleGateError, json, readJson, submissionId } from "../../../route-helpers";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await submissionId(params);
  const body = await readJson(req);
  try {
    return json(gateStore.update(id, (body.responses as ApplicationResponses) ?? {}));
  } catch (e) {
    return handleGateError(e);
  }
}
