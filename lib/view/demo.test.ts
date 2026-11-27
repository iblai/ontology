import { describe, expect, it } from "vitest";
import type { HostApiInput, HostServerDraft } from "@/lib/host/types";
import { demoApiRefusal, demoSave, demoToolsets, savedServer } from "./demo";

const draft: HostServerDraft = {
  toolsets: [demoToolsets[0].name],
  auth: { platform: true },
  origins: ["https://claude.ai"],
  hosts: ["ontology.university.edu"],
};

describe("a server the demo saves", () => {
  it("counts its saves, and stays enabled from its first deploy", () => {
    const first = demoSave(undefined, draft, false, "2026-11-28T10:00:00Z");
    expect(first).toEqual({ draft, revision: 1, enabled: false, deployedAt: null });
    const deployed = demoSave(first, draft, true, "2026-11-28T10:05:00Z");
    expect(deployed).toMatchObject({
      revision: 2,
      enabled: true,
      deployedAt: "2026-11-28T10:05:00Z",
    });
    expect(demoSave(deployed, draft, false, "2026-11-28T10:09:00Z")).toMatchObject({
      revision: 3,
      enabled: true,
      deployedAt: "2026-11-28T10:05:00Z",
    });
  });

  it("shows its toolsets' tools, and no calls or agents yet", () => {
    const saved = demoSave(undefined, draft, true, "2026-11-28T10:00:00Z");
    const view = savedServer("touch-test", saved, Date.parse("2026-11-28T10:02:00Z"));
    expect(view).toMatchObject({
      slug: "touch-test",
      revision: 1,
      enabled: true,
      toolsets: 1,
      tools: demoToolsets[0].tools.length,
      calls24h: 0,
      agents: 0,
      deployedAgo: "2m",
      toolsetNames: draft.toolsets,
    });
    expect(view.url).toMatch(/\/touch-test\/mcp$/);
  });
});

describe("an API the demo saves", () => {
  it("signs in with OAuth only with a client ID and secret, as the host does", () => {
    const api: HostApiInput = {
      name: "gmail",
      baseUrl: "https://gmail.googleapis.com",
      authHeader: "",
      endpoints: [],
    };
    const oauth = {
      grant: "refresh_token" as const,
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "test-id",
      clientAuth: "body" as const,
      scope: "",
      clientSecret: "test-secret",
      refreshToken: "",
    };
    expect(demoApiRefusal({ ...api, oauth })).toBeNull();
    expect(demoApiRefusal({ ...api, oauth: { ...oauth, clientId: " " } })).toBe(
      "OAuth needs a client ID.",
    );
    expect(demoApiRefusal({ ...api, oauth: { ...oauth, clientSecret: "" } })).toBe(
      "OAuth needs the client secret.",
    );
    expect(demoApiRefusal({ ...api, authHeader: "Authorization: Bearer " })).toBeNull();
  });
});
