// Which addresses the host may be pointed at.
// isPublicAddress is the old console's (frontend/lib/ontology/server/backend.ts); apiAddress is
// the old product's custom-API rule (services/http_api.py, address()).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HostError } from "./errors";

// A host and a path: nothing the runtime's file would read as its own (`$`, braces), no sign-in.
const ADDRESS = /^[A-Za-z0-9._~:/[\]-]+$/;

const bare = (host: string) => host.replace(/^\[|\]$/g, "");

function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = address.toLowerCase();
  // An IPv4 address in IPv6 clothes is judged as the IPv4 address it is.
  if (v6.startsWith("::ffff:")) return isIP(v6.slice(7)) === 4 && isPublicIp(v6.slice(7));
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

/** Whether a host name or IP literal is a public address (not loopback, private, link-local). */
export async function isPublicAddress(host: string): Promise<boolean> {
  const name = bare(host);
  if (isIP(name)) return isPublicIp(name);
  // ponytail: resolved here and again by the caller's fetch; pin the address if rebinding matters.
  const found = await lookup(name, { all: true }).catch(() => [] as { address: string }[]);
  return found.length > 0 && found.every(({ address }) => isPublicIp(address));
}

// This machine's loopback; what the old rule refuses (unspecified, link-local, multicast); and the
// private networks (10/8, 172.16/12, 192.168/16, fc00::/7) a system inside one may reach.
function placeOf(ip: string): "loopback" | "own" | "private" | "public" {
  let v6 = ip.toLowerCase().replace(/%.*$/, "");
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (hex) {
    const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    v6 = `::ffff:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  const v4 = isIP(v6) === 4 ? v6 : v6.startsWith("::ffff:") ? v6.slice(7) : null;
  if (v4 !== null && isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    if (a === 127) return "loopback";
    if (v4 === "0.0.0.0" || (a === 169 && b === 254) || (a >= 224 && a <= 239)) return "own";
    const inside = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return inside ? "private" : "public";
  }
  if (v6 === "::1") return "loopback";
  if (v6 === "::") return "own";
  const first = parseInt(v6.split(":")[0] || "0", 16);
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return "own";
  return (first & 0xfe00) === 0xfc00 ? "private" : "public";
}

/** Whether a host name or IP literal is this machine: loopback, unspecified or link-local. */
export async function isThisMachine(host: string): Promise<boolean> {
  const name = bare(host);
  const found = isIP(name)
    ? [{ address: name }]
    : await lookup(name, { all: true }).catch(() => [] as { address: string }[]);
  // ponytail: this machine's own LAN address passes; compare os.networkInterfaces() if it must not.
  return found.some(({ address }) => ["loopback", "own"].includes(placeOf(address)));
}

/**
 * A custom API's base address by the old product's rule, with this machine allowed outside
 * production. Returns it normalised, and whether it sits on a private network or this machine
 * (the runtime's http source must then be told to allow it).
 * Throws HostError 400 with the rule's own words.
 */
export async function apiAddress(
  base: string,
): Promise<{ address: string; private: boolean; local: boolean }> {
  const kept = `${base.trim().replace(/\/+$/, "")}/`;
  let url: URL | null = null;
  try {
    url = new URL(kept);
  } catch {
    // not an address: refused below
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new HostError(400, `“${base}” is not an address: one starts with https://`);
  }
  if (!ADDRESS.test(kept) || kept.length > 255) {
    throw new HostError(
      400,
      "An address is a host and a path, nothing else: its key goes in its own field.",
    );
  }
  const host = bare(url.hostname);
  let ips: string[];
  if (isIP(host)) ips = [host];
  else {
    try {
      ips = (await lookup(host, { all: true })).map(({ address }) => address);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new HostError(400, `${host} does not resolve from this server (${why}).`);
    }
  }
  const production = process.env.NODE_ENV === "production";
  const own = ips
    .filter((ip) => placeOf(ip) === "own" || (production && placeOf(ip) === "loopback"))
    .sort();
  if (own.length) {
    throw new HostError(
      400,
      `${host} is this machine or a link-local address (${own[0]}): neither is called from here.`,
    );
  }
  const inside = ips.some((ip) => placeOf(ip) === "private");
  const local = ips.some((ip) => placeOf(ip) === "loopback");
  if (url.protocol === "http:" && !inside && !local) {
    throw new HostError(
      400,
      "An address outside a private network starts with https://: " +
        "a key would cross the internet in clear.",
    );
  }
  return { address: url.href, private: inside, local };
}
