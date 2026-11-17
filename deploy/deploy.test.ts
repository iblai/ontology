// The server install: compose.yaml, install.sh and the release workflow agree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

const COMPOSE = read("deploy/compose.yaml");
const IMAGE = "public.ecr.aws/ibleducation/iblai-ontology";

// The operator's settings, in the order the file gives them.
const SETTINGS = [
  "ONTOLOGY_PLATFORM",
  "ONTOLOGY_HOST",
  "ONTOLOGY_DM_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_EMBEDDING_MODEL",
];
const ENGINE = [
  "auto-ontology-migrate",
  "frontend-migrate",
  "auto-ontology",
  "ingestion-service",
  "auto-ontology-frontend",
];
const SERVICES = ["secrets", "postgres", ...ENGINE, "ontology", "proxy"];
const SECRETS = ["db-password", "auth-secret", "admin-password", "model-key"];
const WRAPPER = ["/usr/bin/tini", "--", "sh", "/etc/with-secrets.sh"];
const MODELS = "http://127.0.0.1:3000/internal/models/v1";

interface Service {
  image?: string;
  build?: { context: string; args?: Record<string, string> };
  network_mode?: string;
  entrypoint?: string[];
  command?: string[];
  working_dir?: string;
  init?: boolean;
  restart?: string;
  environment?: Record<string, string>;
  volumes?: string[];
  configs?: { source: string; target: string }[];
  extra_hosts?: string[];
  healthcheck?: { test: string[] };
  depends_on?: Record<string, { condition: string; required?: boolean }>;
  profiles?: string[];
}

// Compose takes YAML merge keys (`<<`), which `yaml` resolves only when asked.
const compose = parse(COMPOSE, { merge: true });
const services: Record<string, Service> = compose.services;
const configs: Record<string, { content: string }> = compose.configs;
const env = (name: string) => services[name].environment ?? {};

const interpolated = (text: string) =>
  [...text.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);

// The NAME=file pairs a service asks the wrapper for.
const secretsOf = (name: string): Record<string, string> =>
  Object.fromEntries(
    (env(name).SECRETS ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((pair) => pair.split("=") as [string, string]),
  );

// What Compose hands Caddy: every $$ becomes $.
const caddyfile = configs.caddyfile.content.replaceAll("$$", "$");

// The directives of the site's route block, in order, without their sub-blocks.
const routeLines = (() => {
  const lines: string[] = [];
  let depth = 0;
  for (const raw of caddyfile.slice(caddyfile.indexOf("route {") + "route {".length).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "}") {
      if (depth === 0) break;
      depth--;
      continue;
    }
    if (depth === 0) lines.push(line.replace(/\s*\{$/, ""));
    if (line.endsWith("{")) depth++;
  }
  return lines;
})();

// The site's named matchers, defined outside any directive as Caddy's docs have them.
const named = new Map(
  [...caddyfile.matchAll(/^\s*(@\w+) path_regexp (\S+)$/gm)].map((m) => [m[1], new RegExp(m[2])]),
);

// Walks the route block as Caddy would: the first answering directive wins.
const route = (start: string) => {
  let path = start;
  const matches = (matcher: string) =>
    matcher.startsWith("@")
      ? (named.get(matcher)?.test(path) ?? false)
      : matcher.endsWith("*")
        ? path.startsWith(matcher.slice(0, -1))
        : path === matcher;
  for (const line of routeLines) {
    const [directive, ...args] = line.split(" ");
    if (directive === "reverse_proxy") {
      if (args.length === 1 || matches(args[0])) return `${args.at(-1)}${path}`;
    } else if (directive === "respond") {
      if (matches(args[0])) return args[1];
    } else if (directive === "uri" && args[1] === "strip_prefix") {
      if (matches(args[0]) && path.startsWith(args[2])) path = path.slice(args[2].length);
    } else {
      throw new Error(`route: no rule for ${line}`);
    }
  }
  return "unrouted";
};

describe("compose.yaml", () => {
  it("is its own project, never the v0.2 backend's", () => {
    expect(compose.name).toBe("iblai-ontology-console");
  });

  it("reads the seven settings, each once, at the top, and nothing else", () => {
    expect(interpolated(COMPOSE)).toEqual(SETTINGS);
    expect(Object.keys(compose["x-settings"])).toEqual(SETTINGS);
    const last = COMPOSE.split("\n").findIndex((line) => line.includes("${OPENAI_EMBEDDING_MODEL"));
    expect(last).toBeLessThan(30);
  });

  it("gives every setting a default but ONTOLOGY_PLATFORM, which stops compose with a message", () => {
    const uses = [...COMPOSE.matchAll(/(?<!\$)\$\{(\w+)(:[-?])([^}]*)\}/g)];
    expect(uses.filter((m) => m[2] === ":?").map((m) => m[1])).toEqual(["ONTOLOGY_PLATFORM"]);
    expect(uses.find((m) => m[2] === ":?")?.[3]).toMatch(/key of the ibl\.ai platform/);
    expect(Object.fromEntries(uses.filter((m) => m[2] === ":-").map((m) => [m[1], m[3]]))).toEqual({
      ONTOLOGY_HOST: "localhost",
      ONTOLOGY_DM_URL: "https://api.iblai.app/dm",
      OPENAI_API_KEY: "",
      OPENAI_API_BASE_URL: "https://api.openai.com/v1",
      OPENAI_MODEL: "gpt-4.1",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    });
  });

  it("writes every literal $ as $$, so Compose reads only the settings", () => {
    expect(COMPOSE.replace(/\$\$|\$\{[^}]*\}/g, "")).not.toContain("$");
    for (const { content } of Object.values(configs)) {
      expect(content.replace(/\$\$|\$\{[^}]*\}/g, "")).not.toContain("$");
      expect(interpolated(content)).toEqual([]);
    }
  });

  it("runs exactly the nine services", () => {
    expect(Object.keys(services).sort()).toEqual([...SERVICES].sort());
    expect(COMPOSE).not.toMatch(/pgadmin/i);
  });

  it("publishes no port, names no container and reads no env file", () => {
    for (const key of ["ports", "container_name", "env_file"]) {
      expect(SERVICES.filter((name) => key in services[name])).toEqual([]);
    }
  });

  it("puts every service but the one-shot on the host's network, and the one-shot on none", () => {
    expect(SERVICES.filter((name) => services[name].network_mode !== "host")).toEqual(["secrets"]);
    expect(services.secrets.network_mode).toBe("none");
  });

  it("sets neither CONNECTION_STRINGS nor AO_API_KEY anywhere", () => {
    const text = JSON.stringify(services);
    expect(text).not.toContain("CONNECTION_STRINGS");
    expect(text).not.toContain("AO_API_KEY");
  });

  it("pulls NVIDIA's own images at one release, the web app's for its two services", () => {
    const releases = new Set<string>();
    for (const name of ENGINE) {
      const web = ["frontend-migrate", "auto-ontology-frontend"].includes(name);
      const image = (services[name].image ?? "").match(
        /^nvcr\.io\/nvidia\/auto-ontology(-frontend)?:(\d+\.\d+\.\d+)$/,
      );
      expect(image, name).not.toBeNull();
      expect(Boolean(image?.[1]), name).toBe(web);
      releases.add(image?.[2] ?? "");
      // Nothing is built on the server: no buildx, no git, no minutes of waiting.
      expect("build" in services[name], name).toBe(false);
      expect("pull_policy" in services[name], name).toBe(false);
    }
    expect(releases.size).toBe(1);
    expect(COMPOSE).not.toMatch(/github\.com\/NVIDIA|\b[0-9a-f]{40}\b/);
  });

  it("writes the four secrets once, as hex, readable and not writable", () => {
    const script = configs["make-secrets"].content;
    expect(services.secrets.image).toBe(services.postgres.image);
    expect(services.secrets.restart).toBe("no");
    expect(services.secrets.entrypoint).toEqual(["sh", "/etc/make-secrets.sh"]);
    expect(services.secrets.volumes).toEqual(["secrets:/secrets"]);
    expect(script.match(/^for name in (.+); do$/m)?.[1].split(" ")).toEqual(SECRETS);
    expect(script).toContain('if [ ! -s "$$file" ]; then');
    expect(script).toContain("/dev/urandom | tr -d ' \\n'");
    expect(script).toContain("umask 0222");
  });

  it("makes every service that mounts the secrets wait for them, read-only", () => {
    const readers = SERVICES.filter((name) =>
      services[name].volumes?.some((volume) => volume.startsWith("secrets:")),
    );
    expect(readers).toEqual(["secrets", "postgres", ...ENGINE, "ontology"]);
    for (const name of readers.slice(1)) {
      expect(services[name].volumes, name).toContain("secrets:/secrets:ro");
      expect(services[name].depends_on?.secrets, name).toEqual({
        condition: "service_completed_successfully",
      });
    }
  });

  it("gives Postgres its password from the file, and pins it to loopback on 5434", () => {
    expect(env("postgres").POSTGRES_PASSWORD_FILE).toBe("/secrets/db-password");
    expect("POSTGRES_PASSWORD" in env("postgres")).toBe(false);
    expect(env("postgres").PGPORT).toBe("5434");
    expect(services.postgres.command).toEqual([
      "postgres",
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "port=5434",
    ]);
  });

  it("starts each NVIDIA service through the wrapper, which reads only the secret files", () => {
    for (const name of ENGINE) {
      expect(services[name].entrypoint?.slice(0, 4), name).toEqual(WRAPPER);
      expect(services[name].configs, name).toEqual([
        { source: "with-secrets", target: "/etc/with-secrets.sh" },
      ]);
      expect(
        Object.values(secretsOf(name)).every((file) => SECRETS.includes(file)),
        name,
      ).toBe(true);
    }
    const wrapper = configs["with-secrets"].content;
    expect(wrapper).toContain("for pair in $${SECRETS:?");
    expect(wrapper).toContain('export "$$name=$$value"');
    expect(wrapper).toContain("exit 1");
    expect(wrapper.trim().split("\n").at(-1)).toBe('exec "$$@"');
  });

  it("runs the engine's own commands behind the wrapper", () => {
    expect(services["auto-ontology-migrate"].entrypoint).toEqual([
      ...WRAPPER,
      "/usr/local/bin/entrypoint.sh",
    ]);
    expect(services["auto-ontology-migrate"].command).toEqual(["migrate"]);
    expect(services["frontend-migrate"].entrypoint).toEqual(WRAPPER);
    expect(services["frontend-migrate"].command).toEqual(["sh", "prisma/migrate.sh"]);
    expect(services["frontend-migrate"].working_dir).toBe("/app/migrate");
    expect(services["auto-ontology-frontend"].entrypoint).toEqual(WRAPPER);
    expect(services["auto-ontology-frontend"].command).toEqual(["node", "app/server.js"]);
  });

  it("starts the API and the ingestion service through the loopback shim", () => {
    for (const [name, main] of [
      ["auto-ontology", "auto_ontology.server"],
      ["ingestion-service", "auto_ontology.ingestion_service"],
    ]) {
      const entrypoint = services[name].entrypoint ?? [];
      expect(entrypoint.slice(4, 6), name).toEqual(["python", "-c"]);
      expect(entrypoint[6], name).toContain('"host": "127.0.0.1"');
      expect(entrypoint[6], name).toContain('runpy.run_module(sys.argv[1], run_name="__main__")');
      expect(services[name].command, name).toEqual([main]);
    }
    expect(JSON.stringify(services)).not.toContain("0.0.0.0");
  });

  it("points every engine client at the database on loopback", () => {
    for (const name of ENGINE) {
      expect(env(name).POSTGRES_HOST, name).toBe("127.0.0.1");
      expect(env(name).POSTGRES_PORT, name).toBe("5434");
      expect(env(name).POSTGRES_USER, name).toBe("postgres");
      expect(env(name).POSTGRES_DATABASE, name).toBe("auto_ontology");
      expect(secretsOf(name).POSTGRES_PASSWORD, name).toBe("db-password");
      expect(services[name].extra_hosts, name).toEqual([
        "postgres:127.0.0.1",
        "auto-ontology:127.0.0.1",
        "ingestion-service:127.0.0.1",
      ]);
    }
    expect(env("auto-ontology").INGESTION_SERVICE_URL).toBe("http://127.0.0.1:3002");
  });

  it("gives the API and the ingestion service all twelve model fields, through the console", () => {
    const roles = ["REASONING", "NON_REASONING", "EMBED", "RERANK"];
    for (const name of ["auto-ontology", "ingestion-service"]) {
      const fields = [
        ...Object.keys(env(name)).filter((key) =>
          /^(REASONING|NON_REASONING|EMBED|RERANK)_/.test(key),
        ),
        ...Object.keys(secretsOf(name)).filter((key) => key.endsWith("_API_KEY")),
      ];
      expect(fields.sort(), name).toEqual(
        roles.flatMap((role) => ["MODEL", "ENDPOINT", "API_KEY"].map((f) => `${role}_${f}`)).sort(),
      );
      expect(env(name), name).toMatchObject({
        REASONING_MODEL: "openai/chat",
        NON_REASONING_MODEL: "openai/chat",
        EMBED_MODEL: "openai/embedding",
        RERANK_MODEL: "openai/rerank",
        REASONING_ENDPOINT: MODELS,
        NON_REASONING_ENDPOINT: MODELS,
        EMBED_ENDPOINT: MODELS,
        RERANK_ENDPOINT: `${MODELS}/rerank`,
      });
      for (const role of roles) {
        expect(secretsOf(name)[`${role}_API_KEY`], name).toBe("model-key");
      }
    }
  });

  it("serves NVIDIA's web app on loopback 3100 with generated secrets", () => {
    expect(env("auto-ontology-frontend")).toMatchObject({
      PYTHON_API_URL: "http://127.0.0.1:3001",
      PORT: "3100",
      HOSTNAME: "127.0.0.1",
      APP_URL: "http://localhost:3100",
      AUTO_ONTOLOGY_ADMIN_EMAIL: "admin@ontology.local",
    });
    expect(secretsOf("auto-ontology-frontend")).toEqual({
      POSTGRES_PASSWORD: "db-password",
      AUTH_SECRET: "auth-secret",
      AUTO_ONTOLOGY_ADMIN_PASSWORD: "admin-password",
    });
  });

  it("keeps NVIDIA's start order", () => {
    const after = (name: string) =>
      Object.fromEntries(
        Object.entries(services[name].depends_on ?? {}).map(([on, { condition }]) => [
          on,
          condition,
        ]),
      );
    const written = { secrets: "service_completed_successfully" };
    expect(after("auto-ontology-migrate")).toEqual({ ...written, postgres: "service_healthy" });
    expect(after("frontend-migrate")).toEqual({ ...written, postgres: "service_healthy" });
    expect(after("auto-ontology")).toEqual({
      ...written,
      postgres: "service_started",
      "auto-ontology-migrate": "service_completed_successfully",
      "ingestion-service": "service_started",
    });
    expect(after("ingestion-service")).toEqual({
      ...written,
      postgres: "service_started",
      "auto-ontology-migrate": "service_completed_successfully",
    });
    expect(after("auto-ontology-frontend")).toEqual({
      ...written,
      "auto-ontology": "service_healthy",
      "frontend-migrate": "service_completed_successfully",
    });
    expect(after("ontology")).toEqual(written);
    expect(after("proxy")).toEqual({ ontology: "service_healthy" });
  });

  it("starts the console's image under the console profile alone, and Caddy without it", () => {
    for (const name of SERVICES) {
      expect(services[name].profiles, name).toEqual(name === "ontology" ? ["console"] : undefined);
    }
    // A console built from source is not in Docker: Caddy must not wait for one that is.
    expect(services.proxy.depends_on?.ontology.required).toBe(false);
  });

  it("gives the console exactly the contract's settings", () => {
    const app = services.ontology;
    expect(Object.keys(env("ontology")).sort()).toEqual(
      [
        "HOSTNAME",
        "PORT",
        "ONTOLOGY_PLATFORM",
        "ONTOLOGY_DM_URL",
        "AO_URL",
        "AO_ORIGIN",
        "AO_ADMIN_EMAIL",
        "AO_ADMIN_PASSWORD_FILE",
        "ONTOLOGY_MODEL_KEY_FILE",
        "OPENAI_API_KEY",
        "OPENAI_API_BASE_URL",
        "OPENAI_MODEL",
        "OPENAI_EMBEDDING_MODEL",
      ].sort(),
    );
    expect(env("ontology")).toMatchObject({
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
      AO_URL: "http://127.0.0.1:3100",
      AO_ORIGIN: env("auto-ontology-frontend").APP_URL,
      AO_ADMIN_EMAIL: env("auto-ontology-frontend").AUTO_ONTOLOGY_ADMIN_EMAIL,
      AO_ADMIN_PASSWORD_FILE: "/secrets/admin-password",
      ONTOLOGY_MODEL_KEY_FILE: "/secrets/model-key",
    });
    for (const name of SETTINGS.filter((setting) => setting !== "ONTOLOGY_HOST")) {
      expect(env("ontology")[name], name).toMatch(new RegExp(`^\\$\\{${name}:`));
    }
    expect(app.init).toBe(true);
    expect(app.volumes).toEqual(["ontology_data:/data", "secrets:/secrets:ro"]);
    expect(app.healthcheck?.test.join(" ")).toContain("http://127.0.0.1:3000/api/host/health");
  });

  it("serves Caddy alone beyond loopback, at ONTOLOGY_HOST", () => {
    expect(services.proxy.image).toMatch(/^caddy:/);
    expect(env("proxy")).toEqual({ ONTOLOGY_HOST: "${ONTOLOGY_HOST:-localhost}" });
    expect(services.proxy.configs).toEqual([
      { source: "caddyfile", target: "/etc/caddy/Caddyfile" },
    ]);
    expect(services.proxy.volumes).toEqual(["certificates:/data"]);
    expect(caddyfile).toContain("admin off");
    expect(caddyfile).toMatch(/^\{\$ONTOLOGY_HOST\} \{$/m);
    expect(Object.keys(compose.volumes)).toEqual([
      "secrets",
      "postgres_data",
      "ontology_data",
      "certificates",
    ]);
  });

  it("routes in one route block, in the contract's order", () => {
    expect(caddyfile.match(/route \{/g)).toHaveLength(1);
    expect(caddyfile).not.toMatch(/\bhandle\b/);
    expect(routeLines).toEqual([
      "reverse_proxy /api/host/* 127.0.0.1:3000",
      "respond /api/auth/* 404",
      "respond /internal/* 404",
      "reverse_proxy /api/* 127.0.0.1:3100",
      "uri @second strip_prefix /iblai",
      "reverse_proxy 127.0.0.1:3000",
    ]);
    expect([...named.keys()]).toEqual(["@second"]);
    expect(caddyfile).toContain("@second path_regexp ^/iblai/(api/host/.*|[^/]+/[^/]+/mcp)$\n");
    expect(caddyfile.indexOf("@second path_regexp")).toBeLessThan(caddyfile.indexOf("route {"));
  });

  it.each([
    ["/api/host/health", "127.0.0.1:3000/api/host/health"],
    ["/dashboard", "127.0.0.1:3000/dashboard"],
    ["/acme/twenty/mcp", "127.0.0.1:3000/acme/twenty/mcp"],
    ["/api/auth/sign-in/email", "404"],
    ["/internal/models/v1/chat/completions", "404"],
    ["/api/connections", "127.0.0.1:3100/api/connections"],
    ["/iblai/api/host/health", "127.0.0.1:3000/api/host/health"],
    ["/iblai/acme/twenty/mcp", "127.0.0.1:3000/acme/twenty/mcp"],
    ["/iblai/acme/twenty/mcp/x", "127.0.0.1:3000/iblai/acme/twenty/mcp/x"],
  ])("routes %s to %s", (path, to) => {
    expect(route(path)).toBe(to);
  });

  it("stops NVIDIA's answers from running script on the console's origin", () => {
    const block = caddyfile.match(/reverse_proxy \/api\/\* 127\.0\.0\.1:3100 \{([^}]*)\}/)?.[1];
    expect(block?.trim().split(/\s*\n\s*/)).toEqual([
      "header_down Content-Security-Policy sandbox",
      "header_down X-Content-Type-Options nosniff",
    ]);
  });
});

describe("the release stamps", () => {
  it("hold the console's image tag once in compose.yaml", () => {
    expect(COMPOSE.split(`${IMAGE}:dev`)).toHaveLength(2);
    expect(COMPOSE).toContain(`image: ${IMAGE}:dev\n`);
  });

  it("are replaced by the release workflow", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain(`IMAGE: ${IMAGE}\n`);
    expect(workflow).toContain(
      String.raw`sed -i "s/^VERSION=\"dev\"$/VERSION=\"$VERSION\"/" deploy/install.sh`,
    );
    expect(workflow).toContain('sed -i "s|$IMAGE:dev|$IMAGE:$VERSION|" deploy/compose.yaml');
    expect(workflow).toContain(
      'gh release upload "$TAG" deploy/compose.yaml deploy/install.sh --clobber',
    );
  });

  it("are attached to a draft: the workflow builds no image and publishes nothing", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).not.toMatch(/docker (build|push|login)/);
    expect(workflow).not.toContain("--draft=false");
    expect(read(".release-it.json")).toMatch(/"draft": true/);
  });

  it("hold one VERSION line in install.sh", () => {
    expect(read("deploy/install.sh").match(/^VERSION="dev"$/gm)).toHaveLength(1);
  });
});

// The console built from source takes the image's place: same addresses, same secrets.
describe("iblai-ontology.service", () => {
  const NAME = "iblai-ontology.service";
  const UNIT = read(`deploy/${NAME}`);
  // Every NAME=value of the unit's Environment= lines.
  const set: Record<string, string> = Object.fromEntries(
    [...UNIT.matchAll(/^Environment=(.+)$/gm)]
      .flatMap((m) => m[1].split(" "))
      .map((pair): [string, string] => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at), pair.slice(at + 1)];
      }),
  );

  it("reaches the engine as the image does", () => {
    for (const name of ["AO_URL", "AO_ORIGIN", "AO_ADMIN_EMAIL"]) {
      expect(set[name], name).toBe(env("ontology")[name]);
    }
  });

  it("is handed the image's two secrets from Compose's own volume", () => {
    const volume = `/var/lib/docker/volumes/${compose.name}_secrets/_data`;
    for (const [setting, secret] of [
      ["AO_ADMIN_PASSWORD_FILE", "admin-password"],
      ["ONTOLOGY_MODEL_KEY_FILE", "model-key"],
    ] as const) {
      expect(env("ontology")[setting]).toBe(`/secrets/${secret}`);
      expect(UNIT).toContain(`\nLoadCredential=${secret}:${volume}/${secret}\n`);
      expect(set[setting]).toBe(`/run/credentials/${NAME}/${secret}`);
    }
    expect(Object.keys(compose.volumes)).toContain("secrets");
  });

  it("listens where the image listens, on loopback alone", () => {
    expect(env("ontology")).toMatchObject({ HOSTNAME: "127.0.0.1", PORT: "3000" });
    expect(UNIT).toMatch(/^ExecStart=.+\/next start --hostname 127\.0\.0\.1 --port 3000$/m);
  });

  it("gives Node what pnpm start gives it", () => {
    const options = parse(read("pnpm-workspace.yaml")).nodeOptions;
    expect(options).toMatch(/^--/);
    expect(set.NODE_OPTIONS).toBe(options);
  });

  it("runs as its own user on the settings Compose reads, its files outside the checkout", () => {
    expect(UNIT).toContain("\nUser=ontology\n");
    expect(UNIT).toContain("\nEnvironmentFile=/opt/iblai-ontology/.env\n");
    expect(UNIT).toContain("\nStateDirectory=ontology\n");
    expect(set.ONTOLOGY_HOME).toBe("/var/lib/ontology");
    // The settings come from .env alone: the unit fixes none of the operator's.
    for (const name of SETTINGS) expect(set[name], name).toBeUndefined();
  });

  it("is what the tutorial installs: the same user, paths, files and port", () => {
    const guide = read("docs/install.md");
    const raw = "https://raw.githubusercontent.com/iblai/ontology/main/deploy";
    expect(guide).toMatch(/^sudo useradd --system --create-home (\S+ )*ontology$/m);
    // Node's own binary needs it, and a bare Ubuntu server does not have it.
    expect(guide).toMatch(/^sudo apt-get install -y .*\blibatomic1\b/m);
    // The build runs where the block's cd leaves it, in a directory given to the user.
    const open = "sudo -u ontology -H bash -eo pipefail -c '\n";
    const from = guide.indexOf(open) + open.length;
    expect(from).toBeGreaterThan(open.length);
    const build = guide.slice(from, guide.indexOf("\n'\n", from));
    const base = guide.slice(0, from).match(/^cd (\S+)\nsudo -u ontology [^\n]+\n$/m)?.[1];
    expect(base).toBe("/opt/iblai-ontology");
    expect(guide).toContain(`sudo chown -R ontology: ${base}\n`);
    expect(build).not.toMatch(/^\s*cd [~/]/m);
    // Where the tutorial clones to is where the unit starts; mise stays in the user's home.
    const checkout = build.match(/ https:\/\/github\.com\/iblai\/ontology\.git (\S+)$/m)?.[1];
    expect(checkout).toBeTruthy();
    expect(build).toContain(`test -d ${checkout} || git clone `);
    expect(build).toContain(`\n  cd ${checkout}\n`);
    expect(UNIT).toContain(`\nWorkingDirectory=${base}/${checkout}\n`);
    expect(UNIT).toContain("\nExecStart=/home/ontology/.local/bin/mise exec -- node ");
    expect(guide).toContain("sudo tee /opt/iblai-ontology/.env <<'EOF'\n");
    // Root downloads what it runs: the service's user can write its own checkout.
    expect(guide).toContain(`sudo curl -fsSLO ${raw}/compose.yaml\n`);
    expect(guide).toContain(`sudo curl -fsSLo /etc/systemd/system/${NAME} ${raw}/${NAME}\n`);
    expect(guide).not.toMatch(/sudo cp \/home\/ontology/);
    expect(guide).toContain("http://127.0.0.1:3000/api/host/health");
    // The build runs inside one pair of single quotes: a bare apostrophe would end them.
    expect(build.replaceAll("'\\''", "")).not.toContain("'");
  });
});
