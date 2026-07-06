// §5.8 Upload attachment (multipart) — field (required), item_id (optional),
// file (required). Metadata only in the mock.
import { gateStore } from "@/lib/gate/mock-store";
import { gateError, handleGateError, json, submissionId } from "../../../../route-helpers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await submissionId(params);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return gateError(400, "invalid_body", "Expected multipart form data.");
  }

  const field = form.get("field");
  const file = form.get("file");
  const itemId = form.get("item_id");

  if (typeof field !== "string" || !field) {
    return gateError(400, "unknown_field", "A field path is required.");
  }
  if (!(file instanceof File)) {
    return gateError(400, "file_rejected", "A file is required.");
  }

  try {
    const attachment = gateStore.addAttachment(
      id,
      field,
      typeof itemId === "string" ? itemId : null,
      { name: file.name, type: file.type, size: file.size },
    );
    return json(attachment, 201);
  } catch (e) {
    return handleGateError(e);
  }
}
