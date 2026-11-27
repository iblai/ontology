import { describe, expect, it } from "vitest";
import { demoDeployRefusal } from "./demo";

describe("a deploy in the demo", () => {
  it("opens one of its sample servers", () => {
    expect(demoDeployRefusal("institution")).toBeNull();
  });

  it("is refused for any other, which the demo never creates", () => {
    expect(demoDeployRefusal("touch-test")).toBe(
      "The demo creates no servers. Deploy one of its samples: institution, advancement, lms-analytics.",
    );
  });
});
