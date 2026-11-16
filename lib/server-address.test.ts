import { afterEach, describe, expect, it, vi } from "vitest";
import { hostOf, relaying, serverBase } from "./server-address";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverBase", () => {
  it("puts a host name under https and /iblai", () => {
    expect(serverBase("ontology.university.edu")).toBe("https://ontology.university.edu/iblai");
    expect(serverBase("  Ontology.University.EDU ")).toBe("https://ontology.university.edu/iblai");
  });

  it.each(["", "localhost", "https://ontology.university.edu", "a b.edu", "x.edu/path", "-a.edu"])(
    "takes no host name from %j in production",
    (typed) => {
      vi.stubEnv("NODE_ENV", "production");
      expect(serverBase(typed)).toBeNull();
    },
  );

  it("takes this machine outside production, as it is, with no prefix", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(serverBase("localhost:3000")).toBe("http://localhost:3000");
    expect(serverBase("127.0.0.1")).toBe("http://127.0.0.1");
  });
});

describe("hostOf", () => {
  it("is the address's host, or the text itself when it is no address", () => {
    expect(hostOf("https://ontology.university.edu/iblai")).toBe("ontology.university.edu");
    expect(hostOf("http://localhost:3000")).toBe("localhost:3000");
    expect(hostOf("not an address")).toBe("not an address");
  });
});

describe("relaying", () => {
  it("is on for a build told to serve pages only", () => {
    expect(relaying()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ONTOLOGY_RELAY", "1");
    expect(relaying()).toBe(true);
  });
});
