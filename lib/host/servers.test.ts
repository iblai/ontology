import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "./errors";
import { homePath } from "./files";
import { record } from "./log";
import { inPlatform } from "./platform";
import { listServers, readServer, rollbackServer, saveServer, serving } from "./servers";
import * as toolbox from "./toolbox";
import { parseConfig, type ToolboxDoc } from "./toolbox-config";
import { serverDocs } from "./toolsets";
import type { HostServerDraft } from "./types";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/ontology-servers-test-${process.pid}-${Date.now()}`;
  process.env.ONTOLOGY_HOME = dir;
  return dir;
});

// A stand-in file format: a title line, then the documents as JSON.
vi.mock("./toolbox-config", async () => {
  const { createHash } = await import("node:crypto");
  type Doc = { kind: string; name: string; tools?: string[]; writes?: boolean };
  return {
    MARK: "loaded-",
    parseConfig: vi.fn<typeof import("./toolbox-config").parseConfig>((text: string) =>
      JSON.parse(text.split("\n").slice(1).join("\n")),
    ),
    renderConfig: vi.fn<typeof import("./toolbox-config").renderConfig>(
      (docs: Doc[], title: string) => {
        const body = JSON.stringify(docs);
        const id = createHash("sha256").update(body).digest("hex").slice(0, 12);
        return { yaml: `# ${title}\n${body}`, mark: `loaded-${id}`, id };
      },
    ),
    members: vi.fn<typeof import("./toolbox-config").members>((docs: Doc[]) =>
      Object.fromEntries(
        docs.filter((d) => d.kind === "toolset").map((d) => [d.name, d.tools ?? []]),
      ),
    ),
    writingToolsets: vi.fn<typeof import("./toolbox-config").writingToolsets>((docs: Doc[]) =>
      docs.filter((d) => d.kind === "toolset" && d.writes).map((d) => d.name),
    ),
    validateDocs: vi.fn<typeof import("./toolbox-config").validateDocs>(),
  };
});
vi.mock("./toolsets", () => ({
  loadCatalog: vi.fn<typeof import("./toolsets").loadCatalog>(async () => ({
    docs: [],
    toolsets: [],
    skipped: [],
  })),
  serverDocs: vi.fn<typeof import("./toolsets").serverDocs>(),
}));
vi.mock("./log", () => ({
  record: vi.fn<typeof import("./log").record>(async () => undefined),
  stats: vi.fn<typeof import("./log").stats>(async () => ({ calls24h: 0, top: null })),
}));
vi.mock("./semantic", () => ({
  SEMANTIC_TOOLSET: "semantic",
  SEMANTIC_TOOLS: [{ name: "ask_question" }, { name: "search_terms" }, { name: "describe_table" }],
}));
vi.mock("./toolbox", () => ({
  status: vi.fn<typeof import("./toolbox").status>(),
  start: vi.fn<typeof import("./toolbox").start>(),
  stop: vi.fn<typeof import("./toolbox").stop>(),
  confirmLoaded: vi.fn<typeof import("./toolbox").confirmLoaded>(),
  launchChanged: vi.fn<typeof import("./toolbox").launchChanged>(),
}));

const docsA: ToolboxDoc[] = [
  { kind: "tool", name: "list_students" },
  { kind: "tool", name: "sis_execute_sql" },
  { kind: "toolset", name: "sis", tools: ["list_students"] },
  { kind: "toolset", name: "sis-raw", tools: ["sis_execute_sql"], writes: true },
];
const docsB: ToolboxDoc[] = [
  { kind: "tool", name: "list_students" },
  { kind: "toolset", name: "sis", tools: ["list_students"] },
];

const draft = (toolsets: string[]): HostServerDraft => ({
  toolsets,
  auth: { platform: true },
  origins: [],
  hosts: [],
});

const running = { running: true, pid: 4242, port: 5000 };

// Every test runs for one platform, as every route does.
const acme = (run: () => Promise<void>) => () => inPlatform("acme", run);

beforeEach(async () => {
  vi.clearAllMocks();
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  vi.mocked(serverDocs).mockReturnValue(docsA);
  vi.mocked(toolbox.status).mockResolvedValue(running);
  vi.mocked(toolbox.start).mockResolvedValue(running);
  vi.mocked(toolbox.stop).mockResolvedValue(undefined);
  vi.mocked(toolbox.confirmLoaded).mockResolvedValue(undefined);
  vi.mocked(toolbox.launchChanged).mockResolvedValue(false);
});

afterAll(() => rm(home, { recursive: true, force: true }));

describe("revisions", () => {
  it(
    "writes a revision per change and none for an unchanged save",
    acme(async () => {
      const first = await saveServer("sis", draft(["sis"]), false);
      expect(first.revision).toBe(1);
      expect(first.enabled).toBe(false);
      expect(first.yaml.startsWith("# sis · rev 1\n")).toBe(true);

      // The same draft with its keys in another order is the same draft.
      const reordered = { hosts: [], origins: [], auth: { platform: true }, toolsets: ["sis"] };
      const again = await saveServer("sis", reordered, false);
      expect(again.revision).toBe(1);
      expect(again.revisions).toHaveLength(1);

      vi.mocked(serverDocs).mockReturnValue(docsB);
      const second = await saveServer("sis", draft(["sis"]), false);
      expect(second.revision).toBe(2);
      expect(second.revisions.map((r) => r.n)).toEqual([2, 1]);
      expect(second.revisions[0].id).toMatch(/^[0-9a-f]{12}$/);

      const files = (await readdir(homePath("servers", "sis", "revisions"))).sort();
      expect(files).toHaveLength(4);
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(2);
      expect(toolbox.start).not.toHaveBeenCalled();
    }),
  );

  it(
    "rolls back one at a time, refuses at the first, and numbers on from the highest",
    acme(async () => {
      await saveServer("sis", draft(["sis", "sis-raw"]), false);
      const firstYaml = (await readServer("sis"))?.yaml;
      vi.mocked(serverDocs).mockReturnValue(docsB);
      await saveServer("sis", draft(["sis"]), false);

      const back = await rollbackServer("sis");
      expect(back.revision).toBe(1);
      expect(back.yaml).toBe(firstYaml);
      expect(back.draft.toolsets).toEqual(["sis", "sis-raw"]);
      expect(back.revisions).toHaveLength(2);

      await expect(rollbackServer("sis")).rejects.toThrow("There is no earlier revision.");

      vi.mocked(serverDocs).mockReturnValue([...docsB, { kind: "toolset", name: "x", tools: [] }]);
      const third = await saveServer("sis", draft(["sis", "x"]), false);
      expect(third.revision).toBe(3);
    }),
  );

  it(
    "refuses a rollback with nothing before it",
    acme(async () => {
      await saveServer("sis", draft(["sis"]), false);
      const error = await rollbackServer("sis").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HostError);
      expect((error as HostError).status).toBe(400);
    }),
  );
});

describe("deploy", () => {
  it(
    "marks the server deployed only after the runtime answers for the mark",
    acme(async () => {
      const saved = await saveServer("sis", draft(["sis", "sis-raw", "semantic"]), true);
      const mark = `loaded-${saved.revisions[0].id}`;
      expect(toolbox.confirmLoaded).toHaveBeenCalledWith("sis", mark);
      expect(saved.enabled).toBe(true);
      expect(saved.deployedAt).not.toBeNull();
      expect(saved.toolsets).toBe(3);
      expect(saved.tools).toBe(5);
      expect(record).toHaveBeenCalledWith(
        "sis",
        "INFO",
        "config reloaded tools.yaml (rev 1) · 5 tools · 3 toolsets",
      );
    }),
  );

  it(
    "starts the runtime when down or relaunched, else relies on its reload",
    acme(async () => {
      vi.mocked(toolbox.status).mockResolvedValueOnce({ running: false, pid: null, port: null });
      await saveServer("sis", draft(["sis"]), true);
      expect(toolbox.start).toHaveBeenCalledTimes(1);

      vi.mocked(serverDocs).mockReturnValue(docsB);
      await saveServer("sis", draft(["sis"]), false); // deployed: a save is a deploy
      expect(toolbox.start).toHaveBeenCalledTimes(1);
      expect(toolbox.confirmLoaded).toHaveBeenCalledTimes(2);

      vi.mocked(toolbox.launchChanged).mockResolvedValueOnce(true);
      await saveServer("sis", { ...draft(["sis"]), origins: ["https://x.edu"] }, true);
      expect(toolbox.start).toHaveBeenCalledTimes(2);
    }),
  );

  it(
    "keeps a deployed server as it was when the runtime refuses the new file",
    acme(async () => {
      const before = await saveServer("sis", draft(["sis", "sis-raw"]), true);
      vi.mocked(serverDocs).mockReturnValue(docsB);
      vi.mocked(toolbox.confirmLoaded).mockRejectedValueOnce(new HostError(502, "refused"));
      await expect(saveServer("sis", draft(["sis"]), true)).rejects.toThrow("refused");

      const after = await readServer("sis");
      expect(after?.revision).toBe(1);
      expect(after?.enabled).toBe(true);
      expect(after?.yaml).toBe(before.yaml);
      expect(after?.draft.toolsets).toEqual(["sis", "sis-raw"]);
      expect(after?.revisions).toHaveLength(1);
    }),
  );

  it(
    "leaves a first deploy that fails saved as a draft, and stops the runtime",
    acme(async () => {
      vi.mocked(toolbox.confirmLoaded).mockRejectedValueOnce(new HostError(502, "refused"));
      await expect(saveServer("sis", draft(["sis"]), true)).rejects.toThrow("refused");
      const after = await readServer("sis");
      expect(after?.enabled).toBe(false);
      expect(after?.revision).toBe(1);
      expect(toolbox.stop).toHaveBeenCalledWith("sis");
    }),
  );

  it(
    "writes and runs a server whose only toolset is the semantic one",
    acme(async () => {
      vi.mocked(serverDocs).mockReturnValue([]);
      const saved = await saveServer("sis", draft(["semantic"]), true);
      expect(saved.yaml).toBe("# sis · rev 1\n[]");
      expect(saved.toolsets).toBe(1);
      expect(saved.tools).toBe(3);
      expect(saved.enabled).toBe(true);
    }),
  );
});

describe("serving", () => {
  it(
    "is null for a draft and for no server",
    acme(async () => {
      expect(await serving("nobody")).toBeNull();
      await saveServer("sis", draft(["sis"]), false);
      expect(await serving("sis")).toBeNull();
    }),
  );

  it(
    "gives members with the semantic toolset added and the toolsets that write",
    acme(async () => {
      await saveServer("sis", draft(["sis", "sis-raw", "semantic"]), true);
      expect(await serving("sis")).toEqual({
        draft: draft(["sis", "sis-raw", "semantic"]),
        members: {
          sis: ["list_students"],
          "sis-raw": ["sis_execute_sql"],
          semantic: ["ask_question", "search_terms", "describe_table"],
        },
        writes: ["sis-raw"],
        files: [],
        signed: {},
        dollars: {},
      });
    }),
  );

  it(
    "names each tool’s $ query names, which callers know without the $",
    acme(async () => {
      const query = (...names: string[]) =>
        names.map((name) => ({ name, type: "string", description: name, required: false }));
      vi.mocked(serverDocs).mockReturnValue([
        {
          kind: "tool",
          name: "outlook_list_messages",
          type: "http",
          source: "outlook-reads",
          queryParams: query("$filter", "$top", "pageToken"),
        },
        {
          kind: "tool",
          name: "crm_list_deals",
          type: "http",
          source: "crm-reads",
          queryParams: query("q"),
        },
        { kind: "toolset", name: "outlook-reads", tools: ["outlook_list_messages"] },
      ]);
      await saveServer("mail", draft(["outlook-reads"]), true);
      expect((await serving("mail"))?.dollars).toEqual({
        outlook_list_messages: ["$filter", "$top"],
      });
    }),
  );

  it(
    "names the tools the gateway signs, each by its OAuth API",
    acme(async () => {
      const header = [
        { name: "Authorization", type: "string", description: "Set by the gateway." },
      ];
      const tool = (name: string, source: string, headerParams?: object[]): ToolboxDoc => ({
        kind: "tool",
        name,
        type: "http",
        source,
        ...(headerParams ? { headerParams } : {}),
      });
      vi.mocked(serverDocs).mockReturnValue([
        tool("canvas_list_courses", "canvas-reads", header),
        tool("canvas_grade", "canvas-writes", header),
        tool("crm_list_deals", "crm-reads"),
        tool("by_hand", "elsewhere", header),
        { kind: "toolset", name: "canvas-reads", tools: ["canvas_list_courses"] },
      ]);
      await saveServer("lms", draft(["canvas-reads"]), true);
      expect((await serving("lms"))?.signed).toEqual({
        canvas_list_courses: "canvas",
        canvas_grade: "canvas",
      });
    }),
  );

  it(
    "adds a filesystem’s toolset with its two tools, unless a document has that name",
    acme(async () => {
      const tagged: ToolboxDoc = { kind: "toolset", name: "tag-files", tools: ["list_students"] };
      vi.mocked(serverDocs).mockReturnValue([...docsB, tagged]);
      const saved = await saveServer("sis", draft(["sis", "docs-files", "tag-files"]), true);
      expect([saved.toolsets, saved.tools]).toEqual([3, 3]);
      expect(await serving("sis")).toMatchObject({
        members: {
          sis: ["list_students"],
          "tag-files": ["list_students"],
          "docs-files": ["docs_list_files", "docs_read_file"],
        },
        files: ["docs-files"],
      });
    }),
  );

  it(
    "parses tools.yaml again only when the file changes",
    acme(async () => {
      await saveServer("cache", draft(["sis"]), true);
      vi.mocked(parseConfig).mockClear();
      await serving("cache");
      await serving("cache");
      expect(parseConfig).toHaveBeenCalledTimes(1);

      vi.mocked(serverDocs).mockReturnValue(docsB);
      await saveServer("cache", draft(["sis"]), true);
      vi.mocked(parseConfig).mockClear();
      const now = await serving("cache");
      expect(parseConfig).toHaveBeenCalledTimes(1);
      expect(now?.writes).toEqual([]);
      const text = await readFile(homePath("servers", "cache", "tools.yaml"), "utf8");
      expect(text.startsWith("# cache · rev 2\n")).toBe(true);
    }),
  );
});

describe("platforms", () => {
  it(
    "keeps a server out of another platform that has one of the same name",
    acme(async () => {
      await saveServer("sis", draft(["sis", "sis-raw"]), true);
      expect(await inPlatform("empty", () => listServers())).toEqual([]);
      expect(await inPlatform("empty", () => readServer("sis"))).toBeNull();

      vi.mocked(serverDocs).mockReturnValue(docsB);
      await inPlatform("other", () => saveServer("sis", draft(["sis"]), true));
      expect((await inPlatform("other", () => serving("sis")))?.writes).toEqual([]);
      expect((await serving("sis"))?.writes).toEqual(["sis-raw"]);
    }),
  );
});
