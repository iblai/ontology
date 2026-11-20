# Install ibl.ai/ontology with Docker, built locally

Four blocks to paste on a fresh Ubuntu server, and one step on ibl.ai. Most of the time goes to
one build and one download.

What ends up on the server:

- **ibl.ai/ontology**, in Docker, as an image built there from this repository's
  [`Dockerfile`](../Dockerfile). Nothing of ibl.ai's arrives as a prebuilt image.
- **NVIDIA's auto-ontology engine, its database and Caddy**, in Docker. The engine is NVIDIA's
  own images, pulled from its registry, and Caddy gets the HTTPS certificate.

To build ibl.ai/ontology from source and run it with systemd instead, follow
[install.md](install.md). Use one or the other on a server, never both. On a machine of your own,
with no host name, follow [dev_local.md](dev_local.md).

A Filesystem source reads only inside `ONTOLOGY_LOCAL_ROOT`, mounted read-only into the container:
`/opt/iblai-ontology/files` unless `.env` names another folder (Docker makes it, empty, if it is
not there). The files must be readable by uid 1000, the image's `node` account.

## Before you start

- **An Ubuntu server**: 22.04, 24.04 or 26.04 on x86-64, with 4 GB of memory and 15 GB free, and
  a user who can `sudo`. A fresh one is best.
- **A host name** that points to the server, such as `ontology.example.edu`, with ports 80 and
  443 open to the internet. Create the DNS record first: the certificate cannot be issued until
  the name resolves to the server.
- **Your ibl.ai platform key**, such as `example-university`, and an administrator of that
  platform. Check [login.iblai.app/me](https://login.iblai.app/me) for this info.

Paste each block into a terminal on the server and press Enter. Only the first one needs your
values.

## 1. Name the platform and the host

Replace `example-university` and `ontology.example.edu` with yours, and allow 80 and 443 ports via
`ufw`. Run this block once: a second run writes the file anew.

```bash
sudo mkdir -p /opt/iblai-ontology
sudo tee /opt/iblai-ontology/.env <<'EOF'
ONTOLOGY_PLATFORM=example-university
ONTOLOGY_HOST=ontology.example.edu
COMPOSE_PROFILES=all-in-one
EOF
sudo chmod 600 /opt/iblai-ontology/.env
command -v ufw >/dev/null 2>&1 && {
    sudo ufw allow 80
    sudo ufw allow 443
}
```

Without the `COMPOSE_PROFILES=all-in-one` line, `docker compose up -d` starts only NVIDIA's engine,
its database and Caddy. With it, the same command also starts ibl.ai/ontology from the image
built in block 3.

## 2. Install Docker

Everything runs in it, and it builds the image.

```bash
sudo apt-get update
sudo apt-get install -y docker.io git curl libatomic1
sudo apt-get install -y docker-compose-v2 || sudo apt-get install -y docker-compose

```

## 3. Build ibl.ai/ontology

Docker builds the image from the source, under the name `compose.yaml` asks for, so Compose
finds it on the server and pulls nothing of ibl.ai's.

```bash
cd /opt/iblai-ontology
test -d repo || sudo git clone --branch main https://github.com/iblai/ontology.git repo
sudo docker build -t public.ecr.aws/ibleducation/iblai-ontology:local repo
```

## 4. Start everything

```bash
cd /opt/iblai-ontology
sudo cp repo/deploy/compose.yaml .
sudo docker compose up -d
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/api/host/health; echo
```

`docker compose up -d` downloads NVIDIA's engine the first time, about half a gigabyte. The
last line prints `{"ok":true}` once ibl.ai/ontology is up.

## 5. Let people sign in

Open `https://ontology.example.edu/` (your host) and sign in with your ibl.ai account on that platform.

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

Looking after the server, and upgrading it, is in
[operations.md](operations.md#or-build-the-image-yourself).
