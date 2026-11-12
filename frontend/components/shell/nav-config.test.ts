import { describe, expect, it } from "vitest";
import { crumbsFor, sidebarSections } from "./nav-config";

describe("sidebarSections", () => {
  it("lists the backend's own page in the hosted console alone", () => {
    const rows = (hosted: boolean) =>
      sidebarSections(hosted).flatMap((group) => group.items.map((item) => item.href));
    expect(rows(false)).not.toContain("/backend");
    expect(rows(true)).toEqual([...rows(false), "/backend"]);
  });
});

describe("crumbsFor", () => {
  it("names a page under its group", () => {
    expect(crumbsFor("/roles")).toEqual([
      { label: "groupGateway" },
      { label: "roles", href: "/roles" },
    ]);
    expect(crumbsFor("/agents")).toEqual([
      { label: "groupGateway" },
      { label: "agents", href: "/agents" },
    ]);
  });

  it("adds a record name or a named sub-page", () => {
    expect(crumbsFor("/services/canvas%20lms").at(-1)).toEqual({ label: "canvas lms", raw: true });
    expect(crumbsFor("/services/%E0%A4%A").at(-1)).toEqual({ label: "%E0%A4%A", raw: true });
    expect(crumbsFor("/services/add").at(-1)).toEqual({ label: "addService" });
    expect(crumbsFor("/mcp/playground")).toHaveLength(3);
  });

  it("labels pages outside the sidebar and nothing else", () => {
    expect(crumbsFor("/notifications/42")).toEqual([{ label: "notifications" }]);
    expect(crumbsFor("/")).toEqual([]);
    expect(crumbsFor("/nope")).toEqual([]);
    expect(crumbsFor("/constructor")).toEqual([]);
  });
});
