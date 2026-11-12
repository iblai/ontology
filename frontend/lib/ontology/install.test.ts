import { describe, expect, it, vi } from "vitest";
import {
  INSTALL_SCRIPT,
  PLATFORM_URL,
  addressOf,
  hostName,
  hostOf,
  installCommand,
  validHost,
} from "./install";

describe("the install command", () => {
  it("takes the host name out of what was typed or pasted", () => {
    expect(hostName("  Ontology.Acme.edu ")).toBe("ontology.acme.edu");
    expect(hostName("https://ontology.acme.edu/mcp?x=1")).toBe("ontology.acme.edu");
    expect(hostName("ontology.acme.edu:8443")).toBe("ontology.acme.edu");
    // Half a scheme, as it is while being typed, is no host name yet.
    expect(validHost(hostName("https:"))).toBe(false);
  });

  it("reads the host name back out of a plain https address, and out of no other", () => {
    expect(hostOf("https://ontology.acme.edu")).toBe("ontology.acme.edu");
    expect(hostOf(" https://Ontology.Acme.edu/ ")).toBe("ontology.acme.edu");
    // A port, a path or cleartext is an address of its own: shown as it is, not folded into a name.
    const own = [
      "https://ontology.acme.edu:8443",
      "https://ontology.acme.edu/api",
      "http://ontology.acme.edu",
      "https://localhost",
      "http://localhost",
      "ontology.acme.edu",
      "",
    ];
    expect(own.filter((address) => hostOf(address))).toEqual([]);
  });

  it("takes this machine as a host name outside production, on a local backend's port unless one is typed", () => {
    expect(addressOf("ontology.acme.edu")).toBe("https://ontology.acme.edu");
    expect(addressOf("localhost")).toBe("http://localhost:8000");
    expect(addressOf(" http://LocalHost:9000/ ")).toBe("http://localhost:9000");
    expect(addressOf("127.0.0.1:18080")).toBe("http://127.0.0.1:18080");
    expect(addressOf("[::1]")).toBe("http://[::1]:8000");
    // Neither a full host name nor this machine.
    const neither = ["ontology", "10.0.0.7", "localhost:8000/mcp", "localhost:x"];
    expect(neither.filter((typed) => addressOf(typed))).toEqual([]);
    // Read back as it is typed, port included, so it stands for the same address.
    expect(hostOf("http://localhost:8000")).toBe("localhost:8000");
    expect(hostOf("http://127.0.0.1:18080/")).toBe("127.0.0.1:18080");
  });

  it("takes no address on this machine when deployed", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(addressOf("localhost:8000")).toBe("");
      expect(hostOf("http://localhost:8000")).toBe("");
      expect(addressOf("ontology.acme.edu")).toBe("https://ontology.acme.edu");
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("names what is known, one flag a line, and the platform's address only where it is another", () => {
    const known = { platform: "acme", host: "ontology.acme.edu" };
    // The ibl.ai platform's own address is the script's default: the command does not carry it.
    const command = installCommand({ ...known, platformUrl: PLATFORM_URL });
    expect(command.split(" \\\n")).toEqual([
      `curl -fsSL ${INSTALL_SCRIPT}`,
      "  | sudo bash -s --",
      "    --platform acme",
      "    --host ontology.acme.edu",
    ]);
    const elsewhere = installCommand({ ...known, platformUrl: "https://dm.acme.edu" });
    expect(elsewhere.split(" \\\n")).toEqual([
      `curl -fsSL ${INSTALL_SCRIPT}`,
      "  | sudo bash -s --",
      "    --platform acme",
      "    --platform-url https://dm.acme.edu",
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
