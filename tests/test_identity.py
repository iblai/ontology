"""Unit tests for identity & permissions (Option A) — no network, no Django DB."""

from __future__ import annotations

import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from iblai_ontology.backend.identity.entra import (
    EntraTokenError,
    EntraValidator,
)
from iblai_ontology.backend.identity.roles import RoleResolver, resolve_permissions

TENANT = "test-tenant"
CLIENT = "test-client"


# --- Entra validation (with an in-memory RSA key as a fake JWKS) -----------
@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJWKSClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):
        class _K:
            key = self._public_key

        return _K()


def _make_token(rsa_key, **overrides):
    now = dt.datetime.now(tz=dt.timezone.utc)
    claims = {
        "aud": f"api://{CLIENT}",
        "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
        "sub": "subject-1",
        "oid": "oid-abc",
        "preferred_username": "jdoe@alasu.edu",
        "name": "Jane Doe",
        "roles": ["FinancialAidCounselor"],
        "jti": "tok-1",
        "iat": now,
        "exp": now + dt.timedelta(hours=1),
    }
    claims.update(overrides)
    return jwt.encode(claims, rsa_key, algorithm="RS256")


def _validator(rsa_key):
    pub = rsa_key.public_key()
    return EntraValidator(TENANT, CLIENT, jwks_client=FakeJWKSClient(pub))


def test_valid_token(rsa_key):
    token = _make_token(rsa_key)
    identity = _validator(rsa_key).validate(token)
    assert identity.user_id == "oid-abc"
    assert identity.email == "jdoe@alasu.edu"
    assert identity.token_jti == "tok-1"


def test_expired_token_rejected(rsa_key):
    now = dt.datetime.now(tz=dt.timezone.utc)
    token = _make_token(rsa_key, exp=now - dt.timedelta(hours=1))
    with pytest.raises(EntraTokenError):
        _validator(rsa_key).validate(token)


def test_wrong_audience_rejected(rsa_key):
    token = _make_token(rsa_key, aud="api://someone-else")
    with pytest.raises(EntraTokenError):
        _validator(rsa_key).validate(token)


def test_validator_requires_tenant_and_client():
    with pytest.raises(ValueError):
        EntraValidator("", "")


# --- Role resolution ------------------------------------------------------
@pytest.fixture()
def resolver(tmp_path, monkeypatch):
    # Merge the baseline roles.yaml with the higher-ed sample roles so these
    # tests can exercise higher-ed semantics (Student EMPLID, financial-aid-tools).
    import yaml
    from pathlib import Path

    cfg = tmp_path / "config"
    cfg.mkdir()
    merged: dict = {"roles": {}}
    for name in ("config/roles.yaml", "config/roles.higher-ed.example.yaml"):
        data = yaml.safe_load(Path(name).read_text()) or {}
        merged["roles"].update(data.get("roles", {}))
    (cfg / "roles.yaml").write_text(yaml.safe_dump(merged))
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    return RoleResolver()


def test_resolve_known_role(resolver):
    perms = resolver.resolve("FinancialAidCounselor")
    assert perms.display_name == "Financial Aid Counselor"
    assert perms.allows_toolset("financial-aid-tools")
    assert perms.allows_cache_table("financial_aid")
    assert not perms.allows_cache_table("buildings")


def test_unknown_role_falls_back_to_default(resolver):
    perms = resolver.resolve("NoSuchRole")
    assert perms.role == "default"
    assert perms.mcp_toolsets == []


def test_executive_wildcards(resolver):
    perms = resolver.resolve("Executive")
    assert perms.allows_toolset("anything")
    assert perms.allows_cache_table("any_table")
    assert perms.allows_memory_path("/ontology/students/by-id/1.md")


def test_student_emplid_substitution(resolver):
    perms = resolver.resolve("Student", user_emplid="001234567")
    assert "/ontology/students/by-id/001234567.md" in perms.memory_paths
    assert perms.allows_memory_path("/ontology/students/by-id/001234567.md")
    assert not perms.allows_memory_path("/ontology/students/by-id/999.md")


def test_convenience_wrapper(resolver):
    perms = resolve_permissions("Registrar")
    assert perms.allows_cache_table("anything")  # Registrar has "*"
