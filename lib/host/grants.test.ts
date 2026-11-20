import { describe, expect, it } from "vitest";
import {
  ALL_VERBS,
  CONSOLE,
  ROOT,
  VERBS,
  toolResource,
  toolsetResource,
} from "@/lib/ontology-rbac";
import { adminScope, reaches, scopeOf } from "./grants";

const none = { everything: false, allToolsets: false, toolsets: [], tools: [], console: false };

describe("scopeOf", () => {
  it("lets the root, or a parent of it, cover every kind, and never everything", () => {
    const all = { ...none, allToolsets: true, console: true };
    expect(scopeOf({ [ROOT]: { actions: [ALL_VERBS] } })).toEqual(all);
    expect(scopeOf({ "/custom/ontology": { actions: [ALL_VERBS] } })).toEqual(all);
    expect(scopeOf({ "/custom/": { actions: [ALL_VERBS] } })).toEqual(all);
  });

  it("counts a resource held with the wrong verb for nothing", () => {
    expect(scopeOf({ [toolsetResource("sis")]: { actions: [VERBS.tools] } })).toEqual(none);
    expect(scopeOf({ [CONSOLE]: { actions: [VERBS.toolsets] } })).toEqual(none);
    expect(scopeOf({ [ROOT]: { actions: [VERBS.tools] } })).toEqual(none);
    expect(scopeOf({ [toolsetResource("sis")]: {} })).toEqual(none);
  });

  it("matches every verb with Ontology/*, anchored", () => {
    const grants = {
      [toolsetResource("sis-raw")]: { actions: [ALL_VERBS] },
      [toolResource("list_students")]: { actions: [ALL_VERBS] },
      [CONSOLE]: { actions: [ALL_VERBS] },
    };
    expect(scopeOf(grants)).toEqual({
      ...none,
      toolsets: ["sis-raw"],
      tools: ["list_students"],
      console: true,
    });
    expect(scopeOf({ [CONSOLE]: { actions: ["Ontology/Console"] } })).toEqual(none);
    expect(scopeOf({ [CONSOLE]: { actions: ["*/Console/action"] } }).console).toBe(true);
  });

  it("holds a toolset by name, and the whole kind lends no tool", () => {
    const grants = {
      [toolsetResource("crm")]: { actions: [VERBS.toolsets] },
      [`${ROOT}toolsets/`]: { actions: [VERBS.toolsets] },
      [`${ROOT}tools/`]: { actions: [VERBS.tools] },
      [`${ROOT}toolsets/a/b/`]: { actions: [VERBS.toolsets] },
    };
    expect(scopeOf(grants)).toEqual({ ...none, allToolsets: true, toolsets: ["crm"] });
  });

  it("ignores what is not the ontology's", () => {
    expect(scopeOf({ "/custom/other/toolsets/x/": { actions: [ALL_VERBS] } })).toEqual(none);
  });
});

describe("adminScope and reaches", () => {
  it("lends an admin everything and the console, keeping what they hold", () => {
    const held = { ...none, toolsets: ["sis-raw"] };
    expect(adminScope(held)).toEqual({
      ...held,
      everything: true,
      allToolsets: true,
      console: true,
    });
  });

  it("says whether anything is reached", () => {
    expect(reaches(none)).toBe(false);
    expect(reaches({ ...none, everything: true })).toBe(true);
    expect(reaches({ ...none, tools: ["x"] })).toBe(true);
    expect(reaches({ ...none, console: true })).toBe(true);
  });
});
