// The server install: the compose files, install.sh and the release workflow agree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

const SERVER = read("deploy/server.yml");
const OVERRIDE = read("deploy/auto-ontology.override.yml");
const IMAGE = "ghcr.io/iblai/ontology";

// The installer's contract: /opt/iblai-ontology/.env holds exactly these.
const ENV_KEYS = [
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
];
const NVIDIA = [
  "postgres",
  "pgadmin",
  "auto-ontology",
  "ingestion-service",
  "auto-ontology-migrate",
  "frontend-migrate",
  "auto-ontology-frontend",
];

// Compose's merge tags need custom tags in `yaml`; dropping them leaves the value they mark.
const server = parse(SERVER.replace(/!(override|reset)\b/g, ""));
const services: Record<string, Record<string, unknown>> = server.services;
const caddyfile: string = server.configs.caddyfile.content;

const interpolated = (text: string) =>
  [...text.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);

describe("the deploy files", () => {
  it("interpolate only what .env holds", () => {
    for (const text of [SERVER, OVERRIDE]) {
      const used = interpolated(text);
      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((name) => !ENV_KEYS.includes(name))).toEqual([]);
    }
  });

  it("add the server half and the proxy alone, and publish no port", () => {
    expect(Object.keys(services).filter((name) => !NVIDIA.includes(name))).toEqual([
      "ontology",
      "proxy",
    ]);
    expect(Object.keys(services).filter((name) => "ports" in services[name])).toEqual([]);
    // The engine reads the .env outside its source tree, which is a build context.
    expect(SERVER.match(/env_file: !override \[\/opt\/iblai-ontology\/\.env\]/g)).toHaveLength(5);
  });

  it("route only the two /iblai paths to the server half, the rest to NVIDIA's app", () => {
    const matchers = new Map(
      [...caddyfile.matchAll(/^\s*(@\w+) (.+)$/gm)].map((m) => [m[1], m[2].trim()]),
    );
    const handles = [...caddyfile.matchAll(/handle(?: (@\w+))? \{([^}]*)\}/g)].map((m) => [
      m[1],
      m[2].trim().split(/\s*\n\s*/),
    ]);
    expect(handles).toEqual([
      ["@server", ["uri strip_prefix /iblai", "reverse_proxy 127.0.0.1:3000"]],
      ["@iblai", ["respond 404"]],
      [undefined, ["reverse_proxy 127.0.0.1:3100"]],
    ]);
    expect(caddyfile.match(/reverse_proxy/g)).toHaveLength(2);
    expect(matchers.get("@iblai")).toBe("path /iblai /iblai/*");

    const regexp = (matchers.get("@server") ?? "").replace(/^path_regexp /, "").replace("$$", "$");
    expect(regexp).toBe("^/iblai/(api/host/.*|[^/]+/[^/]+/mcp)$");
    const toServer = (path: string) => new RegExp(regexp).test(path);
    expect(toServer("/iblai/api/host/setup")).toBe(true);
    expect(toServer("/iblai/acme/crm/mcp")).toBe(true);
    expect(toServer("/iblai/acme/crm/mcp/x")).toBe(false);
    expect(toServer("/iblai/acme/mcp")).toBe(false);
    expect(toServer("/iblai/other")).toBe(false);
    expect(toServer("/api/host/setup")).toBe(false);

    // Compose interpolates the content: every literal $ is written $$.
    expect(caddyfile.replace(/\$\$|\$\{[^}]*\}/g, "")).not.toContain("$");
  });

  it("hold the stamps the release workflow replaces", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain(`IMAGE: ${IMAGE}\n`);
    expect(workflow).toContain(
      String.raw`sed -i "s/^VERSION=\"dev\"$/VERSION=\"$VERSION\"/" deploy/install.sh`,
    );
    expect(workflow).toContain('sed -i "s|$IMAGE:dev|$IMAGE:$VERSION|" deploy/server.yml');
    expect(SERVER.split(`${IMAGE}:dev`)).toHaveLength(2);
    expect(SERVER).toContain(`image: ${IMAGE}:dev\n`);
    // Written by another hand: read as it is now, never assumed.
    expect(read("deploy/install.sh").match(/^VERSION="dev"$/gm)).toHaveLength(1);
  });
});
