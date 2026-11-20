import { beforeEach, describe, expect, it, vi } from "vitest";
import { aoFetch } from "./ao";
import { callSemantic } from "./semantic";

vi.mock("./ao", () => ({
  aoFetch: vi.fn<typeof import("./ao").aoFetch>(),
  aoJson: vi.fn<typeof import("./ao").aoJson>(),
}));
vi.mock("./platform", () => ({ currentPlatform: () => "acme" }));
vi.mock("./reading", () => ({ readEngine: vi.fn<typeof import("./reading").readEngine>() }));

// The engine's stream for one run: its frames, then [DONE].
const stream = (...events: unknown[]) =>
  new Response(
    [...events.map((e) => `data: ${JSON.stringify(e)}`), "data: [DONE]", ""].join("\n\n"),
    { headers: { "content-type": "text/event-stream" } },
  );

const ask = () => callSemantic("ask_question", { question: "How many students are enrolled?" });

describe("ask_question", () => {
  beforeEach(() => {
    vi.mocked(aoFetch).mockReset();
    vi.unstubAllEnvs();
  });

  it("returns the answer and the SQL that ran", async () => {
    const answer = { response: "153 students.", sql_code: "SELECT count(*) FROM enrollments" };
    vi.mocked(aoFetch).mockResolvedValue(stream({ type: "result", answer }));
    const result = await ask();
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      answer: "153 students.",
      sql: "SELECT count(*) FROM enrollments",
      provenance: null,
    });
  });

  const noAnswer = { response: "LLM failed to produce a response.", sql_code: "" };

  it("fails when the engine's model gave no answer, and says the server holds no key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(aoFetch).mockResolvedValue(stream({ type: "result", answer: noAnswer }));
    const result = await ask();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^LLM failed to produce a response\. /);
    expect(result.content[0].text).toContain("its operator sets OPENAI_API_KEY");
  });

  it("does not blame a missing key when the server holds one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "set");
    vi.mocked(aoFetch).mockResolvedValue(stream({ type: "result", answer: noAnswer }));
    const result = await ask();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("did not answer in three tries");
    expect(result.content[0].text).not.toContain("OPENAI_API_KEY");
  });

  it("fails in the engine's words when the run ends in an error", async () => {
    vi.mocked(aoFetch).mockResolvedValue(stream({ type: "error", message: "no semantic layer" }));
    expect(await ask()).toEqual({
      content: [{ type: "text", text: "no semantic layer" }],
      isError: true,
    });
  });
});
