// Server-side gate store — speaks the Platform Application Gate contract natively
// (guide §5). Numeric ids, exact `ApplicationSubmission` shape, and the SDK's own
// `validateResponses` on submit, so the SDK apply UI drives real submissions with
// zero lossy conversion against the portal's richer Application model.
//
// Persisted at module scope via globalThis so it survives Next.js dev hot-reloads
// and requests within the dev server process (no DB in this demo).

import type {
  ApplicationForm,
  ApplicationResponses,
  ApplicationSubmission,
  Attachment,
  FormSchema,
  GateStatusResponse,
  ValidationFieldError,
} from "@iblai/iblai-js/data-layer";
import { stripHiddenAnswers, validateResponses } from "@iblai/iblai-js/data-layer";
import { getSchoolConfig, listSchoolConfigs } from "@/lib/schools";
import { buildFormSchema } from "@/lib/schools/to-form-schema";

interface StoredSubmission extends ApplicationSubmission {
  platformKey: string;
}

/** Statuses an applicant may still edit (guide §6). */
const EDITABLE: ApplicationSubmission["status"][] = ["draft", "needs_more_info"];

export class GateStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

class GateStore {
  private submissions = new Map<number, StoredSubmission>();
  private submissionSeq = 1;
  private attachmentSeq = 1;
  private formIds: Record<string, number> = {};

  constructor() {
    // Stable numeric form id per school (SDK form ids are numbers).
    listSchoolConfigs().forEach((cfg, i) => {
      this.formIds[cfg.slug] = i + 1;
    });
  }

  activeForm(platformKey: string): ApplicationForm | null {
    const cfg = getSchoolConfig(platformKey);
    if (!cfg) return null;
    return {
      id: this.formIds[platformKey] ?? 1,
      version: 1,
      name: cfg.name,
      schema: buildFormSchema(cfg),
    };
  }

  private schemaFor(platformKey: string): FormSchema | null {
    return this.activeForm(platformKey)?.schema ?? null;
  }

  /** Caller's open application, or most recent terminal one, or null (guide §5.1). */
  private latestFor(platformKey: string): StoredSubmission | null {
    const mine = [...this.submissions.values()]
      .filter((s) => s.platformKey === platformKey)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return mine[0] ?? null;
  }

  gate(platformKey: string): GateStatusResponse {
    const form = this.activeForm(platformKey);
    const latest = this.latestFor(platformKey);
    return {
      mode: "application",
      is_member: false,
      form: form ? { id: form.id, version: form.version, title: form.name ?? platformKey } : null,
      submission: latest
        ? { id: latest.id, status: latest.status, modified: latest.modified }
        : null,
    };
  }

  listOwn(platformKey: string): ApplicationSubmission[] {
    return [...this.submissions.values()]
      .filter((s) => s.platformKey === platformKey)
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .map(toPublic);
  }

  get(id: number): StoredSubmission | undefined {
    return this.submissions.get(id);
  }

  create(platformKey: string, responses: ApplicationResponses = {}): ApplicationSubmission {
    const schema = this.schemaFor(platformKey);
    if (!schema) throw new GateStoreError(400, "no_active_form", "No active form for this platform.");
    const now = new Date().toISOString();
    const submission: StoredSubmission = {
      platformKey,
      id: this.submissionSeq++,
      status: "draft",
      form_version: 1,
      form_schema: schema,
      responses: stripHiddenAnswers(schema, responses),
      submitted_at: null,
      decision_message: null,
      modified: now,
      attachments: [],
    };
    this.submissions.set(submission.id, submission);
    return toPublic(submission);
  }

  /** Full replacement of the answers object (guide §5.5). */
  update(id: number, responses: ApplicationResponses): ApplicationSubmission {
    const s = this.require(id);
    if (!EDITABLE.includes(s.status)) {
      throw new GateStoreError(409, "not_editable", "This application can no longer be edited.");
    }
    s.responses = stripHiddenAnswers(s.form_schema, responses);
    s.modified = new Date().toISOString();
    return toPublic(s);
  }

  /** Validate + submit (guide §5.6). Returns structured errors on failure. */
  submit(
    id: number,
    responses?: ApplicationResponses,
  ):
    | { ok: true; submission: ApplicationSubmission }
    | { ok: false; errors: ValidationFieldError[] } {
    const s = this.require(id);
    if (!EDITABLE.includes(s.status)) {
      throw new GateStoreError(409, "not_editable", "This application can no longer be edited.");
    }
    if (responses) s.responses = stripHiddenAnswers(s.form_schema, responses);
    const errors = validateResponses(s.form_schema, s.responses);
    if (errors.length > 0) return { ok: false, errors };
    const now = new Date().toISOString();
    s.status = "submitted";
    s.submitted_at = now;
    s.modified = now;
    return { ok: true, submission: toPublic(s) };
  }

  withdraw(id: number): ApplicationSubmission {
    const s = this.require(id);
    if (s.status === "approved" || s.status === "denied" || s.status === "withdrawn") {
      throw new GateStoreError(
        409,
        "not_withdrawable",
        "This application can no longer be withdrawn.",
      );
    }
    s.status = "withdrawn";
    s.modified = new Date().toISOString();
    return toPublic(s);
  }

  addAttachment(
    id: number,
    field: string,
    itemId: string | null,
    file: { name: string; type: string; size: number },
  ): Attachment {
    const s = this.require(id);
    if (!EDITABLE.includes(s.status)) {
      throw new GateStoreError(409, "not_editable", "Uploads are only allowed while editable.");
    }
    const attachment: Attachment = {
      id: this.attachmentSeq++,
      field,
      item_id: itemId,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      created: new Date().toISOString(),
    };
    s.attachments.push(attachment);
    s.modified = new Date().toISOString();
    return attachment;
  }

  deleteAttachment(id: number, attachmentId: number): void {
    const s = this.require(id);
    if (!EDITABLE.includes(s.status)) {
      throw new GateStoreError(409, "not_editable", "Uploads are only allowed while editable.");
    }
    s.attachments = s.attachments.filter((a) => a.id !== attachmentId);
    s.modified = new Date().toISOString();
  }

  private require(id: number): StoredSubmission {
    const s = this.submissions.get(id);
    if (!s) throw new GateStoreError(404, "not_found", `Submission ${id} not found.`);
    return s;
  }
}

function toPublic(s: StoredSubmission): ApplicationSubmission {
  const { platformKey: _k, ...rest } = s;
  void _k;
  return structuredClone(rest);
}

const globalRef = globalThis as unknown as { __iblGateStore?: GateStore };
export const gateStore: GateStore = (globalRef.__iblGateStore ??= new GateStore());
