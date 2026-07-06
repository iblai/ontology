// §5.6 Submit — optional { responses } replaces answers before validating.
// Validation is authoritative (mirrors the real backend) via the SDK's own
// validateResponses; a failure returns the structured validation_failed shape (§4.4).
import type { ApplicationResponses } from "@iblai/iblai-js/data-layer";
import { gateStore } from "@/lib/gate/mock-store";
import { handleGateError, json, readJson, submissionId } from "../../../../route-helpers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await submissionId(params);
  const body = await readJson(req);
  try {
    const result = gateStore.submit(id, body.responses as ApplicationResponses | undefined);
    if (result.ok) return json(result.submission);
    return json({ error: "validation_failed", errors: result.errors }, 400);
  } catch (e) {
    return handleGateError(e);
  }
}
