// §5.9 Delete attachment — 204 on success.
import { gateStore } from "@/lib/gate/mock-store";
import { handleGateError } from "../../../../../route-helpers";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  try {
    gateStore.deleteAttachment(Number(id), Number(attachmentId));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleGateError(e);
  }
}
