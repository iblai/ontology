import { describe, expect, it } from "vitest";
import {
  failed,
  holds,
  keyNameFor,
  keyRows,
  matchRegistration,
  readToolsets,
  withServer,
  withUndo,
} from "./ibl-flows-pure";
import { NAME } from "./ontology-rbac";

describe("readToolsets", () => {
  it("names each toolset resource, with or without the trailing slash", () => {
    expect(
      readToolsets([
        "/custom/ontology/toolsets/advising/",
        "/custom/ontology/toolsets/enrollment",
        "/custom/ontology/tools/get_student/",
        "/mentors/",
      ]),
    ).toEqual({ toolsets: ["advising", "enrollment"], all: false });
  });

  it.each([["/custom/ontology/toolsets/"], ["/custom/ontology/"], ["/custom/"], ["/"]])(
    "%s grants every toolset",
    (resource) => {
      expect(readToolsets([resource, "/custom/ontology/toolsets/sis-raw/"])).toEqual({
        toolsets: ["sis-raw"],
        all: true,
      });
    },
  );

  it("skips a name a resource cannot spell", () => {
    expect(
      readToolsets(["/custom/ontology/toolsets/a.b/", "/custom/ontology/toolsets/x/y/"]),
    ).toEqual({ toolsets: [], all: false });
  });
});

describe("holds", () => {
  it("matches * as any run of characters", () => {
    expect(holds(["Ontology/*"], "Ontology/Toolsets/action")).toBe(true);
    expect(holds(["Ontology/Toolsets/action"], "Ontology/Toolsets/action")).toBe(true);
    expect(holds(["Ontology/Console/action"], "Ontology/Toolsets/action")).toBe(false);
    expect(holds(undefined, "Ontology/Toolsets/action")).toBe(false);
  });
});

describe("matchRegistration", () => {
  const origin = "https://ontology.example.edu";

  it("reads the slug and the agent label", () => {
    const url = `${origin}/university/advising/mcp?agent=advising-bot`;
    expect(matchRegistration(url, origin, "university")).toEqual({
      slug: "advising",
      label: "advising-bot",
    });
    const bare = `${origin}/university/advising/mcp`;
    expect(matchRegistration(bare, `${origin}/`, "university")).toEqual({
      slug: "advising",
      label: "",
    });
  });

  it.each([
    ["https://other.example.edu/university/advising/mcp"],
    ["https://ontology.example.edu.evil.com/university/advising/mcp"],
    ["https://ontology.example.edu/college/advising/mcp"],
    ["https://ontology.example.edu/advising/mcp"],
    ["https://ontology.example.edu/university/advising/sse"],
    ["https://ontology.example.edu/university/advising/mcp/"],
    ["https://ontology.example.edu/university/x/advising/mcp"],
    ["https://ontology.example.edu/university/mcp"],
  ])("refuses %s", (url) => {
    expect(matchRegistration(url, origin, "university")).toBeNull();
  });

  it("matches nothing without a platform", () => {
    expect(matchRegistration(`${origin}//advising/mcp`, origin, "")).toBeNull();
  });
});

describe("withServer", () => {
  it("adds mcp and the server to what the agent already has", () => {
    expect(
      withServer({ tool_slugs: ["web-search", "mcp"], mcp_servers: [{ id: 4 }, 9] }, 12),
    ).toEqual({ tool_slugs: ["mcp", "web-search"], can_use_tools: true, mcp_servers: [4, 9, 12] });
  });

  it("reads tools when tool_slugs is empty, and starts from nothing", () => {
    expect(withServer({ tool_slugs: [], tools: [{ slug: "code" }] }, 1).tool_slugs).toEqual([
      "code",
      "mcp",
    ]);
    expect(withServer(undefined, 7)).toEqual({
      tool_slugs: ["mcp"],
      can_use_tools: true,
      mcp_servers: [7],
    });
  });
});

describe("keyNameFor", () => {
  it("keeps to letters, digits and dashes", () => {
    expect(keyNameFor("advising", "Advising Bot (v2)")).toBe("ontology-advising-advising-bot-v2");
    expect(keyNameFor("sis_raw", "  ")).toBe("ontology-sis-raw-agent");
    expect(NAME.test(keyNameFor("x", "Ünïcode ✓ name"))).toBe(true);
  });
});

describe("keyRows", () => {
  it("keeps only keys with an ontology policy", () => {
    const rows = keyRows([
      {
        name: "ontology-advising-bot",
        created: "2026-10-02T10:00:00Z",
        expires: null,
        policies: [{ id: 1, name: "Ontology: advising" }],
        groups: [{ id: 2, name: "advisors" }],
      },
      { name: "other", created: null, expires: null, policies: [{ id: 3, name: "Admins" }] },
      { name: "listed", created: null, expires: null },
    ]);
    expect(rows).toEqual([
      {
        id: "ontology-advising-bot",
        name: "ontology-advising-bot",
        created: "2026-10-02",
        expires: "—",
        policies: ["Ontology: advising"],
        groups: ["advisors"],
      },
    ]);
  });
});

describe("failed", () => {
  it("gives the platform's words, or says it gave none", () => {
    expect(failed("Creating the role", { status: 400, data: '{"name":["already exists"]}' })).toBe(
      "Creating the role failed: name: already exists (HTTP 400).",
    );
    expect(failed("Registering the MCP server", {})).toBe(
      "Registering the MCP server failed, and the platform gave no reason.",
    );
  });
});

describe("withUndo", () => {
  it("undoes the earlier steps in reverse and says which step failed", async () => {
    const calls: string[] = [];
    const step = (name: string, fail = false) => ({
      step: name,
      run: async () => {
        calls.push(name);
        if (fail) throw {};
        return { what: `the ${name}`, run: async () => void calls.push(`undo ${name}`) };
      },
    });
    await expect(withUndo([step("key"), step("server"), step("settings", true)])).rejects.toThrow(
      "settings failed, and the platform gave no reason. Undone: the server, the key.",
    );
    expect(calls).toEqual(["key", "server", "settings", "undo server", "undo key"]);
  });

  it("says what it could not undo", async () => {
    const steps = [
      {
        step: "key",
        run: async () => ({
          what: "the API key",
          run: () => Promise.reject({ status: 500, data: "boom" }),
        }),
      },
      { step: "Registering", run: () => Promise.reject(new Error("no")) },
    ];
    await expect(withUndo(steps)).rejects.toThrow(
      "Registering failed: no. Not undone, remove it on the platform: " +
        "the API key (boom (HTTP 500)).",
    );
  });

  it("undoes nothing when every step succeeds", async () => {
    const calls: string[] = [];
    await withUndo([
      { step: "a", run: async () => ({ what: "a", run: async () => calls.push("undo a") }) },
      { step: "b", run: async () => undefined },
    ]);
    expect(calls).toEqual([]);
  });
});
