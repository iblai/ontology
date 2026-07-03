"""Source-system adapters. Importing this package registers all adapters."""

from __future__ import annotations

# Import side-effect modules so their @register decorators run.
from . import apis, generic, oracle  # noqa: F401,E402
from .base import BaseAdapter, get_adapter, register  # noqa: F401

__all__ = ["BaseAdapter", "get_adapter", "register"]
