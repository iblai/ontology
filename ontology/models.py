"""Core domain model for the Ontology filesystem registry.

The registry has three kinds of entries:

* ``Filesystem`` — a backing store (AWS EFS or classic NFS) plus the folder
  path (``root``) within it that should be exposed.
* ``Permission`` — a binding that grants one or more sandboxes the right to
  mount a filesystem at a path, read-only or read-write.
* ``Sandbox`` — an OpenClaw / NemoClaw instance that consumes filesystems.

``Registry.resolve`` turns these into concrete ``Mount`` specs for a sandbox.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from fnmatch import fnmatch
from typing import Optional


class FilesystemType(str, Enum):
    EFS = "efs"
    NFS = "nfs"


class AccessMode(str, Enum):
    RO = "ro"
    RW = "rw"


@dataclass
class Filesystem:
    """A registered backing store.

    For ``type: efs`` set ``file_system_id`` and ``region`` (and optionally
    ``access_point``). For ``type: nfs`` set ``server`` and ``export``.
    ``root`` is the folder *inside* the export to expose (default ``/``).
    """

    id: str
    type: FilesystemType
    name: str = ""
    root: str = "/"
    options: list[str] = field(default_factory=list)

    # EFS
    file_system_id: Optional[str] = None
    region: Optional[str] = None
    access_point: Optional[str] = None
    transit_encryption: bool = True

    # NFS
    server: Optional[str] = None
    export: Optional[str] = None

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not self.id:
            errors.append("filesystem is missing an 'id'")
        if not self.root.startswith("/"):
            errors.append(f"[{self.id}] 'root' must be an absolute path, got {self.root!r}")
        if self.type is FilesystemType.EFS:
            if not self.file_system_id:
                errors.append(f"[{self.id}] efs filesystem requires 'file_system_id'")
            if not self.region:
                errors.append(f"[{self.id}] efs filesystem requires 'region'")
        elif self.type is FilesystemType.NFS:
            if not self.server:
                errors.append(f"[{self.id}] nfs filesystem requires 'server'")
            if not self.export:
                errors.append(f"[{self.id}] nfs filesystem requires 'export'")
        return errors

    @property
    def remote_path(self) -> str:
        """The path component of the mount source, after the colon."""
        if self.type is FilesystemType.EFS:
            # amazon-efs-utils takes the in-filesystem path; access points
            # already pin a root, so we hand it "/" in that case.
            if self.access_point:
                return "/"
            return self.root
        # NFS: join the export with the requested sub-folder.
        export = self.export.rstrip("/") if self.export else ""
        sub = self.root.strip("/")
        return f"{export}/{sub}".rstrip("/") or "/"


@dataclass
class Permission:
    """Grants ``sandboxes`` the right to mount ``filesystem`` at ``mount_path``."""

    filesystem: str
    mount_path: str
    access: AccessMode = AccessMode.RO
    sandboxes: list[str] = field(default_factory=lambda: ["*"])
    uid: Optional[int] = None
    gid: Optional[int] = None

    def validate(self, known_filesystems: set[str]) -> list[str]:
        errors: list[str] = []
        if self.filesystem not in known_filesystems:
            errors.append(
                f"permission references unknown filesystem {self.filesystem!r}"
            )
        if not self.mount_path.startswith("/"):
            errors.append(
                f"[{self.filesystem}] 'mount_path' must be absolute, got {self.mount_path!r}"
            )
        return errors

    def grants(self, sandbox_id: str) -> bool:
        return any(fnmatch(sandbox_id, pattern) for pattern in self.sandboxes)


@dataclass
class Sandbox:
    """An OpenClaw / NemoClaw instance that consumes filesystems."""

    id: str
    runtime: str = "openclaw"  # openclaw | nemoclaw
    description: str = ""


@dataclass
class Mount:
    """A fully resolved mount, ready to hand to a mounter driver."""

    filesystem: Filesystem
    mount_path: str
    access: AccessMode
    uid: Optional[int] = None
    gid: Optional[int] = None

    @property
    def read_only(self) -> bool:
        return self.access is AccessMode.RO


@dataclass
class Registry:
    version: str
    filesystems: list[Filesystem] = field(default_factory=list)
    permissions: list[Permission] = field(default_factory=list)
    sandboxes: list[Sandbox] = field(default_factory=list)

    def filesystem(self, fs_id: str) -> Optional[Filesystem]:
        return next((f for f in self.filesystems if f.id == fs_id), None)

    def sandbox(self, sandbox_id: str) -> Optional[Sandbox]:
        return next((s for s in self.sandboxes if s.id == sandbox_id), None)

    def validate(self) -> list[str]:
        errors: list[str] = []
        seen: set[str] = set()
        for fs in self.filesystems:
            if fs.id in seen:
                errors.append(f"duplicate filesystem id {fs.id!r}")
            seen.add(fs.id)
            errors.extend(fs.validate())
        for perm in self.permissions:
            errors.extend(perm.validate(seen))
        return errors

    def resolve(self, sandbox_id: str) -> list[Mount]:
        """Every mount that ``sandbox_id`` is permitted, in declaration order.

        Later permissions win when two target the same ``mount_path``, so a
        sandbox-specific grant can override a wildcard default.
        """
        resolved: dict[str, Mount] = {}
        for perm in self.permissions:
            if not perm.grants(sandbox_id):
                continue
            fs = self.filesystem(perm.filesystem)
            if fs is None:
                continue
            resolved[perm.mount_path] = Mount(
                filesystem=fs,
                mount_path=perm.mount_path,
                access=perm.access,
                uid=perm.uid,
                gid=perm.gid,
            )
        return list(resolved.values())
