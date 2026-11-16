// The one-time link a server's installer prints, <console>/#host=<host>&code=<32 hex>, and the
// command that installs one. As main2's frontend/lib/ontology/install.ts.

import { relaying, serverBase } from "@/lib/server-address";

export type SetupLink = { host: string; code: string };

const KEPT = "ontology_setup";
const INSTALL_SCRIPT = "https://github.com/iblai/ontology/releases/latest/download/install.sh";
// The installer's own defaults: named in the command only when they differ.
const FRONTEND = "https://ontology.ibl.ai";
const PLATFORM_URL = "https://api.iblai.app/dm";

/** The host and the code in a link's `#host=…&code=…`; null for anything else. */
export function parseSetupLink(hash: string): SetupLink | null {
  const said = new URLSearchParams(hash.replace(/^#/, ""));
  const host = (said.get("host") ?? "").trim().toLowerCase();
  const code = said.get("code") ?? "";
  return serverBase(host) && /^[0-9a-f]{32}$/.test(code) ? { host, code } : null;
}

/** Keeps the link the page was opened with for the tab and takes the code off the address bar. */
export function keepSetupLink(): void {
  if (typeof window === "undefined" || !relaying()) return;
  const link = parseSetupLink(window.location.hash);
  if (!link) return;
  window.sessionStorage.setItem(KEPT, JSON.stringify(link));
  // Next's own history state is kept, so its router still owns the entry.
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", pathname + search);
}

/** The link this tab keeps, until it is used or dropped. */
export function readSetupLink(): SetupLink | null {
  if (typeof window === "undefined") return null;
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(KEPT) ?? "null");
    return kept ? parseSetupLink(new URLSearchParams(kept).toString()) : null;
  } catch {
    return null;
  }
}

export function forgetSetup(): void {
  window.sessionStorage.removeItem(KEPT);
}

/** The command that installs a server; the host only when it is a real host name. */
export function installCommand(input: {
  host?: string;
  frontend: string;
  platformUrl: string;
}): string {
  const host = input.host?.trim().toLowerCase() ?? "";
  const flags = [
    serverBase(host)?.startsWith("https://") && `--host ${host}`,
    input.frontend !== FRONTEND && `--frontend ${input.frontend}`,
    input.platformUrl !== PLATFORM_URL && `--platform-url ${input.platformUrl}`,
  ].filter(Boolean);
  return [
    `curl -fsSL ${INSTALL_SCRIPT}`,
    flags.length ? "  | sudo bash -s --" : "  | sudo bash",
    ...flags.map((flag) => `    ${flag}`),
  ].join(" \\\n");
}
