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

/** Whether it is a full host name: labels of letters, digits and hyphens, with a dot between. */
export function validHost(host: string): boolean {
  const label = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
  return (
    host.length <= 253 && new RegExp(`^(${label}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$`).test(host)
  );
}

/** The command that installs a backend; a value not known, or not one plain word, is left for the script to ask. */
export function installCommand(known: {
  platform: string;
  platformUrl: string;
  host: string;
}): string {
  const flags = [
    /^[\w.-]+$/.test(known.platform) && `--platform ${known.platform}`,
    /^https?:\/\/[\w.:/-]+$/.test(known.platformUrl) && `--platform-url ${known.platformUrl}`,
    validHost(known.host) && `--host ${known.host}`,
  ].filter(Boolean);
  return [
    `curl -fsSL ${INSTALL_SCRIPT}`,
    flags.length ? "  | sudo bash -s --" : "  | sudo bash",
    ...flags.map((flag) => `    ${flag}`),
  ].join(" \\\n");
}
