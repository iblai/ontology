import { afterEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_HEADER } from "@/lib/platform";
import { asConsole } from "./guard";

const call = (platform: string) =>
  new Request("https://ontology.example/api/host/systems", {
    headers: { [PLATFORM_HEADER]: platform, authorization: "Token t" },
  });

describe("asConsole on a server with an engine of its own", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses another platform before ibl.ai is asked", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("AO_URL", "http://127.0.0.1:3100");
    vi.stubEnv("ONTOLOGY_PLATFORM", "acme");
    const run = vi.fn(() => new Response());
    await expect(asConsole(call("beta"), run)).rejects.toMatchObject({
      status: 403,
      message: "This server serves another platform.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 503 naming the setting while its platform is not named", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("AO_URL", "http://127.0.0.1:3100");
    vi.stubEnv("ONTOLOGY_PLATFORM", "");
    const run = vi.fn(() => new Response());
    await expect(asConsole(call("acme"), run)).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/^ONTOLOGY_PLATFORM is not set/),
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
