// MSW handlers — intercept the SDK's gate API calls at the browser level
// regardless of what domain Config.dmUrl points at. Reuses the existing
// lib/gate/mock-store.ts store (framework-agnostic, Node-compatible via
// globalThis) so the MSW layer and the dormant Next.js route handlers share
// the same source of truth.

import { http, HttpResponse } from "msw";
import type {
  ApplicationResponses,
} from "@iblai/iblai-js/data-layer";
import { gateStore, GateStoreError } from "@/lib/gate/mock-store";

// Match the gate API paths on any origin — the SDK sets Config.dmUrl to
// the real domain, but MSW intercepts at the browser level first.
const BASE = "*/api/catalog/applications/platform";

function handleError(e: unknown): Response {
  if (e instanceof GateStoreError) {
    return HttpResponse.json({ error: e.code, detail: e.detail }, { status: e.status });
  }
  const detail = e instanceof Error ? e.message : "Unexpected error";
  return HttpResponse.json({ error: "server_error", detail }, { status: 500 });
}

export const handlers = [
  // §5.1 Gate status
  http.get(`${BASE}/gate`, ({ request }) => {
    const key = new URL(request.url).searchParams.get("platform_key") ?? "";
    if (!key) return HttpResponse.json({ error: "missing_platform_key", detail: "platform_key is required." }, { status: 400 });
    const gs = gateStore.gate(key);
    if (!gs) return HttpResponse.json({ error: "no_active_form", detail: "No active form." }, { status: 404 });
    return HttpResponse.json(gs);
  }),

  // §5.2 Active form
  http.get(`${BASE}/form`, ({ request }) => {
    const key = new URL(request.url).searchParams.get("platform_key") ?? "";
    if (!key) return HttpResponse.json({ error: "missing_platform_key", detail: "platform_key is required." }, { status: 400 });
    const form = gateStore.activeForm(key);
    if (!form) return HttpResponse.json({ error: "no_active_form", detail: "No active form." }, { status: 404 });
    return HttpResponse.json(form);
  }),

  // §5.3 List own / §5.4 Create draft
  http.get(`${BASE}`, ({ request }) => {
    const key = new URL(request.url).searchParams.get("platform_key") ?? "";
    if (!key) return HttpResponse.json({ error: "missing_platform_key", detail: "platform_key is required." }, { status: 400 });
    return HttpResponse.json({ results: gateStore.listOwn(key) });
  }),

  http.post(`${BASE}`, async ({ request }) => {
    const body = await request.json() as { platform_key?: string; responses?: ApplicationResponses };
    const key = body.platform_key ?? "";
    if (!key) return HttpResponse.json({ error: "missing_platform_key", detail: "platform_key is required." }, { status: 400 });
    try {
      const draft = gateStore.create(key, body.responses ?? {});
      return HttpResponse.json(draft, { status: 201 });
    } catch (e) {
      return handleError(e);
    }
  }),

  // §5.5 Update draft
  http.patch(`${BASE}/:id`, async ({ request, params }) => {
    const id = Number(params.id);
    const body = await request.json() as { responses?: ApplicationResponses };
    try {
      return HttpResponse.json(gateStore.update(id, body.responses ?? {}));
    } catch (e) {
      return handleError(e);
    }
  }),

  // §5.6 Submit
  http.post(`${BASE}/:id/submit`, async ({ request, params }) => {
    const id = Number(params.id);
    const body = await request.json() as { responses?: ApplicationResponses };
    try {
      const result = gateStore.submit(id, body.responses);
      if (result.ok) return HttpResponse.json(result.submission);
      return HttpResponse.json({ error: "validation_failed", errors: result.errors }, { status: 400 });
    } catch (e) {
      return handleError(e);
    }
  }),

  // §5.7 Withdraw
  http.post(`${BASE}/:id/withdraw`, ({ params }) => {
    const id = Number(params.id);
    try {
      return HttpResponse.json(gateStore.withdraw(id));
    } catch (e) {
      return handleError(e);
    }
  }),

  // §5.8 Upload attachment
  http.post(`${BASE}/:id/attachments`, async ({ request, params }) => {
    const id = Number(params.id);
    const formData = await request.formData();
    const field = formData.get("field");
    const file = formData.get("file");
    const itemId = formData.get("item_id");
    if (typeof field !== "string" || !field) {
      return HttpResponse.json({ error: "unknown_field", detail: "A field path is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return HttpResponse.json({ error: "file_rejected", detail: "A file is required." }, { status: 400 });
    }
    try {
      const att = gateStore.addAttachment(id, field, typeof itemId === "string" ? itemId : null, { name: file.name, type: file.type, size: file.size });
      return HttpResponse.json(att, { status: 201 });
    } catch (e) {
      return handleError(e);
    }
  }),

  // §5.9 Delete attachment
  http.delete(`${BASE}/:id/attachments/:attachmentId`, ({ params }) => {
    const id = Number(params.id);
    const aid = Number(params.attachmentId);
    try {
      gateStore.deleteAttachment(id, aid);
      return new HttpResponse(null, { status: 204 });
    } catch (e) {
      return handleError(e);
    }
  }),
];
