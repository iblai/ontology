import { describe, expect, it } from "vitest";
import { errorMessage, parseBody, playTool, playTools, toolRun } from "./result";

const call = (texts: string[], isError = false) => ({
  jsonrpc: "2.0",
  id: 1,
  result: { content: texts.map((text) => ({ type: "text", text })), isError },
});

describe("toolRun", () => {
  it("turns each text content into rows, flattening a list", () => {
    const r = toolRun("list", 200, 12, call(['{"a":1}', '[{"a":2},{"a":3}]', "plain"]), "OK");
    expect(r).toEqual({
      ok: true,
      status: 200,
      ms: 12,
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { value: "plain" }],
    });
  });

  it("reads ask_question's one JSON as the answer", () => {
    const text = JSON.stringify({
      answer: "312 students",
      sql: "SELECT 1",
      provenance: "term Student",
    });
    expect(toolRun("ask_question", 200, 5, call([text]), "OK").answer).toEqual({
      text: "312 students",
      sql: "SELECT 1",
      provenance: "term Student",
    });
  });

  it("fails in the gateway's own words", () => {
    expect(toolRun("x", 200, 1, call(["boom"], true), "OK")).toEqual({
      ok: false,
      status: 200,
      ms: 1,
      error: "boom",
    });
    const rpcError = { jsonrpc: "2.0", id: 1, error: { code: -32003, message: "not in scope" } };
    expect(toolRun("x", 200, 1, rpcError, "OK").error).toBe("not in scope");
    expect(toolRun("x", 401, 1, { error: "Sign in again." }, "Unauthorized").error).toBe(
      "Sign in again.",
    );
    expect(toolRun("x", 502, 1, "<html>", "Bad Gateway").error).toBe("Bad Gateway");
  });
});

describe("playTools", () => {
  it("starts each tool with one empty value per required property", () => {
    const tool = {
      name: "get_student",
      inputSchema: { type: "object" as const, properties: {}, required: ["student_id"] },
    };
    expect(playTool(tool)).toEqual({ name: "get_student", args: '{"student_id":""}' });
    expect(playTools({ result: { tools: [tool] } }, "OK")).toHaveLength(1);
    expect(() => playTools({ error: { code: -32601, message: "no" } }, "OK")).toThrow("no");
  });
});

describe("errorMessage and parseBody", () => {
  it("prefers the host's error, then the engine's detail, then the status", () => {
    expect(errorMessage({ error: "a" }, "s")).toBe("a");
    expect(errorMessage({ detail: "b" }, "s")).toBe("b");
    expect(errorMessage({ detail: [{ msg: "c" }, { msg: "d" }] }, "s")).toBe("c; d");
    expect(errorMessage(undefined, "Bad Gateway")).toBe("Bad Gateway");
  });

  it("reads JSON or the last event-stream frame", () => {
    expect(parseBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseBody('event: message\ndata: {"a":2}\n\n')).toEqual({ a: 2 });
    expect(parseBody("nope")).toBe("nope");
  });
});

describe("an API's answer", () => {
  const run = (value: unknown) => toolRun("find", 200, 9, call([JSON.stringify(value)]), "OK");

  it("shows Twenty's list as its records, with the total", () => {
    const people = [{ id: "1" }, { id: "2" }];
    const r = run({ data: { people }, totalCount: 1201, pageInfo: { hasNextPage: true } });
    expect(r.rows).toEqual(people);
    expect(r.total).toBe(1201);
  });

  it("shows a list under a usual name, and no total when every record is there", () => {
    const r = run({ items: [{ id: "1" }], total: 1 });
    expect(r.rows).toEqual([{ id: "1" }]);
    expect(r.total).toBeUndefined();
  });

  it("shows one record under data as itself", () => {
    expect(run({ data: { person: { id: "1", tags: ["a"] } } }).rows).toEqual([
      { id: "1", tags: ["a"] },
    ]);
  });

  it("leaves a record that merely holds a list as one row", () => {
    const record = { id: "1", name: "Ada", addresses: [{ city: "Paris" }] };
    expect(run(record).rows).toEqual([record]);
  });
});
