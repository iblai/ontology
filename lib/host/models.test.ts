import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serveModel } from "./models";

const KEY = "0123abcd";

// The engine's call: its own key, one of its two fixed model names.
const call = (body: unknown, key: string | null = KEY) =>
  new Request("http://127.0.0.1:3000/internal/models/v1/x", {
    method: "POST",
    headers: key === null ? {} : { authorization: `Bearer ${key}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const chat = {
  model: "openai/chat",
  messages: [{ role: "user", content: "hi" }],
  max_completion_tokens: 400,
  response_format: { type: "json_schema", json_schema: { name: "t", schema: {} } },
};

describe("the engine's model route", () => {
  let dir = "";
  let fetch = vi.fn<typeof globalThis.fetch>();

  // What the route sent on: the address, the headers and the body.
  const sent = () => {
    const [url, init] = fetch.mock.calls[0];
    return {
      url: String(url),
      init,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ontology-models-"));
    await writeFile(path.join(dir, "model-key"), `${KEY}\n`);
  });

  beforeEach(() => {
    vi.stubEnv("ONTOLOGY_MODEL_KEY_FILE", path.join(dir, "model-key"));
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_API_BASE_URL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "");
    fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is not there on a server that keeps no model key", async () => {
    vi.stubEnv("ONTOLOGY_MODEL_KEY_FILE", "");
    expect((await serveModel(call(chat), "chat/completions")).status).toBe(404);
    vi.stubEnv("ONTOLOGY_MODEL_KEY_FILE", path.join(dir, "missing"));
    expect((await serveModel(call(chat), "chat/completions")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([["another"], [""], [null]])("takes only the engine's own key, not %j", async (key) => {
    const answer = await serveModel(call(chat, key), "chat/completions");
    expect(answer.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 403 with no OpenAI key, and nothing leaves the server", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const answer = await serveModel(call(chat), "chat/completions");
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({
      error: { message: expect.stringContaining("OPENAI_API_KEY") },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a chat call on with the model swapped and the rest untouched", async () => {
    const answer = await serveModel(call(chat), "chat/completions");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    expect(sent().url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent().headers.authorization).toBe("Bearer sk-test");
    expect(sent().init?.redirect).toBe("manual");
    expect(sent().body).toEqual({ ...chat, model: "gpt-4.1" });
  });

  it("uses the model and the address it is told", async () => {
    vi.stubEnv("OPENAI_MODEL", "openai/gpt-4.1");
    vi.stubEnv("OPENAI_API_BASE_URL", "https://gateway.example/api/v1/");
    await serveModel(call(chat), "chat/completions");
    expect(sent().url).toBe("https://gateway.example/api/v1/chat/completions");
    expect(sent().body.model).toBe("openai/gpt-4.1");
  });

  it("drops the three fields OpenAI does not take and asks for 2048 dimensions", async () => {
    const embedding = {
      model: "openai/embedding",
      input: ["a", "b"],
      encoding_format: "float",
      input_type: "passage",
      truncate: "END",
      modality: "text",
    };
    await serveModel(call(embedding), "embeddings");
    expect(sent().url).toBe("https://api.openai.com/v1/embeddings");
    expect(sent().body).toEqual({
      model: "text-embedding-3-large",
      input: ["a", "b"],
      encoding_format: "float",
      dimensions: 2048,
    });
  });

  it.each(["rerank", "models", "constructor", "chat/completions/x"])(
    "does not serve %s",
    async (path) => {
      expect((await serveModel(call({ model: "openai/rerank" }), path)).status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("returns the model's own refusal, with when to ask again", async () => {
    fetch.mockResolvedValueOnce(
      Response.json(
        { error: { message: "slow down" } },
        { status: 429, headers: { "retry-after": "7" } },
      ),
    );
    const answer = await serveModel(call(chat), "chat/completions");
    expect(answer.status).toBe(429);
    expect(answer.headers.get("retry-after")).toBe("7");
    expect(await answer.json()).toEqual({ error: { message: "slow down" } });
  });

  it("follows no redirect with the key", async () => {
    const location = "https://elsewhere.example/v1/chat/completions";
    fetch.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location } }));
    const answer = await serveModel(call(chat), "chat/completions");
    expect(answer.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says so when the model does not answer", async () => {
    fetch.mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }),
    );
    const answer = await serveModel(call(chat), "chat/completions");
    expect(answer.status).toBe(502);
    expect(await answer.json()).toMatchObject({
      error: { message: "The model at api.openai.com did not answer (ECONNREFUSED)." },
    });
  });

  it.each(["not json", "[1]", "null"])("refuses a body that is %s", async (body) => {
    expect((await serveModel(call(body), "chat/completions")).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
