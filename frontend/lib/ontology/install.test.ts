import { describe, expect, it, vi } from "vitest";
import {
  FRONTEND_URL,
  INSTALL_SCRIPT,
  PLATFORM_URL,
  addressOf,
  forgetSetup,
  hostName,
  hostOf,
  installCommand,
  keepSetupLink,
  noteSetupPlatform,
  pendingSetup,
  setupLink,
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

  it("names the host, one flag a line, and the two addresses only where they are not the script's own", () => {
    const own = { host: "ontology.acme.edu", platformUrl: PLATFORM_URL, frontend: FRONTEND_URL };
    // No key and no platform: the frontend the install's link opens asks which platform.
    expect(installCommand(own).split(" \\\n")).toEqual([
      `curl -fsSL ${INSTALL_SCRIPT}`,
      "  | sudo bash -s --",
      "    --host ontology.acme.edu",
    ]);
    const elsewhere = installCommand({
      ...own,
      platformUrl: "https://dm.acme.edu",
      frontend: "http://localhost:3000",
    });
    expect(elsewhere.split(" \\\n")).toEqual([
      `curl -fsSL ${INSTALL_SCRIPT}`,
      "  | sudo bash -s --",
      "    --host ontology.acme.edu",
      "    --platform-url https://dm.acme.edu",
      "    --frontend http://localhost:3000",
    ]);
  });

  it("leaves out what is unknown or more than one plain word, for the script to ask", () => {
    const bare = installCommand({ host: "ontology", platformUrl: "", frontend: "" });
    expect(bare).toBe(`curl -fsSL ${INSTALL_SCRIPT} \\\n  | sudo bash`);
    const odd = installCommand({
      host: "ontology.acme.edu",
      platformUrl: "https://api.iblai.app/dm $(id)",
      frontend: "https://ontology.ibl.ai; reboot",
    });
    expect(odd).not.toMatch(/reboot|\$\(/);
    expect(odd).toContain("--host ontology.acme.edu");
  });
});

describe("the install's link", () => {
  const CODE = "0123456789abcdef0123456789abcdef";
  const HASH = `#host=ontology.acme.edu&code=${CODE}`;

  it("reads the host name and the code after #, and nothing else", () => {
    expect(setupLink(HASH)).toEqual({ host: "ontology.acme.edu", code: CODE });
    expect(setupLink(`#host=Ontology.Acme.edu&code=${CODE}`)?.host).toBe("ontology.acme.edu");
    const none = [
      "",
      "#",
      `#code=${CODE}`,
      "#host=ontology.acme.edu",
      `#host=ontology&code=${CODE}`,
      "#host=ontology.acme.edu&code=short",
      `#host=ontology.acme.edu&code=${CODE.toUpperCase()}`,
    ];
    expect(none.filter((hash) => setupLink(hash))).toEqual([]);
  });

  it("keeps the link for the tab, with the platform picked on the way through a switch, until it is used or dropped", () => {
    const kept = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    };
    vi.stubGlobal("window", { sessionStorage, location: { hash: HASH } });
    try {
      expect(pendingSetup()).toBeNull();
      keepSetupLink();
      expect(pendingSetup()).toEqual({ host: "ontology.acme.edu", code: CODE });
      noteSetupPlatform("acme");
      expect(pendingSetup()).toEqual({ host: "ontology.acme.edu", code: CODE, platform: "acme" });
      forgetSetup();
      expect(pendingSetup()).toBeNull();
      // Going back to the link's address does not bring a used link back.
      keepSetupLink();
      expect(pendingSetup()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
