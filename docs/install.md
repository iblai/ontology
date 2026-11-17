# Install the ontology console

Four blocks to paste on a fresh Ubuntu server, and one step on ibl.ai. It takes about fifteen
minutes, most of it two builds.

What ends up on the server:

- **The console**, built there from this repository's source and run by systemd. Nothing of
  ibl.ai's arrives as a prebuilt image.
- **NVIDIA's auto-ontology engine, its database and Caddy**, in Docker. Docker builds the engine
  from NVIDIA's source, and Caddy gets the HTTPS certificate.

## Before you start

- **An Ubuntu server**: 22.04, 24.04 or 26.04 on x86-64, with 4 GB of memory and 15 GB free, and
  a user who can `sudo`. A fresh one is best.
- **A host name** that points to the server, such as `ontology.example.edu`, with ports 80 and
  443 open to the internet. Create the DNS record first: the certificate cannot be issued until
  the name resolves to the server.
- **Your ibl.ai platform's key**, such as `acme-university`, and an administrator of that
  platform.

Paste each block as it is into a terminal on the server. Only the first one needs your values.

## 1. Name the platform and the host

Replace `acme-university` and `ontology.example.edu` with yours.

```bash
sudo mkdir -p /opt/iblai-ontology
sudo tee /opt/iblai-ontology/.env <<'EOF'
ONTOLOGY_PLATFORM=acme-university
ONTOLOGY_HOST=ontology.example.edu
EOF
sudo chmod 600 /opt/iblai-ontology/.env
```

## 2. Install Docker

NVIDIA's engine, its database and Caddy run in it.

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 docker-buildx git curl
```

## 3. Build the console

A user of its own, `ontology`, builds the console and later runs it. [mise](https://mise.jdx.dev)
gives that user the Node and pnpm versions this repository names.

```bash
sudo useradd --system --create-home ontology
sudo -u ontology -H bash -ec '
  cd ~
  curl -fsSL https://mise.run | sh
  export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
  git clone --branch main https://github.com/iblai/ontology.git console
  cd console
  mise install
  pnpm install --frozen-lockfile
  pnpm build
'
```

## 4. Start everything

```bash
cd /opt/iblai-ontology
sudo cp /home/ontology/console/deploy/compose.yaml .
sudo cp /home/ontology/console/deploy/ontology-console.service /etc/systemd/system/
sudo docker compose up -d
sudo systemctl enable --now ontology-console
curl -fsS --retry 5 --retry-connrefused http://127.0.0.1:3000/api/host/health
```

`docker compose up -d` builds NVIDIA's engine the first time, which takes several minutes. The
last line prints `{"ok":true}` once the console is up.

## 5. Let people sign in

1. On ibl.ai, add `https://<your host>` to the platform's allowed redirect origins. Sign-in
   returns to no other address.
2. Open `https://<your host>/` and sign in with your ibl.ai account on that platform.

## If a step fails

- **Block 4 stops with `DeadlineExceeded` at `nvcr.io`**: NVIDIA's registry timed out. Run
  `sudo docker compose up -d` again.
- **The last line prints no `{"ok":true}`**: `sudo journalctl -u ontology-console -n 30` says why
  the console did not start.

Everything else is in [operations.md](operations.md): giving the engine a model, the settings,
logs, upgrades, backups, removing it, and
[what each failure means](operations.md#when-something-stops).
