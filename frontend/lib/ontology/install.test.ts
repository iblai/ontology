import { describe, expect, it } from "vitest";
import { INSTALL_SCRIPT, hostName, installCommand, validHost } from "./install";

describe("the install command", () => {
  it("takes the host name out of what was typed or pasted", () => {
    expect(hostName("  Ontology.Acme.edu ")).toBe("ontology.acme.edu");
    expect(hostName("https://ontology.acme.edu/mcp?x=1")).toBe("ontology.acme.edu");
    expect(hostName("ontology.acme.edu:8443")).toBe("ontology.acme.edu");
    // Half a scheme, as it is while being typed, is no host name yet.
    expect(validHost(hostName("https:"))).toBe(false);
  });

  it("takes a full host name and nothing else", () => {
    const taken = ["ontology.acme.edu", "a.io", "x-1.campus.example.co.uk", "o.xn--p1ai"];
    expect(taken.filter((host) => !validHost(host))).toEqual([]);
    const refused = [
      "",
      "ontology",
      "localhost",
      "10.0.0.7",
      "-a.acme.edu",
      "a-.acme.edu",
      "a..edu",
      "acme.edu.",
      "a b.edu",
      "a.edu;reboot",
      `${"a".repeat(64)}.edu`,
    ];
    expect(refused.filter((host) => validHost(host))).toEqual([]);
  });

  it("names what is known, one flag a line", () => {
    const command = installCommand({
      platform: "acme",
      platformUrl: "https://api.iblai.app/dm",
      host: "ontology.acme.edu",
    });
    expect(command.split(" \\\n")).toEqual([
      `curl -fsSL ${INSTALL_SCRIPT}`,
      "  | sudo bash -s --",
      "    --platform acme",
      "    --platform-url https://api.iblai.app/dm",
      "    --host ontology.acme.edu",
    ]);
  });

  it("leaves out what is unknown or more than one plain word, for the script to ask", () => {
    const bare = installCommand({ platform: "", platformUrl: "", host: "ontology" });
    expect(bare).toBe(`curl -fsSL ${INSTALL_SCRIPT} \\\n  | sudo bash`);
    const odd = installCommand({
      platform: "acme; reboot",
      platformUrl: "https://api.iblai.app/dm $(id)",
      host: "ontology.acme.edu",
    });
    expect(odd).not.toMatch(/reboot|\$\(/);
    expect(odd).toContain("--host ontology.acme.edu");
  });
});
