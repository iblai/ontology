# Install the ontology console

For the IT team of a university or a company that runs the ibl.ai ontology console on a server of
its own. One Docker Compose file is the install: you download it, set two settings and start it.
This page shows those steps, what ends up on the server, how to give it a model, and how to look
after it. A script that does the same on a fresh Ubuntu server is at the end.

## What you end up with

One server, everything in Docker:

| Part                          | What it does                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The console                   | The pages you manage it from, the API those pages call, and the MCP servers your agents call.                                                    |
| NVIDIA's auto-ontology engine | Its web app, its API and its ingestion service: it reads your systems and builds the terms. Docker builds it on the server from NVIDIA's source. |
| The engine's database         | Postgres, for the engine alone.                                                                                                                  |
| Caddy                         | Gets and renews the certificate for your host name, sends http on to https, and is the one way in.                                               |

What the internet reaches, all through Caddy on ports 80 and 443: the console, the MCP servers,
and NVIDIA's API. What it does not: NVIDIA's sign-in and its own pages, and the engine's model
route. The console (3000), NVIDIA's web app (3100), its API (3001), its ingestion service (3002),
the database (5434) and every MCP server's process listen on the server's loopback only.

Your ibl.ai platform keeps what it keeps today: the sign-ins, the roles, and one key per agent you
connect. The server serves that one platform and no other.

## Before you start

- **A server**: Ubuntu 22.04, 24.04 or 26.04 on x86-64, with root access. A fresh one is best.
  Docker builds the engine on it, so it needs at least 15 GB free where Docker keeps its data and
  4 GB of memory. Nothing else may listen on 80, 443, 3000, 3001, 3002, 3100 or 5434: the services
  run on the server's own network.
- **No older ibl.ai ontology backend on it.** A server that runs v0.2.x keeps its files in
  `/opt/iblai-ontology` and holds 80 and 443. Remove it first with its own installer (see
  [When something stops](#when-something-stops)): the new `compose.yaml`, downloaded into that
  directory, would replace the older one's file.
- **Docker with Compose 2.23.1 or later and buildx, and git.** Docker builds NVIDIA's services
  from its git address, which needs git on the server. Ubuntu's own archive has all four:
  `sudo apt-get install docker.io docker-compose-v2 docker-buildx git`.
- **A host name** that points to the server, such as `ontology.example.edu`, and **ports 80 and 443
  open to the internet**. Create the DNS record first: the certificate cannot be issued until the
  name resolves to the server. 80 is used for the certificate and to send http on to https.
- **Outbound access during the first start** to GitHub, `nvcr.io`, Docker Hub, `public.ecr.aws`, PyPI,
  the npm registry, `astral.sh`, `deb.nodesource.com` and Ubuntu's archive: the images are pulled
  and the engine is built from them. **Once it runs**, to your ibl.ai platform, to the data
  sources you connect, to Let's Encrypt to renew the certificate, and to your model's address if
  you give it one.
- **Your platform's key**: the short name ibl.ai knows your platform by, such as
  `acme-university`.
- **An administrator of the platform**, to add the server's address to the platform's allowed
  redirect origins and to sign in.

## Install

In the directory that will hold the file, such as `/opt/iblai-ontology`:

```bash
curl -fsSLO https://github.com/iblai/ontology/releases/latest/download/compose.yaml
docker compose up -d
```

Before the second command, set the two settings at the top of `compose.yaml`:

- `ONTOLOGY_PLATFORM`: your platform's key. It has no default: without it Compose stops and names
  it.
- `ONTOLOGY_HOST`: the server's host name. Without it the console answers at `https://localhost`,
  from the server itself only, with a certificate of Caddy's own that browsers warn about.

The easiest way to set them is a `.env` beside `compose.yaml`, which an upgrade does not replace:

```bash
cat > .env <<'EOF'
ONTOLOGY_PLATFORM=acme-university
ONTOLOGY_HOST=ontology.example.edu
EOF
```

The first `up` takes several minutes: Docker builds NVIDIA's services from its source at the
commit this release was proven with. Run the commands as root, or as a user who may run Docker.
To see that it answers:

```bash
docker compose ps
curl -fsS https://ontology.example.edu/api/host/health
```

```text
{"ok":true}
```

## The settings

| Setting                  | Default                        | What it does                                                                                            |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `ONTOLOGY_PLATFORM`      | None: Compose stops without it | Your platform's key. The server serves that platform only; another platform's administrator is refused. |
| `ONTOLOGY_HOST`          | `localhost`                    | The host name. Caddy gets the certificate for it.                                                       |
| `ONTOLOGY_DM_URL`        | `https://api.iblai.app/dm`     | The ibl.ai platform's address, where every sign-in and key is checked.                                  |
| `OPENAI_API_KEY`         | Empty                          | Turns the semantic features on (see [A model](#a-model)).                                               |
| `OPENAI_API_BASE_URL`    | `https://api.openai.com/v1`    | Where the model calls go: OpenAI, or a gateway that speaks its API.                                     |
| `OPENAI_MODEL`           | `gpt-4.1`                      | The chat model.                                                                                         |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-large`       | The embedding model.                                                                                    |

Three ways to set one:

- **In `.env` beside `compose.yaml`**, one `NAME=value` per line. An upgrade keeps it. This is the
  one to use.
- **At the top of `compose.yaml`**, in its `x-settings` block: change the text after `:-` inside
  the quotes, as in `"${ONTOLOGY_HOST:-ontology.example.edu}"`. The platform has no default:
  replace its whole quoted value with your key in quotes, as in `"acme-university"`. An upgrade
  replaces the file, so you make the change again each time.
- **In the shell**, as `ONTOLOGY_PLATFORM=acme-university docker compose up -d`. Compose reads the
  settings on every command, so `docker compose logs` or `down` without it stops as well.

A name set in the shell wins over `.env`, and both win over a default in the file.

After a change, `docker compose up -d` again: it restarts what the change touches.

`ONTOLOGY_PLATFORM` is the one setting not to change on a server that holds data. The engine's
connected systems and terms belong to the platform it was installed for, and a server pointed at
another platform would serve them to it. To serve another platform, remove the install with its
data (see [Day to day](#day-to-day)) and install again.

## After it starts

1. **Add `https://<host>` to the platform's allowed redirect origins on ibl.ai.** Sign-in returns
   only to an address the platform allows. Without it, signing in ends on ibl.ai with the address
   refused.
2. **Open `https://<host>/` and sign in** with your ibl.ai account on that platform.

What is reachable afterwards:

| Address                                                      | What                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `https://<host>/`                                            | The console.                                                                                               |
| `https://<host>/<platform>/<server>/mcp`                     | An MCP server you deploy in the console. Agents call it with their own key.                                |
| `https://<host>/api/host/...`                                | The API the console's pages call, with your sign-in. `/api/host/health` answers anyone with `{"ok":true}`. |
| `https://<host>/api/...`                                     | NVIDIA's API, with the engine's own keys: everything under `/api` except `/api/host` and `/api/auth`.      |
| `https://<host>/api/auth/...`, `https://<host>/internal/...` | 404. NVIDIA's sign-in and the engine's model route stay on the server.                                     |
| `https://<host>/iblai/...`                                   | A second address for a console hosted elsewhere (see the last section).                                    |

## A model

Without a model, connecting a database, the semantic map, certifying terms, and the raw SQL and
certified-term tools of an MCP server all work; the engine names its terms from the table and
column names. Joins it would infer, and answering questions in plain words, need a model.

To give it one, add the key to `.env` and start again:

```bash
echo 'OPENAI_API_KEY=<your key>' >> .env
docker compose up -d
```

The engine never holds the key. It calls a route of the console on the server's loopback with a
generated key of its own, and the console adds your key and sends the call on to
`OPENAI_API_BASE_URL`, with `OPENAI_MODEL` for chat and `OPENAI_EMBEDDING_MODEL` for embeddings.

- **A gateway** that speaks OpenAI's API goes in `OPENAI_API_BASE_URL`. One that names its models
  `provider/model`, such as the ibl.ai DM or OpenRouter, takes that id in `OPENAI_MODEL`. The DM has
  no embeddings route yet, so with it only chat works for now.
- **The chat model** must take an output-token limit as a chat model does. The engine sets small
  limits, which a reasoning model's hidden tokens would use up.
- **The embedding model** must be able to answer in 2048 dimensions. `text-embedding-3-large` can;
  `text-embedding-3-small` cannot.

## The generated secrets

Nothing secret is typed or kept in `compose.yaml` or `.env`. On the first start a one-shot service,
`secrets`, writes four random secrets into the `secrets` volume, and never again:

| Secret           | What it is                                                  |
| ---------------- | ----------------------------------------------------------- |
| `db-password`    | The engine's database password.                             |
| `auth-secret`    | Signs the engine's sign-in sessions.                        |
| `admin-password` | The password of the engine's admin, `admin@ontology.local`. |
| `model-key`      | The engine's key to the console's model route.              |

The console makes its own key to the engine: it signs in as the engine's admin, makes a key and
keeps it in its own volume. Nobody mints a key by hand.

The `secrets` and `postgres_data` volumes go together: the database was created with that
password. Back them up together, and never delete one without the other.

To read the engine admin's password:

```bash
docker compose exec ontology cat /secrets/admin-password
```

NVIDIA's own pages are not served on the internet: on the same host name they would share an
origin with the console and could read its sign-in. To open them, tunnel from your computer:

```bash
ssh -L 3100:127.0.0.1:3100 <you>@<host>
```

Then open `http://localhost:3100` and sign in as `admin@ontology.local` with that password.

## Day to day

In the directory that holds `compose.yaml`:

```bash
docker compose ps                                     # what is running
docker compose logs --follow ontology                 # the console's log
docker compose logs --tail 50 auto-ontology-frontend  # NVIDIA's web app
docker compose restart                                # restart everything
```

**Upgrade**: download the new `compose.yaml` over the old one and start again.

```bash
curl -fsSLO https://github.com/iblai/ontology/releases/latest/download/compose.yaml
docker compose up -d
```

The console's new image is pulled. When the release pins another commit of NVIDIA's engine, Docker
builds it again by itself, which takes several minutes. Settings you made at the top of the old
file are gone with it; those in `.env` stay.

**Back up**: `.env`, and these Docker volumes (Docker names each `iblai-ontology-console_<name>`).
Stop the services first (`docker compose stop`), so the database is copied whole.

| Volume          | What it holds                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `secrets`       | The four generated secrets. Goes with `postgres_data`.                                                 |
| `postgres_data` | The engine's database: the systems it reads, its terms and what was certified, its users and keys.     |
| `ontology_data` | The console's files: the MCP servers deployed on it, their revisions, the logs, its key to the engine. |
| `certificates`  | Caddy's certificate. It is issued again by itself, so it needs no backup.                              |

**Remove**: remove each agent's connection in the console first, so its key is deleted in your
platform. Then:

```bash
docker compose down            # removes the containers; the data stays
docker compose down --volumes  # removes the data too
```

## Another ibl.ai deployment

The settings above point the server at the hosted ibl.ai platform. For another ibl.ai deployment,
`ONTOLOGY_DM_URL` is the server's half of the choice. The browser's half is fixed when the
console's image is built, so that deployment builds its own image from this repository, at the
release's tag, with its addresses as build arguments:

```bash
git clone --branch v<version> https://github.com/iblai/ontology
cd ontology
docker build -t <registry>/ontology:<version> \
  --build-arg NEXT_PUBLIC_API_BASE_URL=<...> \
  --build-arg NEXT_PUBLIC_AUTH_URL=<...> \
  --build-arg NEXT_PUBLIC_BASE_WS_URL=<...> \
  --build-arg NEXT_PUBLIC_PLATFORM_BASE_DOMAIN=<...> \
  --build-arg NEXT_PUBLIC_LEGACY_LMS_URL=<...> \
  --build-arg NEXT_PUBLIC_MFE_URL=<...> \
  .
```

Then name that image on the `image:` line of the `ontology` service in `compose.yaml`, and set
`ONTOLOGY_DM_URL` to the deployment's platform address.

## Or let the script do it

On a fresh Ubuntu server, one command does all of the above:

```bash
curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh \
  | sudo bash -s -- --host ontology.example.edu --platform acme-university
```

To read the script before running it:
`curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh | less`.

It:

1. **Checks the server** before it changes anything: root, Ubuntu 22.04 or later, x86-64, `curl`
   and `ss`, no older ibl.ai ontology backend in `/opt/iblai-ontology`, and on a first install the
   ports above free and the room and memory to build. Otherwise it stops and says why.
2. **Docker**: uses the one that is there, with Compose 2.23.1 or later and buildx, and installs
   git alone if it is missing. With no Docker it installs `docker.io`, `docker-compose-v2`,
   `docker-buildx` and `git` from Ubuntu's own archive; no repository or key file is added.
3. **Asks for the platform's key** if the command did not carry it.
4. **Writes `/opt/iblai-ontology/.env`** with the names it was given (`ONTOLOGY_PLATFORM`,
   `ONTOLOGY_HOST`, `ONTOLOGY_DM_URL`) and no secret. Lines you added, such as `OPENAI_API_KEY`,
   are left as they are.
5. **Downloads** the `compose.yaml` of its own release into `/opt/iblai-ontology`.
6. **Builds NVIDIA's services**, up to three times, since NVIDIA's base image sometimes times out.
7. **Starts everything** and waits up to five minutes for `https://<host>/api/host/health`.
8. **Prints** the addresses, the redirect-origin step, how to read the engine admin's password and
   open NVIDIA's pages, and the day-to-day commands. It never prints a secret.

What it prints on a fresh server, with Docker's own output left out:

```text
Installing Docker, Compose, buildx and git from Ubuntu's own archive (docker.io, docker-compose-v2, docker-buildx, git).
Writing the settings into /opt/iblai-ontology/.env (readable by root alone).
Getting compose.yaml of version <version>.
Building NVIDIA's services (attempt 1 of 3; the first build takes several minutes).
Starting the console, NVIDIA's engine and Caddy.
Waiting for https://ontology.example.edu/api/host/health (up to 5 minutes; with a host name, the certificate comes first).

The ontology console is running (version <version>), serving the platform acme-university.

  The console:              https://ontology.example.edu/
  The address agents call:  https://ontology.example.edu/acme-university/<server>/mcp
  NVIDIA's API:             https://ontology.example.edu/api/...

  One step left, on ibl.ai: add https://ontology.example.edu to the platform's allowed redirect origins.
  Sign-in returns to no other address. Then sign in at https://ontology.example.edu/.
  ...
```

Run it again to upgrade: `.env` keeps what was given, and `--host` or `--platform-url` given again
replaces it. A `--platform` other than the one the server already serves is refused.

| Option                     |                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--platform <key>`         | The platform this server serves. Asked for if not given.                                                       |
| `--host <host name>`       | The name the server answers at. Without it, `localhost`.                                                       |
| `--platform-url <address>` | The ibl.ai platform's address, when it is not `https://api.iblai.app/dm`.                                      |
| `--dry-run`                | Say what would happen; change nothing and ask nothing.                                                         |
| `--uninstall`              | Remove the console, its data and `/opt/iblai-ontology`. It asks you to type the host name first. Docker stays. |
| `--help`                   | Print this list.                                                                                               |

## When something stops

| What you see                                                                                                                                                                                | What it means                                                                          | What to do                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose stops with `required variable ONTOLOGY_PLATFORM is missing a value: set it to the key of the ibl.ai platform this server serves, at the top of compose.yaml or in a .env beside it` | The platform is not set.                                                               | Set `ONTOLOGY_PLATFORM` in `.env` (see [The settings](#the-settings)).                                                                                                            |
| The build stops at `nvcr.io/nvidia/base/ubuntu:jammy-20250619` with `DeadlineExceeded`                                                                                                      | Pulling NVIDIA's base image timed out. It reads like a missing login; it is not.       | `docker pull nvcr.io/nvidia/base/ubuntu:jammy-20250619`, then `docker compose up -d` again.                                                                                       |
| `proxy` keeps restarting; `docker compose logs proxy` says `address already in use`                                                                                                         | Something else holds 80 or 443, such as the older ibl.ai ontology backend (v0.2.x).    | Stop it. The older backend is removed with its own installer: `curl -fsSL https://github.com/iblai/ontology/releases/download/v0.2.13/install.sh \| sudo bash -s -- --uninstall`. |
| The browser warns about the certificate, and `docker compose logs proxy` shows the certificate failing                                                                                      | Let's Encrypt cannot reach the server by its host name.                                | Check that `ONTOLOGY_HOST` points to this server and that 80 and 443 are open to the internet. Caddy tries again by itself.                                                       |
| Signing in ends on ibl.ai with the address refused                                                                                                                                          | `https://<host>` is not among the platform's allowed redirect origins.                 | Add it (see [After it starts](#after-it-starts)).                                                                                                                                 |
| The console answers 503 `ONTOLOGY_PLATFORM is not set…`                                                                                                                                     | The console was started some other way than this file, with an engine and no platform. | Set `ONTOLOGY_PLATFORM` where it is started.                                                                                                                                      |
| An administrator gets 403 `This server serves another platform.`                                                                                                                            | They signed in to another platform than `ONTOLOGY_PLATFORM`.                           | Sign in to the platform this server serves.                                                                                                                                       |

## A console hosted elsewhere

The console's pages can also run somewhere else, built with `NEXT_PUBLIC_ONTOLOGY_RELAY=1`, and
reach this server as theirs. They call it at `https://<host>/iblai/...`: `/iblai/api/host/...` and
`/iblai/<platform>/<server>/mcp`, which Caddy sends on to the console with `/iblai` taken off. The
server is installed the same way; nothing changes on it.
