# Install an ontology server

For the administrator of an ibl.ai platform who runs the ontology server on a server of their own.
It shows the one command, what it prints, how the server becomes your platform's, what ends up on
the server, and how to look after it.

The console, **ibl.ai Ontology**, is at `https://ontology.ibl.ai`. With no server connected it
shows **Connect a server**, with the same command and your host name filled in. This page is the
long version.

## What you end up with

| Where | What |
|---|---|
| Your server | NVIDIA's auto-ontology engine (its web app, its API, its ingestion service and its database), built on the server from NVIDIA's source; the ibl.ai server half, which serves the console and the MCP servers your agents call; and Caddy, which gets the certificate. All of it runs in Docker. |
| Your ibl.ai platform | The sign-ins, the roles, and one key per agent you connect. |
| ibl.ai Ontology | The console you manage it from. It runs nothing of yours: it sends what you do to your server. |

## Before you start

- **A server**: Ubuntu 22.04, 24.04 or 26.04 on x86_64, with root access. A fresh one is best. The
  script installs Docker if it is missing; besides that it adds one folder, `/opt/iblai-ontology`,
  and Docker's own volumes and images. No firewall rule is changed.
- **Room to build**: at least 15 GB free where Docker keeps its data, and 4 GB of memory. The
  engine is built on the server, so the script checks both before it starts.
- **A host name** that points to the server, such as `ontology.example.edu`. Create the DNS record
  first: the certificate cannot be issued until the name resolves to the server.
- **Ports 80 and 443 open to the internet.** 80 is used for the certificate and to send http on to
  https; everything else goes over 443. Nothing else may already listen on 80, 443, 3000, 3001,
  3002, 3100 or 5434: the services run on the server's own network.
- **Outbound access during the install** to GitHub, `nvcr.io`, Docker Hub, `ghcr.io`, PyPI, the
  npm registry, `astral.sh`, `deb.nodesource.com` and Ubuntu's archive: the images are pulled and
  the engine is built from them. **Once it runs**, to your ibl.ai platform, to the data sources you
  connect, and to Let's Encrypt to renew the certificate.
- **An administrator's sign-in** on your ibl.ai platform, for step 2. The server itself is given
  no key and no password.

## Step 1. On the server: run the command

```bash
curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh \
  | sudo bash -s -- \
    --host <your server's host name>
```

For the staging console, add `--frontend https://ontology.iblai.me`. A platform that is not at
`https://api.iblai.app/dm` is named with `--platform-url`.

To read the script before running it, download it first:
`curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh | less`.

It asks for the host name if the command did not carry it, and nothing else: no key, no password,
no platform. What it prints on a fresh server, with Docker's own output left out (a server that
has Docker starts with "Docker with Compose is already here: nothing to install."):

```text
Installing Docker, Compose and buildx from Ubuntu's own archive (docker.io, docker-compose-v2, docker-buildx).
This server reaches the platform.
Writing /opt/iblai-ontology/.env (readable by root alone).
Getting the compose files of version <version>.
Getting NVIDIA's engine source at 22e22c89.
Building the engine (attempt 1 of 3; the first build takes several minutes).
Getting the images that are not built here.
Starting NVIDIA's engine.
Waiting for NVIDIA's web app (up to 5 minutes).
Making this server's key to the engine, signed in as the engine's admin inside its own container.
The key is written into /opt/iblai-ontology/.env.
Starting the server and its proxy.
Waiting for https://ontology.example.edu/iblai/api/host/setup: the certificate comes first (up to 3 minutes).

The ontology server is running (version <version>).

  Open this to finish (works once):
  https://ontology.ibl.ai/#host=ontology.example.edu&code=<32 characters>

  It asks you to sign in to ibl.ai; the server becomes the ontology server of the platform
  you are signed in to. Lost it? Run the install command again.

  The address agents call:   https://ontology.example.edu/iblai/<platform>/<server>/mcp
  NVIDIA's own console:      https://ontology.example.edu/
    Sign in as admin@ontology.example.edu; its password is AUTO_ONTOLOGY_ADMIN_PASSWORD in /opt/iblai-ontology/.env.
  No model is configured yet: the engine names terms from table and column names, infers
  no joins and answers no questions.
  ...
```

What it does, in order:

1. **Checks the server** before it writes anything: root, Ubuntu 22.04 or later, x86_64, `curl`,
   `tar` and `ss`, no older ibl.ai ontology backend in `/opt/iblai-ontology`, the ports above
   free, the room and the memory to build. Otherwise it stops and says why.
2. **Docker**: uses the one that is there. With none, it installs `docker.io`,
   `docker-compose-v2` and `docker-buildx` from Ubuntu's own archive; no repository or key file is
   added. Either way, Compose must be 2.24.4 or later.
3. **Asks for the host name** if the command did not carry it.
4. **Asks the ibl.ai platform, with no key, whether this server reaches it.** A network the
   platform does not let through stops the install here.
5. **Writes `/opt/iblai-ontology/.env`**, readable by root alone, with the link's code and the
   engine's passwords, all generated.
6. **Downloads** the release's two compose files and NVIDIA's source at the commit this release
   was proven with, then **builds the engine**. The first run takes several minutes; a build that
   fails is tried up to three times, since NVIDIA's base image sometimes times out.
7. **Starts the engine** and waits up to five minutes for its web app.
8. **Makes the server's key to the engine**: it signs in as the engine's admin from inside the
   engine's own container, so no password crosses a command line, and writes the key into `.env`.
9. **Starts the server half and Caddy**, and waits up to three minutes for
   `https://<host name>/iblai/api/host/setup` to answer.
10. **Prints the link.**

Until the link is used the server belongs to no platform. Keep the link to yourself until then: it
works once, for whoever opens it and administers an ibl.ai platform.

To see every step without changing anything, add `--dry-run`: it asks nothing and prints what it
would do.

## Step 2. In the browser: open the link

1. Open the link the install printed, and sign in to ibl.ai if you are asked.
2. The console names your server and the platform you are signed in to. Go on only if your team
   installed that server.
3. Press **Set up**.

Your server checks the link's code and that you administer the platform, and from then on it is
that platform's ontology server and answers no other. It holds no ibl.ai key of its own.

That browser remembers the server. Another administrator, or you on another computer, connects it
once by host name: under **Connect a server**, enter it and press **Connect**.

## What is reachable afterwards

| Address | What |
|---|---|
| `https://<host name>/iblai/api/host/...` | The server half the console talks to, with your sign-in. |
| `https://<host name>/iblai/<platform>/<server>/mcp` | An MCP server you deploy in the console. Agents call it with their own key. |
| `https://<host name>/` | NVIDIA's own console. Sign in as `admin@<host name>`; the password is `AUTO_ONTOLOGY_ADMIN_PASSWORD` in `/opt/iblai-ontology/.env` (`sudo grep ADMIN_PASSWORD /opt/iblai-ontology/.env`). |

Anything else under `/iblai` answers 404. The engine's API (3001), its ingestion service (3002), its
database (5434), the server half (3000), the engine's web app (3100) and every MCP server's process
listen on the server's loopback only; Caddy alone listens on 80 and 443.

## No model at first

The install configures no model for the engine. Without one, connecting a database, the semantic
map, certifying terms, and the raw SQL and certified-term tools of an MCP server all work; the
engine names its terms from the table and column names. Joins it would infer and answering
questions in plain words need a model and do not work yet.

## How it is configured

Everything the install leaves outside Docker is one folder:

| File | What it is |
|---|---|
| `/opt/iblai-ontology/.env` | This server's settings and secrets. An upgrade keeps it. |
| `/opt/iblai-ontology/server.yml` | The server half and Caddy, as shipped by the release. An upgrade replaces it; do not edit it. |
| `/opt/iblai-ontology/auto-ontology.override.yml` | Runs the engine on the server's loopback. The same. |
| `/opt/iblai-ontology/engine/` | NVIDIA's source at the pinned commit, the engine is built from it. The same. |

What `.env` holds:

| Setting | Comes from | What it does |
|---|---|---|
| `ONTOLOGY_HOST` | `--host` | The host name: the certificate is issued for it. |
| `ONTOLOGY_FRONTEND` | `--frontend` | The console the link opens. |
| `ONTOLOGY_DM_URL` | `--platform-url` | The ibl.ai platform's address, where every sign-in and key is checked. |
| `ONTOLOGY_SETUP_CODE` | Generated | The code of the link. Once the server is set up it opens nothing. |
| `AO_API_KEY` | Made by the install | The server half's key to the engine. |
| `POSTGRES_*` | Set and generated | The engine's database, on port 5434 of the loopback. |
| `PGADMIN_*` | Set and generated | Required by NVIDIA's compose file; pgAdmin is not started. |
| `AUTH_SECRET` | Generated | The engine's sign-in secret. |
| `APP_URL` | `https://<host name>` | The address of NVIDIA's console; its sign-in trusts no other. |
| `AUTO_ONTOLOGY_ADMIN_EMAIL`, `AUTO_ONTOLOGY_ADMIN_PASSWORD` | Set and generated | The engine's admin. The engine applies the password again at every start, so this is where it lives. |
| `DEFAULT_MODELS_API_KEY` | `nvapi-not-set` | No model yet. |

What to back up: `/opt/iblai-ontology/.env`, and the Docker volumes `iblai-ontology_postgres_data`
(the engine's database: the systems it reads, its terms and what was certified, its users and
keys) and `iblai-ontology_ontology_data` (the server's own files: the platform it belongs to and
the MCP servers deployed on it). The certificate in `iblai-ontology_certificates` is issued again
by itself.

## Day to day

```bash
cd /opt/iblai-ontology
compose() { sudo docker compose --env-file .env -f engine/docker-compose.yml \
  -f auto-ontology.override.yml -f server.yml "$@"; }
compose ps                                     # what is running
compose logs --follow ontology                 # the server half's log
compose logs --tail 50 auto-ontology-frontend  # NVIDIA's web app
```

- **Upgrade**: run the install command again. `.env` is kept and nothing is asked; the new
  release's compose files and images replace the old ones, and the engine is built again when the
  release pins another commit of it. On a server that is not set up yet, it prints the link again.
- **Remove**: the same command with `--uninstall`. It asks you to type the host name, then removes
  the containers, the volumes, the images and the folder. Docker stays. Remove each agent's
  connection in the console first, so its key is deleted in your platform.

## When the script stops

Until it writes `.env`, a stop leaves nothing behind but Docker, if the script had to install it.
After that, `.env` is kept and a second run asks nothing. Fix the cause and run the same command
again.

| It says | What it means | What to do |
|---|---|---|
| `run it as root, with sudo.` | The command lacked `sudo`. | Run it as shown. |
| `this installs on Ubuntu 22.04 or later…` or `…built for amd64 (x86_64)…` | Another system or processor. | Use an Ubuntu 22.04, 24.04 or 26.04 server on x86_64. |
| `curl is needed…`, `tar is needed…` or `ss is needed…` | A basic tool is missing. | Install the package the message names. |
| `/opt/iblai-ontology holds the older ibl.ai ontology backend…` | The earlier ontology backend is installed there. | Remove it with the command the message gives, then run this again. |
| `port … is already in use on this server…` | Something else listens on a port the services need. | Stop it, or use another server. |
| `there is … GB free in …` or `this server has … GB of memory…` | Not enough room or memory to build the engine. | Free disk space or use a bigger server. |
| `Docker is installed without Compose…` or `…without buildx…` | Docker is there, a plugin it needs is not. | Add the package the message names. |
| `Docker Compose … is here; this needs 2.24.4 or later.` | The Compose plugin is too old for the compose files. | Upgrade it. |
| `there is no terminal to ask on…` | The command carried no host name, and it was run where it cannot prompt. | Give `--host`, or run it in your own terminal session on the server. |
| `--host is a full host name…`, `--frontend is…` or `--platform-url is…` | A value is not an address. | Correct it. |
| `this server was installed as …, and --host names …` | A re-run with another host name. | Leave `--host` out, or remove the server and install it again. |
| `/opt/iblai-ontology/.env lacks one of…` | `.env` was edited or cut short. | Put it back from your copy. |
| `no answer from the platform at …` | The server cannot reach the ibl.ai platform. | Allow outbound https from the server. |
| `the platform's edge refused this server…` | The network your server is on is not let through to the platform. | Send ibl.ai the server's public address to allow. |
| `… does not answer as an ibl.ai platform…` | `--platform-url` is not a platform. | Check the address. |
| `NVIDIA's engine source could not be downloaded…` | GitHub could not be reached. | Allow outbound https to GitHub. |
| `the engine did not build in three attempts…` | Docker's output above says why: often a registry that cannot be reached, or the disk filling up. | Fix the cause and run it again. |
| `the engine did not start…` or `NVIDIA's web app was not ready in 5 minutes…` | An engine container failed; its last lines are printed above the message. | Read them, fix the cause, run it again. |
| `the engine did not give a key…` | Signing in to the engine or making its key failed; the line above names the step and the HTTP status. | Run it again; if it repeats, send ibl.ai that line. |
| `the server did not start…` | The server half or Caddy failed; their last lines are above. | Read them, fix the cause, run it again. |
| `https://…/iblai/api/host/setup did not answer in 3 minutes…` | The certificate could not be issued or the server cannot be reached. | Check that the host name points to the server and that ports 80 and 443 are open, then run it again. |
| `this copy of install.sh is not from a release…` | The script came from the source tree. | Use the release's, as in the command above. |

## The script's options

| Option | |
|---|---|
| `--host <host name>` | The name the server answers at. |
| `--frontend <address>` | The console the link opens, when it is not `https://ontology.ibl.ai`. |
| `--platform-url <address>` | The ibl.ai platform's address, when it is not `https://api.iblai.app/dm`. |
| `--dry-run` | Say what would happen; change nothing and ask nothing. |
| `--uninstall` | Remove the server, its data and `/opt/iblai-ontology`. |
| `--help` | Print this list. |

A host name not given is asked for. Nothing else is. On an upgrade all three come from `.env`.
