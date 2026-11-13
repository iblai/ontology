/** The install script of the newest release: one address that never changes. */
export const INSTALL_SCRIPT =
  "https://github.com/iblai/ontology/releases/latest/download/install.sh";

/** The host name in what was typed or pasted: no scheme, port, path or capitals. */
export function hostName(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/:?#].*$/, "");
}

// A developer's own machine; without a port, the one a local backend listens on (DEV.md).
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/;

/** The backend address a typed host name stands for: `https://<host name>`, or this machine over http outside production; "" for neither. */
export function addressOf(typed: string): string {
  const name = hostName(typed);
  if (validHost(name)) return `https://${name}`;
  // As the server takes it: never when deployed.
  if (process.env.NODE_ENV === "production") return "";
  const here = typed
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/$/, "");
  const local = LOCAL.exec(here);
  return local ? `http://${local[1]}:${local[2] ?? "8000"}` : "";
}

/** What to type as the host name for an address; "" for an address only Advanced can say (a port, a path, cleartext). */
export function hostOf(address: string): string {
  const plain = address.trim().toLowerCase().replace(/\/$/, "");
  const host = plain.replace(/^https?:\/\//, "");
  return plain !== host && addressOf(host) === plain ? host : "";
}

/** Whether it is a full host name: labels of letters, digits and hyphens, with a dot between. */
export function validHost(host: string): boolean {
  const label = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
  return (
    host.length <= 253 && new RegExp(`^(${label}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$`).test(host)
  );
}

/** The ibl.ai platform's address, which the install script takes when it is given no other. */
export const PLATFORM_URL = "https://api.iblai.app/dm";
/** The frontend the install's link opens when the script is given no other. */
export const FRONTEND_URL = "https://ontology.ibl.ai";
// As the script takes it: https, or a developer's own machine.
const FRONTEND = /^(https:\/\/[\w.:/-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** The command that installs a backend: no key and no platform; a host name not known is left for the script to ask. */
export function installCommand(known: {
  host: string;
  platformUrl: string;
  /** Where this frontend is, so the link the install prints comes back to it. */
  frontend: string;
}): string {
  const flags = [
    validHost(known.host) && `--host ${known.host}`,
    // Named only where they are not the script's own defaults.
    known.platformUrl !== PLATFORM_URL &&
      /^https?:\/\/[\w.:/-]+$/.test(known.platformUrl) &&
      `--platform-url ${known.platformUrl}`,
    known.frontend !== FRONTEND_URL &&
      FRONTEND.test(known.frontend) &&
      `--frontend ${known.frontend}`,
  ].filter(Boolean);
  return [
    `curl -fsSL ${INSTALL_SCRIPT}`,
    flags.length ? "  | sudo bash -s --" : "  | sudo bash",
    ...flags.map((flag) => `    ${flag}`),
  ].join(" \\\n");
}

/** What the install's link carries after `#`, and the platform picked for it on the way through a switch. */
export type SetupLink = { host: string; code: string; platform?: string };

const KEPT = "ontology_setup";
// The code of a link this tab has used or dropped: going back to its address does not bring it back.
const DONE = "ontology_setup_done";

/** The host name and the one-time code in a link's `#host=…&code=…`; null for anything else. */
export function setupLink(hash: string): SetupLink | null {
  const said = new URLSearchParams(hash.replace(/^#/, ""));
  const host = (said.get("host") ?? "").trim().toLowerCase();
  const code = said.get("code") ?? "";
  // A host name Connect would take, and a code as the script makes one.
  return addressOf(host) && /^[0-9a-f]{32}$/.test(code) ? { host, code } : null;
}

/** Keep the link this page was opened with for the tab: sign-in and a platform switch keep only the path. */
export function keepSetupLink(): void {
  if (typeof window === "undefined") return;
  const link = setupLink(window.location.hash);
  if (link && link.code !== window.sessionStorage.getItem(DONE))
    window.sessionStorage.setItem(KEPT, JSON.stringify(link));
}

/** The link this tab keeps, until it is used or dropped. */
export function pendingSetup(): SetupLink | null {
  if (typeof window === "undefined") return null;
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(KEPT) ?? "null") as SetupLink | null;
    return kept && addressOf(kept.host) && typeof kept.code === "string" ? kept : null;
  } catch {
    return null;
  }
}

/** Note the platform picked for the kept link, before the switch to it reloads the page. */
export function noteSetupPlatform(platform: string): void {
  const kept = pendingSetup();
  if (kept) window.sessionStorage.setItem(KEPT, JSON.stringify({ ...kept, platform }));
}

/** Drop the kept link, used or not. */
export function forgetSetup(): void {
  const kept = pendingSetup();
  if (kept) window.sessionStorage.setItem(DONE, kept.code);
  window.sessionStorage.removeItem(KEPT);
}
