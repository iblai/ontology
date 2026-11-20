import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browse,
  callLocal,
  filesNotes,
  filesTools,
  isFilesToolset,
  listLocals,
  saveLocal,
} from "./local";
import { inPlatform } from "./platform";

let root: string;
let outside: string;

const run = <T>(work: () => Promise<T>) => inPlatform("acme", work);
const parsed = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text);
const list = (toolset: string, at?: string) =>
  run(() =>
    callLocal(
      toolset,
      `${toolset.replace(/-files$/, "").replaceAll("-", "_")}_list_files`,
      at === undefined ? {} : { path: at },
    ),
  );
const read = (toolset: string, args: Record<string, unknown>) =>
  run(() =>
    callLocal(toolset, `${toolset.replace(/-files$/, "").replaceAll("-", "_")}_read_file`, args),
  );

describe("filesystems", () => {
  beforeEach(async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), "ontology-local-")));
    root = path.join(base, "root");
    outside = path.join(base, "outside");
    await mkdir(path.join(root, "docs", "sub"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, "docs", "a.txt"), "hello");
    await writeFile(path.join(outside, "secret.txt"), "nope");
    vi.stubEnv("ONTOLOGY_LOCAL_ROOT", root);
    vi.stubEnv("ONTOLOGY_HOME", path.join(root, "server"));
    vi.stubEnv("ONTOLOGY_PLATFORM", "acme");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  const save = (name: string, at: string) => run(() => saveLocal({ name, url: `local://${at}` }));

  it("names the two tools from the toolset", () => {
    expect(filesTools("docs-2026-files").map((tool) => tool.name)).toEqual([
      "docs_2026_list_files",
      "docs_2026_read_file",
    ]);
    expect(filesNotes("docs-files")[1].sig).toBe("docs_read_file(path, offset?, limit?)");
    expect(isFilesToolset("docs-files")).toBe(true);
    expect(isFilesToolset("-files")).toBe(false);
    expect(isFilesToolset("docs")).toBe(false);
  });

  it("saves a folder and lists it back", async () => {
    const docs = path.join(root, "docs");
    expect(await save("docs", docs)).toEqual({ name: "docs", url: `local://${docs}` });
    expect(await run(listLocals)).toEqual([{ name: "docs", path: docs }]);
  });

  it("refuses a bad name, an address that is not local:// and a path, and a path outside", async () => {
    await expect(save("Docs", path.join(root, "docs"))).rejects.toThrow("name starts with");
    for (const url of ["file:///srv", "local://docs", "local://~/docs"]) {
      await expect(run(() => saveLocal({ name: "docs", url }))).rejects.toThrow("absolute path");
    }
    await expect(save("out", outside)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a path that leaves its source: .., an absolute path, a symlink out", async () => {
    await symlink(outside, path.join(root, "docs", "out"));
    await save("docs", path.join(root, "docs"));
    await expect(list("docs-files", "..")).rejects.toThrow("leaves");
    await expect(read("docs-files", { path: path.join(outside, "secret.txt") })).rejects.toThrow(
      "outside",
    );
    await expect(read("docs-files", { path: "out/secret.txt" })).rejects.toThrow("outside");
  });

  it("never lists or reads a dot name, nor the server’s own folder", async () => {
    await writeFile(path.join(root, "docs", ".env"), "KEY=1");
    await mkdir(path.join(root, "server"));
    await save("docs", path.join(root, "docs"));
    expect(parsed(await list("docs-files")).entries.map((e: { name: string }) => e.name)).toEqual([
      "sub",
      "a.txt",
    ]);
    await expect(read("docs-files", { path: ".env" })).rejects.toThrow("hidden");
    await expect(save("server", path.join(root, "server"))).rejects.toThrow("own folder");
  });

  it("refuses a root of / and a server with no platform", async () => {
    vi.stubEnv("ONTOLOGY_LOCAL_ROOT", "/");
    await expect(run(() => browse())).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("ONTOLOGY_LOCAL_ROOT", root);
    vi.stubEnv("ONTOLOGY_PLATFORM", "");
    await expect(run(() => browse())).rejects.toThrow("ONTOLOGY_PLATFORM");
  });

  it("skips a symlink, lists folders first and is not truncated under the cap", async () => {
    await symlink(path.join(root, "docs", "a.txt"), path.join(root, "docs", "link.txt"));
    await writeFile(path.join(root, "docs", "0.txt"), "");
    await save("docs", path.join(root, "docs"));
    const listed = parsed(await list("docs-files"));
    expect(listed.entries.map((e: { name: string; type: string }) => [e.name, e.type])).toEqual([
      ["sub", "folder"],
      ["0.txt", "file"],
      ["a.txt", "file"],
    ]);
    expect(listed.truncated).toBe(false);
  });

  it("reads a file in pieces that each end on a whole character", async () => {
    const text = "aé日本語";
    await writeFile(path.join(root, "docs", "u.txt"), text);
    await save("docs", path.join(root, "docs"));
    const first = parsed(await read("docs-files", { path: "u.txt", limit: 5 }));
    expect(first).toMatchObject({ text: "aé", next: 3, size: Buffer.byteLength(text) });
    const second = parsed(await read("docs-files", { path: "u.txt", offset: 3, limit: 100 }));
    expect(second).toMatchObject({ text: "日本語", next: null });
  });

  it("refuses a file with a NUL byte and a named pipe", async () => {
    await writeFile(path.join(root, "docs", "bin"), Buffer.from([65, 0, 66]));
    execFileSync("mkfifo", [path.join(root, "docs", "pipe")]);
    await save("docs", path.join(root, "docs"));
    await expect(read("docs-files", { path: "bin" })).rejects.toThrow("bin is not a text file.");
    await expect(read("docs-files", { path: "pipe" })).rejects.toThrow("not a file");
    // The disk's own failure names the path as given, never the real one.
    await expect(list("docs-files", "pipe")).rejects.toThrow(/^pipe: ENOTDIR$/);
  });

  it("lists and reads a source that is one file", async () => {
    await save("one", path.join(root, "docs", "a.txt"));
    expect(parsed(await list("one-files")).entries.map((e: { name: string }) => e.name)).toEqual([
      "a.txt",
    ]);
    expect(parsed(await read("one-files", { path: "" })).text).toBe("hello");
    expect(parsed(await read("one-files", { path: "a.txt" })).text).toBe("hello");
  });

  it("browses the root with no parent and a subfolder with its parent", async () => {
    expect(await run(() => browse())).toMatchObject({ root, path: root, parent: null });
    const docs = path.join(root, "docs");
    expect(await run(() => browse(docs))).toMatchObject({ path: docs, parent: root });
  });
});
