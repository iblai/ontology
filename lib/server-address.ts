// Where a platform's ontology server is, for a console that serves pages only. Shared by the
// browser and the host: no Node import here.

/** The header the browser names the platform's server in, on a console that serves pages only. */
export const SERVER_HEADER = "x-ontology-server";

/** The path the server half answers under on a client's server. */
export const SERVER_PREFIX = "/iblai";

/** Whether this build serves pages only and forwards /api/host/*: NEXT_PUBLIC_ONTOLOGY_RELAY=1. */
export const relaying = () => process.env.NEXT_PUBLIC_ONTOLOGY_RELAY === "1";

// As deploy/install.sh's HOST_RE: the installer's link must name a host this takes.
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$/;
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * A server's address from the host name an admin types: https://<host>/iblai. Outside production
 * localhost[:port] is taken too, as http with no prefix: a console run by hand has no proxy.
 * Null when it is neither.
 */
export function serverBase(host: string): string | null {
  const name = host.trim().toLowerCase();
  if (HOST.test(name)) return `https://${name}${SERVER_PREFIX}`;
  if (process.env.NODE_ENV !== "production" && LOCAL.test(name)) return `http://${name}`;
  return null;
}

/** The host name in a server's address, for display. */
export function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

const keyOf = (platform: string) => `ontology_server:${platform}`;

/** The address this browser keeps for a platform's server; null on the server or when none. */
export function storedServer(platform: string): string | null {
  if (typeof window === "undefined" || !platform) return null;
  return window.localStorage.getItem(keyOf(platform));
}

export function storeServer(platform: string, base: string): void {
  window.localStorage.setItem(keyOf(platform), base);
}

export function forgetServer(platform: string): void {
  window.localStorage.removeItem(keyOf(platform));
}
