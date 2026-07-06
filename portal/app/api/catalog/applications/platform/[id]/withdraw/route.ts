// §5.7 Withdraw — allowed from any non-terminal status.
import { gateStore } from "@/lib/gate/mock-store";
import { handleGateError, json, submissionId } from "../../../../route-helpers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await submissionId(params);
  try {
    return json(gateStore.withdraw(id));
  } catch (e) {
    return handleGateError(e);
  }
}
