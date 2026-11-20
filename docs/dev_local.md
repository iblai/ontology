# Run ibl.ai/ontology on your own machine

Two ways to run it from a checkout of this repository on a Linux machine of your own, each a few
blocks to paste and one step on ibl.ai. No host name, no DNS record and no open port: the console
answers at `http://localhost:3000` on the machine itself.

- **[With Docker](#with-docker)**: four blocks. ibl.ai/ontology is an image built from the
  checkout, and NVIDIA's engine is NVIDIA's own images.
- **[Without Docker](#without-docker)**: five blocks. NVIDIA's engine is built from its source
  beside ibl.ai/ontology, and PostgreSQL comes from its own package repository. The builds take
  longer.

Use one or the other on a machine, never both. To run it on a server that people reach by a host
name, follow [install_docker_local.md](install_docker_local.md) or [install.md](install.md)
instead.

## Before you start

- **A Linux machine**: x86-64, with 4 GB of memory and 15 GB free, and a user who can `sudo`.
  The blocks below are written for Ubuntu 22.04, 24.04 or 26.04.
- **An internet connection**: sign-in, and every call an agent makes, are checked with ibl.ai.
- **Your ibl.ai platform key**, such as `example-university`, and an administrator of that
  platform. Check [login.iblai.app/me](https://login.iblai.app/me) for this info.
- **This repository**, and a terminal in its folder:

  ```bash
  git clone https://github.com/iblai/ontology.git
  cd ontology
  ```

Paste each block into that terminal and press Enter. Only the first one needs your values.
Everything the blocks make stays in the checkout and is ignored by git: `.dev/` holds the
secrets, the settings, NVIDIA's source and the files to read, and `deploy/.env` holds Compose's
settings. Nothing goes under `/opt`, and no user is added to the machine.

## With Docker

What ends up on the machine:

- **ibl.ai/ontology**, in Docker, as an image built from the checkout's
  [`Dockerfile`](../Dockerfile). Nothing of ibl.ai's arrives as a prebuilt image.
- **NVIDIA's auto-ontology engine and its database**, in Docker. The engine is NVIDIA's own
  images, pulled from its registry. Caddy is left out.

### 1. Name the platform

Replace `example-university` with yours. Run this block once: a second run writes the file anew.

```bash
mkdir -p .dev/files
tee deploy/.env <<EOF
ONTOLOGY_PLATFORM=example-university
COMPOSE_PROFILES=all-in-one
ONTOLOGY_LOCAL_ROOT=$PWD/.dev/files
EOF
chmod 600 deploy/.env
```

With no `ONTOLOGY_HOST` line, the server answers on this machine only. `.dev/files` is the folder
a Filesystem source reads.

### 2. Install Docker

Everything runs in it, and it builds the image. This is Ubuntu's line; on another distribution,
install Docker, Compose 2.23.1 or later and buildx from its own packages.

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx curl
```

### 3. Build ibl.ai/ontology

Docker builds the image from the checkout, under the name `compose.yaml` asks for, so Compose
finds it on the machine and pulls nothing of ibl.ai's.

```bash
sudo docker build -t public.ecr.aws/ibleducation/iblai-ontology:local .
```

### 4. Start everything

```bash
(cd deploy && sudo docker compose up -d --scale proxy=0)
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/api/host/health; echo
```

Compose is run in `deploy`, where `compose.yaml` and its `.env` are. `--scale proxy=0` leaves
Caddy out; put the same flag on every later `docker compose up`. `docker compose up -d` downloads
NVIDIA's engine the first time, about half a gigabyte. The last line prints `{"ok":true}` once
ibl.ai/ontology is up. Then [sign in](#sign-in).

To stop it: `(cd deploy && sudo docker compose down)`. After a change to the source, paste blocks
3 and 4 again.

## Without Docker

What ends up on the machine, each listening on the machine itself only:

- **PostgreSQL 17 with pgvector**, from PostgreSQL's own package repository, with one database
  for the engine.
- **NVIDIA's auto-ontology engine**, built in `.dev/engine` from NVIDIA's repository at its
  1.2.0 release: two Python services and a web app, run by your own systemd session.
- **ibl.ai/ontology**, run from the checkout by its dev server.

### 1. Name the platform

Replace `example-university` with yours. Run this block once: a second run writes the settings
anew and keeps the secrets.

```bash
mkdir -p .dev
install -d -m 700 .dev/secrets
(cd .dev/secrets && umask 077 &&
  for name in db-password auth-secret admin-password model-key; do
    [ -s $name ] || od -An -N32 -tx1 /dev/urandom | tr -d " \n" > $name
  done)
install -m 600 /dev/null .dev/console.env
cat > .dev/console.env <<EOF
ONTOLOGY_PLATFORM=example-university
ONTOLOGY_HOST=localhost
AO_URL=http://127.0.0.1:3100
AO_ORIGIN=http://localhost:3100
AO_ADMIN_EMAIL=admin@ontology.local
AO_ADMIN_PASSWORD_FILE=$PWD/.dev/secrets/admin-password
ONTOLOGY_MODEL_KEY_FILE=$PWD/.dev/secrets/model-key
EOF
```

`.dev/console.env` is what ibl.ai/ontology is started with; an `.env.local` of yours is left as
it is. The four files in `.dev/secrets` are random: the database's password, the engine's sign-in
secret, its admin's password, and the key the engine presents for its model calls.

### 2. Install PostgreSQL and the build tools

PostgreSQL 17 and pgvector come from PostgreSQL's own repository, since Ubuntu's own pgvector is
too old for the engine on 24.04. The lines after them make the engine's database with its own
login.

```bash
sudo apt-get update
sudo apt-get install -y postgresql-common ca-certificates build-essential libpq-dev git curl libatomic1
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-17 postgresql-17-pgvector
port=$(pg_conftool -s 17 main show port)
as_postgres() { (cd / && sudo -u postgres "$@"); }
as_postgres psql -p "$port" -qc "DO \$\$ BEGIN CREATE ROLE auto_ontology LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$"
printf "ALTER ROLE auto_ontology PASSWORD '%s';\n" "$(cat .dev/secrets/db-password)" | as_postgres psql -p "$port" -q
as_postgres psql -p "$port" -tAc "SELECT 1 FROM pg_database WHERE datname = 'auto_ontology'" | grep -q 1 ||
  as_postgres createdb -p "$port" -O auto_ontology auto_ontology
as_postgres psql -p "$port" -d auto_ontology -qc "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
```

A PostgreSQL that is already on the machine is left as it is: the block adds one login and one
database to the version 17 cluster.

### 3. Build NVIDIA's engine

[uv](https://docs.astral.sh/uv/) builds the two Python services with the Python NVIDIA names, and
[mise](https://mise.jdx.dev) gives the web app Node 22 and its pnpm. The block writes the engine's
settings to `.dev/engine/.env`, where all three read them, and makes its tables.

```bash
bash -eo pipefail -c '
  export CI=1 NEXT_TELEMETRY_DISABLED=1 PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
  command -v mise >/dev/null || curl -fsSL https://mise.run | MISE_INSTALL_HELP=0 sh
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/0.13.7/install.sh | env UV_UNMANAGED_INSTALL="$HOME/.local/bin" sh
  secrets=$PWD/.dev/secrets
  models=http://127.0.0.1:3000/internal/models/v1
  test -d .dev/engine || git clone --depth 1 --branch release/v1.2.0 https://github.com/NVIDIA/auto-ontology.git .dev/engine
  cd .dev/engine
  install -m 600 /dev/null .env
  cat > .env <<EOF
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=$(pg_conftool -s 17 main show port)
POSTGRES_USER=auto_ontology
POSTGRES_PASSWORD=$(cat $secrets/db-password)
POSTGRES_DATABASE=auto_ontology
REASONING_MODEL=openai/chat
REASONING_ENDPOINT=$models
REASONING_API_KEY=$(cat $secrets/model-key)
NON_REASONING_MODEL=openai/chat
NON_REASONING_ENDPOINT=$models
NON_REASONING_API_KEY=$(cat $secrets/model-key)
EMBED_MODEL=openai/embedding
EMBED_ENDPOINT=$models
EMBED_API_KEY=$(cat $secrets/model-key)
RERANK_MODEL=openai/rerank
RERANK_ENDPOINT=$models/rerank
RERANK_API_KEY=$(cat $secrets/model-key)
INGESTION_SERVICE_URL=http://127.0.0.1:3002
PYTHON_API_URL=http://127.0.0.1:3001
APP_URL=http://localhost:3100
AUTO_ONTOLOGY_ADMIN_EMAIL=admin@ontology.local
AUTO_ONTOLOGY_ADMIN_PASSWORD=$(cat $secrets/admin-password)
AUTH_SECRET=$(cat $secrets/auth-secret)
EOF
  uv sync --no-dev
  .venv/bin/alembic upgrade head
  cd frontend
  mise exec node@22 pnpm@10.34.3 -- pnpm install --frozen-lockfile
  mise exec node@22 -- sh prisma/migrate.sh
  mise exec node@22 pnpm@10.34.3 -- pnpm build
'
```

The engine's model calls go to ibl.ai/ontology's own private route, as they do in Docker. With no
`OPENAI_API_KEY` line in `.dev/console.env` that route refuses them and nothing leaves the
machine.

### 4. Install ibl.ai/ontology's packages

mise gives the checkout the Node and pnpm versions it names, and pnpm installs its packages.

```bash
bash -eo pipefail -c '
  export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
  mise install
  mise exec -- pnpm install --frozen-lockfile
'
```

### 5. Start everything

NVIDIA's three processes run in the background, in your own systemd session. Its Python services
ask to listen on every address, so they are started with the address swapped for this machine's
own. ibl.ai/ontology's dev server then runs in this terminal.

```bash
engine=$PWD/.dev/engine
mise=$(command -v mise || echo "$HOME/.local/bin/mise")
shim='import runpy, sys, uvicorn; run = uvicorn.run; uvicorn.run = lambda app, **options: run(app, **{**options, "host": "127.0.0.1"}); runpy.run_module(sys.argv[1], run_name="__main__")'
for service in ingestion_service server; do
  systemd-run --user --collect --unit=ontology-engine-$service --working-directory="$engine" \
    "$engine/.venv/bin/python" -c "$shim" auto_ontology.$service
done
systemd-run --user --collect --unit=ontology-engine-web --working-directory="$engine/frontend" \
  "$mise" exec node@22 -- node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
curl -fsS --retry 60 --retry-delay 2 --retry-connrefused http://127.0.0.1:3001/api/health/live; echo
(set -a && . .dev/console.env && set +a && exec "$mise" exec -- pnpm dev -H 127.0.0.1)
```

The `curl` prints the engine's answer once its API is up, and the dev server then prints its
address. Then [sign in](#sign-in).

To stop it: Ctrl-C ends the dev server, and `systemctl --user stop 'ontology-engine-*'` ends the
engine. The engine does not come back after you sign out of the machine: paste this block again.

## Sign in

Open `http://localhost:3000` and sign in with an ibl.ai account that administers the platform.

## Use it

Build an MCP server in the console, then issue a token under its **Tokens & Origins** tab. An MCP
client on this machine connects with the address and the snippet its **Connect** tab shows.

## What is different from a server

- **This machine only.** Plain http from another machine is refused.
- **It needs the internet.** Sign-in and every MCP call still ask ibl.ai who the caller is, and
  every MCP call still needs a token.
- **ibl.ai's agents cannot call it.** They cannot reach `localhost`, so the **Connect** tab shows
  the client snippets and no **Attach**.
- **An HTTP API on this machine can be connected.** A server with a public host name refuses one.

## Reading your own files

A Filesystem source reads one folder, and nothing outside it. How to connect one is in
[connect-data-sources.md](guides/connect-data-sources.md#adding-a-filesystem).

- **With Docker**: a container sees only what is mounted, so the folder is `.dev/files` in the
  checkout. To read another folder, change `ONTOLOGY_LOCAL_ROOT` in `deploy/.env` to its full
  path and paste block 4 again. The files must be readable by uid 1000, the image's `node`
  account.
- **Without Docker**: the folder is your home folder. To read only one folder, add
  `ONTOLOGY_LOCAL_ROOT=/home/you/data` to `.dev/console.env` and start the dev server again.

## If a step fails

With Docker, blocks 2, 3 and 4 can be pasted again as they are: each takes up where it stopped.

- **Block 2 says `Could not get lock`**: Ubuntu is updating itself. Wait a minute and paste it
  again.
- **Block 3 stops**: Docker's last lines name the step that failed. Paste it again: the steps
  that finished are kept.
- **Block 4 stops with `DeadlineExceeded` at `nvcr.io`**: NVIDIA's registry timed out. Paste it
  again.
- **The last line prints no `{"ok":true}`**: in `deploy`,
  `sudo docker compose logs --tail 30 ontology` says why it did not start.

Without Docker, blocks 2 to 4 can be pasted again as they are.

- **Block 2 says `Could not get lock`**: Ubuntu is updating itself. Wait a minute and paste it
  again.
- **Block 3 or 4 stops**: its last lines name what failed. Paste it again: what was built is
  kept.
- **Block 5 says a unit already exists**: the engine is still running from before. Stop it as
  above, then paste the block again.
- **The `curl` ends with an error**: `journalctl --user -u 'ontology-engine-*' -n 30` says why
  the engine did not start.

## On a server

Both server installs, [install_docker_local.md](install_docker_local.md) and
[install.md](install.md), run NVIDIA's engine in Docker, with Caddy for the certificate. The
path without Docker is for a machine of your own only.
