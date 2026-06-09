<p align="center">
  <a href="https://ibl.ai"><img src="https://ibl.ai/logo.png" alt="ibl.ai" height="64"></a>
</p>

<h1 align="center">Ontology</h1>

<p align="center"><strong>The filesystem registry that grounds your AI agent sandboxes.</strong></p>

<p align="center">
Give every OpenClaw / NemoClaw sandbox a stable, governed view of your data — AWS EFS or classic NFS — from a single config file. Declare each filesystem once, bind it to the sandboxes that may use it, read-only or read-write, by folder path.
</p>

<p align="center">
  <a href="https://ibl.ai/ontology"><img src="https://img.shields.io/badge/website-ibl.ai%2Fontology-1f6feb" alt="Website"></a>
  <a href="./docs/configuration.md"><img src="https://img.shields.io/badge/docs-configuration-2ea043" alt="Docs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.10%2B-3776ab" alt="Python">
  <img src="https://img.shields.io/badge/backends-EFS%20%7C%20NFS-ff9900" alt="Backends">
  <img src="https://img.shields.io/badge/runtimes-OpenClaw%20%7C%20NemoClaw-76b900" alt="Runtimes">
</p>

<p align="center">
  <a href="#features">Features</a> →
  <a href="#how-it-works">How it works</a> →
  <a href="#quick-start">Quick Start</a> →
  <a href="#configuration">Configuration</a> →
  <a href="#deployment">Deployment</a> →
  <a href="#resources">Resources</a>
</p>

---

## What is Ontology?

[Ontology](https://ibl.ai/ontology) is a digital twin of your organization — a navigable map that AI agents use to understand context and take action. This repository is the **storage plane** of that idea: the part that grounds agents in real, persistent files.

ibl.ai agents run behind the scenes in self-hosted **OpenClaw** and **NVIDIA NemoClaw** sandboxes (see [`iblai-claw-setup`](https://github.com/iblai/iblai-claw-setup)). Those sandboxes are ephemeral; your knowledge bases, student vaults, and working sets are not. Ontology connects the two — mounting the right filesystem, at the right path, with the right permissions, into the right sandbox — driven entirely by one declarative registry.

Think of it as a Vault for the filesystem layer: **one source of truth for what storage exists and who may touch it.**

---

## Features

- **One registry, many filesystems** — register any number of AWS EFS and classic NFS filesystems in a single config file.
- **AWS EFS, first class** — TLS in transit, EFS access points, and IAM-aware mounting via `amazon-efs-utils`, with automatic fallback to NFS 4.1 when the helper isn't present.
- **Classic NFS** — point at any `server:export`, expose a sub-folder, tune mount options.
- **Folder-scoped exposure** — publish `/knowledge` out of a filesystem, not the whole export.
- **Permission bindings** — grant a filesystem to a sandbox read-only or read-write; later rules override earlier ones so a wildcard default can be tightened per sandbox.
- **Glob targeting** — `["*"]`, `["*-research"]`, or explicit sandbox ids decide who gets what.
- **POSIX ownership** — set `uid`/`gid` per mount for correct file ownership inside the sandbox.
- **Agent-facing manifest** — emit the JSON map an agent reads at startup to know exactly which filesystems it owns and whether each is writable.
- **systemd `.mount` units** — render boot-persistent, network-ordered mounts for long-lived sandbox hosts.
- **Docker / init-container ready** — provision mounts in an init container and share them with the claw process.
- **Secrets via env** — `${EFS_VAULT_ID}` style interpolation keeps IDs and hostnames out of git.
- **Dry-run everything** — `plan` shows the exact `mount` commands before anything changes.
- **Zero runtime dependencies** — pure-Python core; PyYAML only needed for YAML configs (JSON works without it).

---

## Available on

| Backend / Runtime          | Status                                              |
|----------------------------|-----------------------------------------------------|
| **AWS EFS**                | Supported — TLS, access points, NFS 4.1 fallback    |
| **Classic NFS (v4.1)**     | Supported — any `server:export`                     |
| **OpenClaw sandboxes**     | Supported — see [`iblai-claw-setup`](https://github.com/iblai/iblai-claw-setup) |
| **NVIDIA NemoClaw**        | Supported                                           |
| **Docker / Compose**       | Supported — init-container pattern, see `examples/`  |
| **systemd hosts**          | Supported — `ontology systemd` renders `.mount` units |
| Azure Files / GCP Filestore | On the roadmap (both speak NFS today via the `nfs` backend) |

---

## How it works

```
            ibl.ai platform  (chat, mentors, skills)
                       │
                       ▼
         OpenClaw / NemoClaw gateway  (systemd)
                       │ spawns
                       ▼
   ┌──────────────── sandbox ─────────────────┐
   │  agent reads /mnt/manifest.json           │
   │  agent reads /mnt/knowledge   (ro)         │
   │  agent writes /mnt/vault      (rw)         │
   └───────────────────┬───────────────────────┘
                       │ mounts provisioned by
                       ▼
                ┌─────────────┐   ontology.yaml
                │  Ontology   │ ◀── filesystems + permissions
                └──────┬──────┘
            ┌──────────┴──────────┐
            ▼                     ▼
       AWS EFS (TLS)        classic NFS
```

Three primitives drive everything — `filesystems` (what storage exists),
`permissions` (who may mount it, where, how), and `sandboxes` (the consumers).
See [docs/architecture.md](./docs/architecture.md) for the full picture.

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/iblai/ontology.git
cd ontology
pip install -e ".[yaml]"

# 2. Describe your filesystems
cp config/ontology.example.yaml /etc/ontology/ontology.yaml
export EFS_KNOWLEDGE_ID=fs-0123456789abcdef0      # referenced as ${EFS_KNOWLEDGE_ID}

# 3. Validate the registry
ontology validate

# 4. See what a sandbox would mount — no changes made
ontology plan --sandbox openclaw-prod

# 5. Mount everything that sandbox is permitted (run as root, on the sandbox host)
sudo ontology mount --sandbox openclaw-prod

# 6. Hand the agent its world model
ontology manifest --sandbox openclaw-prod > /mnt/manifest.json
```

**Command reference**

| Command                          | What it does                                        |
|----------------------------------|-----------------------------------------------------|
| `ontology validate`              | Validate the registry config                        |
| `ontology list`                  | List all filesystems and permission bindings        |
| `ontology plan --sandbox ID`     | Show the exact mounts/commands, change nothing      |
| `ontology mount --sandbox ID`    | Mount every filesystem the sandbox is permitted     |
| `ontology unmount --sandbox ID`  | Unmount them                                         |
| `ontology status --sandbox ID`   | Show which mounts are currently live                |
| `ontology manifest --sandbox ID` | Emit the JSON manifest the agent reads              |
| `ontology systemd --sandbox ID`  | Render systemd `.mount` units (`-o DIR` to write)   |

Set the config path once with `ONTOLOGY_CONFIG=/path/to/ontology.yaml`, or pass `-c` per command. Add `-v` to print the underlying `mount` commands.

---

## Configuration

A registry is one YAML (or JSON) file with three sections. Full reference in
[docs/configuration.md](./docs/configuration.md).

```yaml
version: "1"

filesystems:
  - id: shared-knowledge          # an AWS EFS filesystem, exposing one folder
    name: "Shared Knowledge Base"
    type: efs
    file_system_id: ${EFS_KNOWLEDGE_ID}
    region: us-east-1
    transit_encryption: true
    root: /knowledge

  - id: scratch                   # a classic NFS server
    name: "Scratch / Working Set"
    type: nfs
    server: nfs.internal.ibl.ai
    export: /exports/scratch

permissions:
  - filesystem: shared-knowledge  # every sandbox, read-only
    mount_path: /mnt/knowledge
    access: ro
    sandboxes: ["*"]

  - filesystem: scratch           # only research sandboxes, read-write
    mount_path: /mnt/scratch
    access: rw
    sandboxes: ["*-research"]

sandboxes:
  - id: openclaw-prod
    runtime: openclaw
  - id: nemoclaw-research
    runtime: nemoclaw
```

- **`${VAR}`** tokens are expanded from the environment at load time — keep EFS IDs and hostnames out of git.
- **Last write wins** on a `mount_path`, so a `["*"]` default can be overridden by a sandbox-specific grant later in the file.
- **`access`** is `ro` (default) or `rw`; set `uid`/`gid` to own the mountpoint inside the sandbox.

---

## Deployment

### → Into an existing claw sandbox host (systemd)

For long-lived hosts, let systemd own the mounts so they survive reboots and
order correctly after the network:

```bash
sudo ontology systemd --sandbox openclaw-prod -o /etc/systemd/system
sudo systemctl daemon-reload
sudo systemctl enable --now mnt-knowledge.mount mnt-vault.mount
```

### → As a Docker init container

The [`examples/docker-compose.yml`](./examples/docker-compose.yml) pattern runs
a privileged `ontology-mount` container that provisions the mounts and shares
them with the claw container, then writes the manifest the agent reads:

```bash
EFS_KNOWLEDGE_ID=fs-0abc... docker compose -f examples/docker-compose.yml up
```

### → Alongside iblai-claw-setup

Ontology is the storage companion to
[`iblai-claw-setup`](https://github.com/iblai/iblai-claw-setup). Install the
claw gateway as that repo describes, then run `ontology mount` (or enable the
systemd units) on the same host before the gateway starts spawning sandboxes.

---

## Testing

```bash
pip install -e ".[dev]"
pytest -q
```

| Suite                  | Covers                                              |
|------------------------|-----------------------------------------------------|
| `tests/test_config.py` | Parsing, validation, env expansion, JSON/YAML load  |
| `tests/test_resolve.py`| Permission resolution, mount commands, manifest, systemd |

---

## Contributing

Issues and pull requests are welcome. Keep the core dependency-free, add a test
for any new backend or resolution rule, and run `pytest` before opening a PR.

---

## Resources

- **Product** — [ibl.ai/ontology](https://ibl.ai/ontology)
- **Claw sandboxes** — [iblai/iblai-claw-setup](https://github.com/iblai/iblai-claw-setup)
- **Agent platform** — [iblai/os](https://github.com/iblai/os)
- **Architecture** — [docs/architecture.md](./docs/architecture.md)
- **Configuration reference** — [docs/configuration.md](./docs/configuration.md)

---

## License

MIT — see [LICENSE](./LICENSE).
