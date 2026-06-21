"""Fernet encryption for service connection credentials at rest."""

from __future__ import annotations

import json
from typing import Any

from django.conf import settings


def _fernet():
    key = settings.CREDENTIAL_ENCRYPTION_KEY
    if not key:
        raise RuntimeError(
            "ONTOLOGY_CREDENTIAL_KEY is not set. Generate one with:\n"
            "    python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    from cryptography.fernet import Fernet

    return Fernet(key if isinstance(key, bytes) else key.encode())


def encrypt_connection_config(config: dict[str, Any]) -> bytes:
    """Encrypt a connection-config dict to bytes for storage."""
    return _fernet().encrypt(json.dumps(config).encode())


def decrypt_connection_config(blob: bytes) -> dict[str, Any]:
    """Decrypt stored bytes back into a connection-config dict."""
    if blob is None:
        return {}
    raw = bytes(blob)
    return json.loads(_fernet().decrypt(raw).decode())
