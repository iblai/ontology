"""High-level service that ties config, permissions and mounters together."""

from __future__ import annotations

from pathlib import Path

from . import mounter
from .config import load_registry
from .models import Mount, Registry


class RegistryService:
    """Operate on a registry: plan, mount, unmount and export sandbox views."""

    def __init__(self, registry: Registry):
        self.registry = registry

    @classmethod
    def from_file(cls, path: str | Path) -> "RegistryService":
        return cls(load_registry(path))

    # -- introspection -----------------------------------------------------
    def mounts_for(self, sandbox_id: str) -> list[Mount]:
        return self.registry.resolve(sandbox_id)

    def manifest_for(self, sandbox_id: str) -> dict:
        """A JSON-serialisable view a claw sandbox can read to know its world.

        This is the "ontology" the agent sees: which filesystems exist, where
        they are mounted, and whether they are writable.
        """
        sandbox = self.registry.sandbox(sandbox_id)
        return {
            "sandbox": sandbox_id,
            "runtime": sandbox.runtime if sandbox else "unknown",
            "filesystems": [
                {
                    "id": m.filesystem.id,
                    "name": m.filesystem.name or m.filesystem.id,
                    "type": m.filesystem.type.value,
                    "mount_path": m.mount_path,
                    "access": m.access.value,
                    "writable": not m.read_only,
                }
                for m in self.mounts_for(sandbox_id)
            ],
        }

    # -- actions -----------------------------------------------------------
    def mount_all(self, sandbox_id: str, *, dry_run: bool = False,
                  force_nfs: bool = False) -> list[mounter.MountResult]:
        return [
            mounter.apply(m, dry_run=dry_run, force_nfs=force_nfs)
            for m in self.mounts_for(sandbox_id)
        ]

    def unmount_all(self, sandbox_id: str, *, dry_run: bool = False) -> list[mounter.MountResult]:
        return [
            mounter.unmount(m.mount_path, dry_run=dry_run)
            for m in self.mounts_for(sandbox_id)
        ]

    def systemd_units(self, sandbox_id: str) -> dict[str, str]:
        """Map of unit filename -> contents for a sandbox's mounts."""
        units: dict[str, str] = {}
        for m in self.mounts_for(sandbox_id):
            # systemd unit names escape '/' as '-'; drop the leading slash.
            name = m.mount_path.strip("/").replace("/", "-") + ".mount"
            units[name] = mounter.mount_unit(m)
        return units
