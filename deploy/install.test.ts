import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT = readFileSync(new URL("./install.sh", import.meta.url), "utf8");

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, `missing: ${start}`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, `missing the end of: ${start}`).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
};

const ENV_START = 'cat >"$DIR/.env" <<EOF\n';
const MINT_START = "IFS= read -r -d '' MINT <<'JS' || true\n";
const ENV_FILE = between(SCRIPT, ENV_START, "\nEOF\n");
const MINT = between(SCRIPT, MINT_START, "\nJS\n");
// The shell's own text: neither the .env it writes nor the program it runs in the container.
const SHELL = SCRIPT.replace(ENV_START + ENV_FILE, "").replace(MINT_START + MINT, "");

describe("deploy/install.sh", () => {
  it("writes exactly the contract's keys into .env, and never CONNECTION_STRINGS", () => {
    const written = [...ENV_FILE.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(written.sort()).toEqual(
      [
        "ONTOLOGY_HOST",
        "ONTOLOGY_FRONTEND",
        "ONTOLOGY_DM_URL",
        "ONTOLOGY_SETUP_CODE",
        "AO_API_KEY",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DATABASE",
        "POSTGRES_PORT",
        "PGADMIN_EMAIL",
        "PGADMIN_PASSWORD",
        "AUTH_SECRET",
        "APP_URL",
        "AUTO_ONTOLOGY_ADMIN_EMAIL",
        "AUTO_ONTOLOGY_ADMIN_PASSWORD",
        "DEFAULT_MODELS_API_KEY",
      ].sort(),
    );
    expect(ENV_FILE).not.toContain("CONNECTION_STRINGS");
    expect(ENV_FILE).toContain("\nAO_API_KEY=\n");
    expect(ENV_FILE).toContain("\nPOSTGRES_PORT=5434\n");
    expect(ENV_FILE).toContain("\nAPP_URL=https://$HOST\n");
    expect(ENV_FILE).toContain("\nDEFAULT_MODELS_API_KEY=nvapi-not-set\n");
  });

  it("carries one release stamp and one pinned engine commit", () => {
    expect(SCRIPT.split('VERSION="dev"').length - 1).toBe(1);
    expect(SCRIPT).toMatch(/^VERSION="dev"$/m);
    expect(SCRIPT.match(/^ENGINE_SHA=/gm)).toHaveLength(1);
    expect(SCRIPT).toMatch(/^ENGINE_SHA="[0-9a-f]{40}"$/m);
    // The compose files come from the script's own release, so the three always match.
    expect(SCRIPT).toContain('"$REPO/releases/download/v$VERSION/server.yml"');
    expect(SCRIPT).toContain('"$REPO/releases/download/v$VERSION/auto-ontology.override.yml"');
  });

  it("ends with main, so a download cut short runs nothing", () => {
    const lines = SCRIPT.split("\n").filter((line) => line.trim() !== "");
    expect(lines.at(-1)).toBe('main "$@"');
  });

  it("never prints the engine key or a password", () => {
    const printing = SHELL.split("\n").filter((line) =>
      /^\s*(say|printf|echo|stop|refuse)\b/.test(line),
    );
    for (const line of printing) {
      expect(line).not.toMatch(/\$\{?key\b/);
      expect(line).not.toMatch(/\$\{?[A-Z_]*PASSWORD/);
    }
    // No password ever sits in a shell variable: each is generated straight into .env.
    expect(SHELL).not.toMatch(/\$\{?[A-Z_]*PASSWORD/);
    // The program prints the token on stdout and nothing else; its failures name a step and a status.
    expect(MINT).not.toContain("console.log");
    expect(MINT.split("process.stdout.write(").length - 1).toBe(1);
    for (const line of MINT.split("\n").filter((l) => l.includes("console.error"))) {
      expect(line).not.toMatch(/token|password|cookie/i);
    }
    expect(MINT).toContain("process.env.AUTO_ONTOLOGY_ADMIN_PASSWORD");
    expect(SHELL).toContain('exec -T auto-ontology-frontend node -e "$MINT"');
  });

  it("sets no trap, skips no hook and touches no firewall", () => {
    expect(SCRIPT).not.toMatch(/\btrap\b/);
    expect(SCRIPT).not.toContain("--no-verify");
    expect(SCRIPT).not.toMatch(/\b(ufw|iptables|nft)\b/);
  });

  it("reads no environment variable for its configuration", () => {
    const assigned = new Set<string>();
    for (const m of SHELL.matchAll(/(?:^|[\s;(])([A-Za-z_][A-Za-z0-9_]*)=/gm)) assigned.add(m[1]);
    for (const m of SHELL.matchAll(/^\s*local\s+(.+)$/gm)) {
      for (const word of m[1].split(/\s+/)) assigned.add(word.split("=")[0]);
    }
    for (const m of SHELL.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) assigned.add(m[1]);
    for (const m of SHELL.matchAll(/\bask\s+([A-Za-z_]\w*)/g)) assigned.add(m[1]);
    assigned.add("MINT"); // read from the heredoc above
    // Bash's own clock, and the two fields read from /etc/os-release.
    const allowed = new Set(["SECONDS", "ID", "VERSION_ID"]);
    const read = new Set(
      [...(SHELL + ENV_FILE).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    );
    const fromOutside = [...read].filter((name) => !assigned.has(name) && !allowed.has(name));
    expect(fromOutside).toEqual([]);
  });
});
