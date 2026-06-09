import json
import os

import pytest

from ontology import load_registry
from ontology.config import ConfigError, parse_registry
from ontology.models import AccessMode, FilesystemType


BASE = {
    "version": "1",
    "filesystems": [
        {"id": "kb", "type": "efs", "file_system_id": "fs-1", "region": "us-east-1",
         "root": "/knowledge"},
        {"id": "scratch", "type": "nfs", "server": "nfs.local", "export": "/exports/scratch"},
    ],
    "permissions": [
        {"filesystem": "kb", "mount_path": "/mnt/kb", "access": "ro", "sandboxes": ["*"]},
        {"filesystem": "scratch", "mount_path": "/mnt/scratch", "access": "rw",
         "sandboxes": ["*-research"]},
    ],
    "sandboxes": [{"id": "box-research", "runtime": "nemoclaw"}],
}


def test_parse_valid_registry():
    reg = parse_registry(BASE)
    assert len(reg.filesystems) == 2
    assert reg.filesystem("kb").type is FilesystemType.EFS
    assert reg.filesystem("kb").remote_path == "/knowledge"


def test_nfs_remote_path_joins_export_and_root():
    reg = parse_registry({**BASE, "filesystems": [
        {"id": "s", "type": "nfs", "server": "h", "export": "/exports/scratch", "root": "/sub"},
    ], "permissions": []})
    assert reg.filesystem("s").remote_path == "/exports/scratch/sub"


def test_efs_missing_required_field_fails():
    with pytest.raises(ConfigError) as exc:
        parse_registry({"version": "1", "filesystems": [
            {"id": "bad", "type": "efs", "region": "us-east-1"}]})
    assert "file_system_id" in str(exc.value)


def test_unknown_filesystem_in_permission_fails():
    with pytest.raises(ConfigError) as exc:
        parse_registry({"version": "1",
                        "permissions": [{"filesystem": "ghost", "mount_path": "/mnt/x"}]})
    assert "ghost" in str(exc.value)


def test_unknown_type_fails():
    with pytest.raises(ConfigError):
        parse_registry({"version": "1", "filesystems": [{"id": "x", "type": "smb"}]})


def test_env_expansion():
    os.environ["TEST_FS_ID"] = "fs-expanded"
    reg = parse_registry({"version": "1", "filesystems": [
        {"id": "k", "type": "efs", "file_system_id": "${TEST_FS_ID}", "region": "us-east-1"}]})
    assert reg.filesystem("k").file_system_id == "fs-expanded"


def test_load_json_file(tmp_path):
    p = tmp_path / "reg.json"
    p.write_text(json.dumps(BASE))
    reg = load_registry(p)
    assert reg.version == "1"


def test_access_mode_default_is_ro():
    reg = parse_registry({"version": "1",
                          "filesystems": [{"id": "k", "type": "nfs", "server": "h", "export": "/e"}],
                          "permissions": [{"filesystem": "k", "mount_path": "/mnt/k"}]})
    assert reg.permissions[0].access is AccessMode.RO
