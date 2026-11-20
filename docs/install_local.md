# Run ibl.ai/ontology on your own machine

Four blocks to paste on a Linux machine of your own, and one step on ibl.ai. Most of the time goes
to one build and one download. No host name, no DNS record and no open port: the console answers
at `http://localhost:3000` on the machine itself.

What ends up on the machine:

- **ibl.ai/ontology**, in Docker, as an image built there from this repository's
  [`Dockerfile`](../Dockerfile). Nothing of ibl.ai's arrives as a prebuilt image.
- **NVIDIA's auto-ontology engine and its database**, in Docker. The engine is NVIDIA's own
  images, pulled from its registry. Caddy is left out.

To run it on a server that people reach by a host name, follow
[install_docker_local.md](install_docker_local.md) or [install.md](install.md) instead.

## Before you start

- **A Linux machine**: x86-64, with 4 GB of memory and 15 GB free, and a user who can `sudo`.
  The blocks below are written for Ubuntu 22.04, 24.04 or 26.04.
- **An internet connection**: sign-in, and every call an agent makes, are checked with ibl.ai.
- **Your ibl.ai platform key**, such as `example-university`, and an administrator of that
  platform. Check [login.iblai.app/me](https://login.iblai.app/me) for this info.

Paste each block into a terminal on the machine and press Enter. Only the first one needs your
values.

## 1. Name the platform

Replace `example-university` with yours. Run this block once: a second run writes the file anew.

```bash
sudo mkdir -p /opt/iblai-ontology
sudo tee /opt/iblai-ontology/.env <<'EOF'
ONTOLOGY_PLATFORM=example-university
COMPOSE_PROFILES=all-in-one
EOF
sudo chmod 600 /opt/iblai-ontology/.env
```

With no `ONTOLOGY_HOST` line, the server answers on this machine only.

## 2. Install Docker

Everything runs in it, and it builds the image. This is Ubuntu's line; on another distribution,
install Docker, Compose 2.23.1 or later, buildx and git from its own packages.

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx git curl
```

## 3. Build ibl.ai/ontology

Docker builds the image from the source, under the name `compose.yaml` asks for, so Compose
finds it on the machine and pulls nothing of ibl.ai's.

```bash
cd /opt/iblai-ontology
test -d repo || sudo git clone --branch main https://github.com/iblai/ontology.git repo
sudo docker build -t public.ecr.aws/ibleducation/iblai-ontology:local repo
```

## 4. Start everything

```bash
cd /opt/iblai-ontology
sudo cp repo/deploy/compose.yaml .
sudo docker compose up -d --scale proxy=0
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/api/host/health; echo
```

`--scale proxy=0` leaves Caddy out; put the same flag on every later `docker compose up`.
`docker compose up -d` downloads NVIDIA's engine the first time, about half a gigabyte. The last
line prints `{"ok":true}` once ibl.ai/ontology is up.

## 5. Sign in

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

A container sees only what is mounted, so a Filesystem source reads one folder:
`/opt/iblai-ontology/files` unless you choose another (Docker makes it, empty, on the first
start). To read a folder of yours, add `ONTOLOGY_LOCAL_ROOT=/home/you/data` to
`/opt/iblai-ontology/.env` before block 4. The files must be readable by uid 1000, the image's
`node` account. How to connect one is in
[connect-data-sources.md](guides/connect-data-sources.md#adding-a-filesystem).

## If a step fails

Blocks 2, 3 and 4 can be pasted again as they are: each takes up where it stopped.

- **Block 2 says `Could not get lock`**: Ubuntu is updating itself. Wait a minute and paste it
  again.
- **Block 3 stops**: Docker's last lines name the step that failed. Paste it again: the steps
  that finished are kept.
- **Block 4 stops with `DeadlineExceeded` at `nvcr.io`**: NVIDIA's registry timed out. Paste it
  again.
- **The last line prints no `{"ok":true}`**: `sudo docker compose logs --tail 30 ontology` says
  why it did not start.

## Putting it on the internet later

Follow [install_docker_local.md](install_docker_local.md): a host name in `ONTOLOGY_HOST`, ports
80 and 443 open, and `docker compose up -d` without the flag.
