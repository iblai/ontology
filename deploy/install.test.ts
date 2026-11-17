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

describe("deploy/install.sh", () => {
  it("carries one release stamp, alone on its line", () => {
    expect(SCRIPT.split('VERSION="dev"').length - 1).toBe(1);
    expect(SCRIPT).toMatch(/^VERSION="dev"$/m);
    expect(SCRIPT).toContain('if [ "$VERSION" = dev ]; then');
  });

  it("downloads its own release's compose.yaml and nothing of NVIDIA's", () => {
    expect(SCRIPT).toContain('"$REPO/releases/download/v$VERSION/compose.yaml"');
    expect(SCRIPT.split("/releases/download/v$VERSION/").length - 1).toBe(1);
    // Docker builds NVIDIA's services from the git address pinned in compose.yaml.
    expect(SCRIPT).not.toMatch(
      /codeload|NVIDIA\/auto-ontology|ENGINE_SHA|server\.yml|override\.yml/,
    );
  });

  it("ends with main, so a download cut short runs nothing", () => {
    const lines = SCRIPT.split("\n").filter((line) => line.trim() !== "");
    expect(lines.at(-1)).toBe('main "$@"');
  });

  it("writes exactly four names into .env, and no secret", () => {
    const written = [...SCRIPT.matchAll(/\bput\s+([A-Z_]+)\s/g)].map((m) => m[1]);
    expect([...new Set(written)].sort()).toEqual(
      ["COMPOSE_PROFILES", "ONTOLOGY_DM_URL", "ONTOLOGY_HOST", "ONTOLOGY_PLATFORM"].sort(),
    );
    // Without the profile compose.yaml starts no console: this script installs the image.
    expect(SCRIPT).toMatch(/^\s+put COMPOSE_PROFILES console$/m);
    // put is the one writer of .env: one redirect into it, and no heredoc.
    expect(SCRIPT.match(/>\s*"\$DIR\/\.env/g)).toHaveLength(1);
    expect(SCRIPT).toContain('} >"$DIR/.env.new"');
    expect(SCRIPT).not.toMatch(/cat\s*>\s*"\$DIR\/\.env/);
    expect(SCRIPT).not.toMatch(/\bput\s+\S*(PASSWORD|SECRET|KEY)/);
    expect(SCRIPT).not.toMatch(/\/dev\/urandom|openssl\s+rand/);
    for (const gone of ["AO_API_KEY", "ONTOLOGY_SETUP_CODE", "CONNECTION_STRINGS", "--frontend"]) {
      expect(SCRIPT).not.toContain(gone);
    }
  });

  it("never reads or prints a secret", () => {
    expect(SCRIPT).not.toMatch(/\$\{?[A-Za-z_]*(PASSWORD|SECRET|_KEY)\b/i);
    // The older backend's password is only tested for being there, never held.
    const kept = [...SCRIPT.matchAll(/\bkept\s+([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(kept)].sort()).toEqual(
      ["ONTOLOGY_DB_PASSWORD", "ONTOLOGY_HOST", "ONTOLOGY_PLATFORM"].sort(),
    );
    expect(SCRIPT).toContain('[ -n "$(kept ONTOLOGY_DB_PASSWORD)" ]');
    // It names the command that reads the admin's password; it never runs it.
    expect(SCRIPT.match(/cat \/secrets\/admin-password/g)).toHaveLength(1);
    expect(SCRIPT).toMatch(
      /^\s+cd \$DIR && sudo docker compose exec ontology cat \/secrets\/admin-password$/m,
    );
  });

  it("refuses the older backend by what only it holds", () => {
    const older = between(SCRIPT, "refuse_older() {\n", "\n}\n");
    expect(older).toContain("kept ONTOLOGY_DB_PASSWORD");
    expect(older).toContain('ontology-gateway "$DIR/compose.yaml"');
    expect(older).not.toContain('-f "$DIR/compose.yaml"');
    expect(older).toContain("/releases/download/v0.2.13/install.sh");
  });

  it("refuses a server whose console runs from source, to install and to remove", () => {
    const source = between(SCRIPT, "refuse_source() {\n", "\n}\n");
    expect(source).toContain("[ -e /etc/systemd/system/ontology-console.service ]");
    expect(between(SCRIPT, "check_server() {\n", "\n}\n")).toMatch(/^\s+refuse_source$/m);
    expect(between(SCRIPT, "uninstall() {\n", "\n}\n")).toMatch(/^\s+refuse_source$/m);
  });

  it("never hands an installed server's engine to another platform", () => {
    const settings = between(SCRIPT, "settings() {\n", "\n}\n");
    expect(settings).toContain('[ "$PLATFORM" != "$was" ]');
    expect(settings).toMatch(/already serves the platform \$was.*--uninstall/);
  });

  it("installs git beside Docker, Compose and buildx, and git alone beside a Docker already here", () => {
    expect(SCRIPT).toContain("docker.io docker-compose-v2 docker-buildx git");
    expect(SCRIPT).toMatch(/apt-get install -y -q --no-install-recommends git$/m);
    expect(SCRIPT).toContain('dpkg --compare-versions "$found" ge 2.23.1');
  });

  it("builds with retries and waits for the console's health", () => {
    expect(SCRIPT).toContain("for attempt in 1 2 3; do");
    expect(SCRIPT).toContain("docker pull nvcr.io/nvidia/base/ubuntu:jammy-20250619");
    expect(SCRIPT).toContain('url="https://${HOST:-localhost}/api/host/health"');
    expect(SCRIPT).toContain('how=(--resolve "$HOST:443:127.0.0.1")');
    expect(SCRIPT).toContain('"${COMPOSE[@]}" up --detach --remove-orphans');
    expect(SCRIPT).toContain('"${COMPOSE[@]}" down --volumes --rmi all --remove-orphans');
  });

  it("sets no trap, skips no hook and touches no firewall", () => {
    expect(SCRIPT).not.toMatch(/\btrap\b/);
    expect(SCRIPT).not.toContain("--no-verify");
    expect(SCRIPT).not.toMatch(/\b(ufw|iptables|nft)\b/);
  });

  it("reads no environment variable for its configuration", () => {
    const assigned = new Set<string>();
    for (const m of SCRIPT.matchAll(/(?:^|[\s;(])([A-Za-z_][A-Za-z0-9_]*)=/gm)) assigned.add(m[1]);
    for (const m of SCRIPT.matchAll(/^\s*local\s+(.+)$/gm)) {
      for (const word of m[1].split(/\s+/)) assigned.add(word.split("=")[0]);
    }
    for (const m of SCRIPT.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) assigned.add(m[1]);
    for (const m of SCRIPT.matchAll(/\bask\s+([A-Za-z_]\w*)/g)) assigned.add(m[1]);
    // Bash's own clock, and the two fields read from /etc/os-release.
    const allowed = new Set(["SECONDS", "ID", "VERSION_ID"]);
    const read = new Set([...SCRIPT.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const fromOutside = [...read].filter((name) => !assigned.has(name) && !allowed.has(name));
    expect(fromOutside).toEqual([]);
  });
});
