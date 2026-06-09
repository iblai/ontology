from ontology.config import parse_registry
from ontology.mounter import build_command, mount_unit
from ontology.models import AccessMode
from ontology.registry import RegistryService


REG = {
    "version": "1",
    "filesystems": [
        {"id": "kb", "type": "efs", "file_system_id": "fs-1", "region": "us-east-1",
         "root": "/knowledge"},
        {"id": "vault", "type": "efs", "file_system_id": "fs-2", "region": "us-east-1",
         "access_point": "fsap-9"},
        {"id": "scratch", "type": "nfs", "server": "nfs.local", "export": "/exports/scratch"},
    ],
    "permissions": [
        {"filesystem": "kb", "mount_path": "/mnt/kb", "access": "ro", "sandboxes": ["*"]},
        {"filesystem": "vault", "mount_path": "/mnt/vault", "access": "rw",
         "sandboxes": ["openclaw-prod"]},
        {"filesystem": "scratch", "mount_path": "/mnt/scratch", "access": "rw",
         "sandboxes": ["*-research"]},
    ],
    "sandboxes": [{"id": "openclaw-prod", "runtime": "openclaw"}],
}


def svc():
    return RegistryService(parse_registry(REG))


def test_wildcard_grant_reaches_every_sandbox():
    mounts = svc().mounts_for("anything")
    assert [m.filesystem.id for m in mounts] == ["kb"]


def test_specific_sandbox_gets_extra_grants():
    ids = [m.filesystem.id for m in svc().mounts_for("openclaw-prod")]
    assert ids == ["kb", "vault"]


def test_glob_pattern_grant():
    ids = [m.filesystem.id for m in svc().mounts_for("box-research")]
    assert "scratch" in ids


def test_manifest_shape():
    manifest = svc().manifest_for("openclaw-prod")
    assert manifest["sandbox"] == "openclaw-prod"
    vault = next(f for f in manifest["filesystems"] if f["id"] == "vault")
    assert vault["writable"] is True
    assert vault["mount_path"] == "/mnt/vault"


def test_build_command_nfs():
    mounts = svc().mounts_for("box-research")
    scratch = next(m for m in mounts if m.filesystem.id == "scratch")
    cmd = build_command(scratch)
    assert cmd[0:3] == ["mount", "-t", "nfs4"]
    assert "nfs.local:/exports/scratch" in cmd[-2]
    assert cmd[-1] == "/mnt/scratch"


def test_build_command_efs_falls_back_to_nfs_without_utils():
    # In CI there's no mount.efs binary, so EFS resolves to its NFS DNS form.
    mounts = svc().mounts_for("openclaw-prod")
    kb = next(m for m in mounts if m.filesystem.id == "kb")
    cmd = build_command(kb)
    assert "fs-1.efs.us-east-1.amazonaws.com:/knowledge" in cmd[-2]
    assert "ro" in cmd[4]


def test_force_nfs_on_efs():
    kb = next(m for m in svc().mounts_for("openclaw-prod") if m.filesystem.id == "kb")
    cmd = build_command(kb, force_nfs=True)
    assert cmd[1:3] == ["-t", "nfs4"]


def test_systemd_unit_render():
    units = svc().systemd_units("openclaw-prod")
    assert "mnt-vault.mount" in units
    assert "Type=nfs4" in units["mnt-vault.mount"]
    assert "rw" in units["mnt-vault.mount"]
