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

/** The command that installs a backend; a value not known, or not one plain word, is left for the script to ask. */
export function installCommand(known: {
  platform: string;
  platformUrl: string;
  host: string;
}): string {
  const flags = [
    /^[\w.-]+$/.test(known.platform) && `--platform ${known.platform}`,
    // Named only where it is not the script's own default.
    known.platformUrl !== PLATFORM_URL &&
      /^https?:\/\/[\w.:/-]+$/.test(known.platformUrl) &&
      `--platform-url ${known.platformUrl}`,
    validHost(known.host) && `--host ${known.host}`,
  ].filter(Boolean);
  return [
    `curl -fsSL ${INSTALL_SCRIPT}`,
    flags.length ? "  | sudo bash -s --" : "  | sudo bash",
    ...flags.map((flag) => `    ${flag}`),
  ].join(" \\\n");
}
