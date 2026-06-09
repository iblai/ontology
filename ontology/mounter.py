"""Mounter drivers — turn a resolved ``Mount`` into a real mount.

Two backends are supported:

* **EFS** — prefers ``amazon-efs-utils`` (``mount -t efs -o tls``), which
  handles TLS, IAM and access points. Falls back to mounting the EFS DNS name
  over NFS 4.1 when efs-utils is unavailable.
* **NFS** — a classic ``mount -t nfs4`` against ``server:export``.

Every driver can emit the command without running it (``dry_run``) so the CLI
can show a plan, and ``mount_unit`` renders an equivalent systemd ``.mount``
unit for the long-lived claw sandbox host.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

from .models import Filesystem, FilesystemType, Mount


class MountError(Exception):
    pass


def _have(binary: str) -> bool:
    return shutil.which(binary) is not None


def _access_options(mount: Mount) -> list[str]:
    return ["ro"] if mount.read_only else ["rw"]


def efs_source(fs: Filesystem) -> str:
    """``mount -t efs`` source, e.g. ``fs-0abc::fsap-0def`` or ``fs-0abc:/root``."""
    if fs.access_point:
        return f"{fs.file_system_id}::{fs.access_point}"
    return f"{fs.file_system_id}:{fs.root}"


def efs_nfs_source(fs: Filesystem) -> str:
    """Fallback NFS source for EFS: ``fs-0abc.efs.us-east-1.amazonaws.com:/``."""
    host = f"{fs.file_system_id}.efs.{fs.region}.amazonaws.com"
    return f"{host}:{fs.remote_path}"


def nfs_source(fs: Filesystem) -> str:
    return f"{fs.server}:{fs.remote_path}"


def build_command(mount: Mount, *, force_nfs: bool = False) -> list[str]:
    """Build the ``mount`` argv for a resolved mount."""
    fs = mount.filesystem
    opts = _access_options(mount)

    if fs.type is FilesystemType.EFS and not force_nfs and _have("mount.efs"):
        if fs.transit_encryption:
            opts.append("tls")
        if fs.access_point:
            opts.append(f"accesspoint={fs.access_point}")
        opts.extend(fs.options)
        return ["mount", "-t", "efs", "-o", ",".join(opts),
                efs_source(fs), mount.mount_path]

    # Generic NFS path (classic NFS, or EFS without efs-utils).
    if fs.type is FilesystemType.EFS:
        source = efs_nfs_source(fs)
        opts = ["nfsvers=4.1", "rsize=1048576", "wsize=1048576",
                "hard", "timeo=600", "retrans=2", "noresvport", *opts]
    else:
        source = nfs_source(fs)
        opts = ["nfsvers=4.1", "hard", "noresvport", *opts]
    opts.extend(fs.options)
    return ["mount", "-t", "nfs4", "-o", ",".join(opts), source, mount.mount_path]


def mount_unit(mount: Mount) -> str:
    """Render a systemd ``.mount`` unit for a long-lived sandbox host."""
    fs = mount.filesystem
    if fs.type is FilesystemType.EFS:
        what, fstype = efs_nfs_source(fs), "nfs4"
        opts = "_netdev,nfsvers=4.1,rsize=1048576,wsize=1048576,hard,noresvport"
    else:
        what, fstype = nfs_source(fs), "nfs4"
        opts = "_netdev,nfsvers=4.1,hard,noresvport"
    opts += ",ro" if mount.read_only else ",rw"
    return (
        f"# {fs.name or fs.id} -> {mount.mount_path}\n"
        "[Unit]\n"
        f"Description=Ontology mount for {fs.id}\n"
        "After=network-online.target\nWants=network-online.target\n\n"
        "[Mount]\n"
        f"What={what}\nWhere={mount.mount_path}\nType={fstype}\nOptions={opts}\n\n"
        "[Install]\nWantedBy=multi-user.target\n"
    )


@dataclass
class MountResult:
    mount: Mount
    command: list[str]
    status: str  # "mounted" | "exists" | "dry-run" | "error"
    detail: str = ""


def is_mounted(mount_path: str) -> bool:
    """Best-effort check using /proc/mounts (Linux) or ``mount`` output."""
    try:
        with open("/proc/mounts") as fh:
            return any(line.split()[1] == mount_path for line in fh if len(line.split()) > 1)
    except OSError:
        return False


def apply(mount: Mount, *, dry_run: bool = False, force_nfs: bool = False) -> MountResult:
    cmd = build_command(mount, force_nfs=force_nfs)
    if dry_run:
        return MountResult(mount, cmd, "dry-run")
    if is_mounted(mount.mount_path):
        return MountResult(mount, cmd, "exists", "already mounted")

    os.makedirs(mount.mount_path, exist_ok=True)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return MountResult(mount, cmd, "error", proc.stderr.strip())

    if mount.uid is not None or mount.gid is not None:
        try:
            os.chown(mount.mount_path, mount.uid if mount.uid is not None else -1,
                     mount.gid if mount.gid is not None else -1)
        except OSError as exc:  # non-fatal: ownership may be pinned by EFS access point
            return MountResult(mount, cmd, "mounted", f"chown skipped: {exc}")
    return MountResult(mount, cmd, "mounted")


def unmount(mount_path: str, *, dry_run: bool = False) -> MountResult:
    cmd = ["umount", mount_path]
    fake = Mount(filesystem=Filesystem(id="-", type=FilesystemType.NFS),
                 mount_path=mount_path, access=None)  # type: ignore[arg-type]
    if dry_run:
        return MountResult(fake, cmd, "dry-run")
    if not is_mounted(mount_path):
        return MountResult(fake, cmd, "exists", "not mounted")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return MountResult(fake, cmd, "error", proc.stderr.strip())
    return MountResult(fake, cmd, "mounted", "unmounted")
