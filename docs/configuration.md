# Configuration reference

A registry is a single YAML (or JSON) document with three sections:
`filesystems`, `permissions`, and optional `sandboxes`. By default the CLI
reads `/etc/ontology/ontology.yaml`; override with `-c/--config` or the
`ONTOLOGY_CONFIG` environment variable.

Any `${VAR}` token is replaced with the value of that environment variable at
load time, so EFS IDs and NFS hostnames can stay out of version control.

---

## `filesystems[]`

A backing store plus the folder within it to expose.

| Key                  | Type    | Applies to | Description |
|----------------------|---------|-----------|-------------|
| `id`                 | string  | both      | Unique identifier, referenced by permissions |
| `type`               | enum    | both      | `efs` or `nfs` |
| `name`               | string  | both      | Human label (shown in `list` / manifest) |
| `root`               | path    | both      | Folder inside the store to expose (default `/`) |
| `options`            | list    | both      | Extra `mount -o` options, appended verbatim |
| `file_system_id`     | string  | efs       | **Required for EFS.** e.g. `fs-0123456789abcdef0` |
| `region`             | string  | efs       | **Required for EFS.** e.g. `us-east-1` |
| `access_point`       | string  | efs       | Optional EFS access point (`fsap-…`); pins root + POSIX identity |
| `transit_encryption` | bool    | efs       | Mount with TLS (default `true`) |
| `server`             | host    | nfs       | **Required for NFS.** NFS server hostname/IP |
| `export`             | path    | nfs       | **Required for NFS.** Exported path on the server |

> When an EFS `access_point` is set, the access point already pins a root
> directory, so `root` is ignored for that filesystem.

## `permissions[]`

Binds filesystems to sandboxes. Evaluated top-to-bottom; the last rule to
target a given `mount_path` wins.

| Key          | Type    | Default  | Description |
|--------------|---------|----------|-------------|
| `filesystem` | string  | —        | **Required.** A `filesystems[].id` |
| `mount_path` | path    | —        | **Required.** Absolute path inside the sandbox |
| `access`     | enum    | `ro`     | `ro` (read-only) or `rw` (read-write) |
| `sandboxes`  | list    | `["*"]`  | Sandbox ids or globs (`*`, `*-research`) that this grant applies to |
| `uid`        | int     | —        | `chown` the mountpoint to this uid after mounting |
| `gid`        | int     | —        | `chown` the mountpoint to this gid after mounting |

## `sandboxes[]`

Optional metadata about the consumers. Ids referenced in permissions need not
be declared here, but declaring them populates the manifest's `runtime` field.

| Key           | Type   | Default    | Description |
|---------------|--------|------------|-------------|
| `id`          | string | —          | Sandbox identifier |
| `runtime`     | string | `openclaw` | `openclaw` or `nemoclaw` |
| `description` | string | `""`       | Free-text label |

---

## Worked example

```yaml
version: "1"
filesystems:
  - id: shared-knowledge
    type: efs
    file_system_id: ${EFS_KNOWLEDGE_ID}
    region: us-east-1
    root: /knowledge
permissions:
  - filesystem: shared-knowledge
    mount_path: /mnt/knowledge
    access: ro
    sandboxes: ["*"]
```

```console
$ ontology -c registry.yaml validate
ok: registry.yaml is valid (1 filesystems, 1 permissions, 0 sandboxes)

$ ontology -c registry.yaml plan --sandbox openclaw-prod
[~] /mnt/knowledge           dry-run
```
