import { describe, expect, it, vi } from "vitest";
import { saveLatest } from "./save-latest";

/** A save whose requests are answered by hand, in the order they were made. */
function byHand() {
  const sent: { value: string; answer: (ok: boolean) => void }[] = [];
  const settled: [string, boolean][] = [];
  const save = saveLatest(
    (value: string) =>
      new Promise<{ ok: boolean }>((resolve) => {
        sent.push({ value, answer: (ok) => resolve({ ok }) });
      }),
    (value, result) => settled.push([value, result.ok]),
  );
  return { sent, settled, save };
}

describe("saveLatest", () => {
  it("sends one value at a time and never one replaced while it waited", async () => {
    const { sent, settled, save } = byHand();
    const all = save("a");
    void save("b");
    void save("c");
    expect(sent.map((s) => s.value)).toEqual(["a"]);
    sent[0].answer(true);
    await vi.waitFor(() => expect(sent.map((s) => s.value)).toEqual(["a", "c"]));
    sent[1].answer(true);
    await all;
    expect(settled).toEqual([
      ["a", true],
      ["c", true],
    ]);
  });

  it("does not tell a failure that a newer value overtakes", async () => {
    const { sent, settled, save } = byHand();
    const all = save("a");
    void save("b");
    sent[0].answer(false);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    sent[1].answer(true);
    await all;
    expect(settled).toEqual([["b", true]]);
  });

  it("tells the last failure, and saves again after it", async () => {
    const { sent, settled, save } = byHand();
    const first = save("a");
    sent[0].answer(false);
    await first;
    expect(settled).toEqual([["a", false]]);
    const second = save("b");
    sent[1].answer(true);
    await second;
    expect(settled).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("saves again after a request that throws", async () => {
    const sent: string[] = [];
    const save = saveLatest(
      async (value: string) => {
        sent.push(value);
        if (value === "a") throw new Error("down");
        return { ok: true };
      },
      () => undefined,
    );
    await expect(save("a")).rejects.toThrow("down");
    await save("b");
    expect(sent).toEqual(["a", "b"]);
  });
});
