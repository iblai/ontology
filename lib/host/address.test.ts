import { afterEach, describe, expect, it, vi } from "vitest";
import { apiAddress, isPublicAddress, isThisMachine } from "./address";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isThisMachine", () => {
  it.each([
    "127.0.0.1",
    "127.9.9.9",
    "localhost",
    "[::1]",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
  ])("takes %s for this machine", async (host) => {
    expect(await isThisMachine(host)).toBe(true);
  });

  it.each(["10.1.2.3", "192.168.1.10", "203.0.113.7", "2001:4860:4860::8888"])(
    "takes %s for another",
    async (host) => {
      expect(await isThisMachine(host)).toBe(false);
    },
  );
});

describe("isPublicAddress", () => {
  it("takes a public literal", async () => {
    expect(await isPublicAddress("8.8.8.8")).toBe(true);
    expect(await isPublicAddress("2001:4860:4860::8888")).toBe(true);
    expect(await isPublicAddress("[2001:4860:4860::8888]")).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "[::1]",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("refuses the loopback, private or link-local literal %s", async (host) => {
    expect(await isPublicAddress(host)).toBe(false);
  });
});

describe("apiAddress", () => {
  it("keeps a public https address with a trailing slash", async () => {
    expect(await apiAddress(" https://8.8.8.8/v1 ")).toEqual({
      address: "https://8.8.8.8/v1/",
      private: false,
      local: false,
    });
  });

  it("takes http inside a private network, and says it is private", async () => {
    expect(await apiAddress("http://10.0.0.5:8080/api/")).toEqual({
      address: "http://10.0.0.5:8080/api/",
      private: true,
      local: false,
    });
    expect((await apiAddress("https://[fd00::1]/")).private).toBe(true);
    expect((await apiAddress("https://192.168.0.9")).private).toBe(true);
  });

  it("refuses http outside a private network", async () => {
    await expect(apiAddress("http://8.8.8.8/")).rejects.toThrow(/starts with https/);
  });

  const loopback = ["http://127.0.0.1:3030/rest", "https://[::1]/", "https://[::ffff:127.0.0.1]/"];

  it.each(loopback)("takes %s on this machine outside production, http included", async (base) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await apiAddress(base)).toMatchObject({ private: false, local: true });
  });

  it.each(loopback)("refuses %s on this machine in production", async (base) => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(apiAddress(base)).rejects.toThrow(/this machine or a link-local/);
  });

  it.each([
    "https://169.254.169.254/",
    "https://[fe80::1]/",
    "https://0.0.0.0/",
    "https://[::]/",
    "https://224.0.0.1/",
  ])("refuses %s, link-local or no one, in production and out", async (base) => {
    for (const mode of ["development", "production"]) {
      vi.stubEnv("NODE_ENV", mode);
      await expect(apiAddress(base)).rejects.toThrow(/this machine or a link-local/);
    }
  });

  it("refuses what is not a bare address", async () => {
    await expect(apiAddress("ftp://8.8.8.8/")).rejects.toThrow(/is not an address/);
    await expect(apiAddress("not an address")).rejects.toThrow(/is not an address/);
    await expect(apiAddress("https://user:pw@8.8.8.8/")).rejects.toThrow(/host and a path/);
    await expect(apiAddress("https://8.8.8.8/$KEY/")).rejects.toThrow(/host and a path/);
    await expect(apiAddress("https://8.8.8.8/?key=1")).rejects.toThrow(/host and a path/);
  });
});
