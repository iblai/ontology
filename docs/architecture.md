# Architecture

Ontology is the persistent-storage layer of the ibl.ai agent stack. Where
[`iblai-claw-setup`](https://github.com/iblai/iblai-claw-setup) connects a
self-hosted OpenClaw / NemoClaw gateway to the platform's control plane,
Ontology gives the sandboxes those gateways spawn a stable, governed view of
your data.

```
                ibl.ai platform (chat, mentors, skills, control plane)
                                     │  WebSocket + Ed25519 signing
                                     ▼
                      OpenClaw / NemoClaw gateway  (systemd)
                                     │  spawns
                                     ▼
   ┌─────────────────────────── sandbox ───────────────────────────┐
   │  agent process                                                 │
   │     reads  /mnt/manifest.json   ← "what filesystems do I have?" │
   │     reads  /mnt/knowledge  (ro)                                 │
   │     writes /mnt/vault      (rw)                                 │
   └───────────────────────────┬───────────────────────────────────┘
                               │ mounts provisioned by
                               ▼
                        ┌──────────────┐
                        │  Ontology    │  reads ontology.yaml
                        │  registry    │  resolves permissions
                        └──────┬───────┘  drives mounters
                  ┌────────────┼────────────┐
                  ▼                          ▼
            AWS EFS (NFS 4.1 + TLS)    classic NFS server
```

## The three primitives

| Primitive    | Answers                                        |
|--------------|------------------------------------------------|
| `Filesystem` | *What* backing store exists, and which folder of it to expose |
| `Permission` | *Who* (which sandboxes) may mount it, *where*, and *how* (ro/rw) |
| `Sandbox`    | *Which* OpenClaw / NemoClaw instance is consuming storage |

`Registry.resolve(sandbox_id)` walks the permissions in declaration order,
keeps the ones whose `sandboxes` glob matches, and produces a list of `Mount`
specs. Later rules override earlier ones on the same `mount_path`, so a
`["*"]` default can be tightened for a specific sandbox.

## Mounters

A `Mount` is backend-agnostic; the mounter chooses how to realise it:

- **EFS** — if `amazon-efs-utils` is present, `mount -t efs -o tls` (and
  `accesspoint=…` when set). Otherwise it falls back to mounting the EFS DNS
  name over NFS 4.1 — the same wire protocol, no helper required.
- **NFS** — `mount -t nfs4` against `server:export/root`.

For long-lived sandbox hosts, `ontology systemd` renders `.mount` units instead
of mounting imperatively, so systemd owns remount-on-boot and network ordering.

## The manifest — Ontology as the agent's world model

`ontology manifest --sandbox ID` emits the JSON an agent reads at startup. This
is the through-line to the [Ontology product](https://ibl.ai/ontology): the
agent does not guess at paths or credentials — it is handed a typed map of the
filesystems it owns, each with an explicit read/write boundary. The registry is
the semantic layer; the mounts are the kinetic layer that makes it real.
