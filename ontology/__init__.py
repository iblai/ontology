"""Ontology — the filesystem registry that grounds ibl.ai agent sandboxes.

Ontology connects self-hosted OpenClaw / NVIDIA NemoClaw sandboxes to
persistent storage — AWS EFS or classic NFS — through a single, declarative
registry. One config file describes every filesystem, the folder it exposes,
and exactly which sandboxes may mount it and with what permissions.
"""

from .models import (
    AccessMode,
    Filesystem,
    FilesystemType,
    Mount,
    Permission,
    Registry,
    Sandbox,
)
from .config import ConfigError, load_registry
from .registry import RegistryService

__all__ = [
    "AccessMode",
    "Filesystem",
    "FilesystemType",
    "Mount",
    "Permission",
    "Registry",
    "Sandbox",
    "ConfigError",
    "load_registry",
    "RegistryService",
]

__version__ = "0.1.0"
