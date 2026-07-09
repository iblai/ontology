"""Unit tests for JWT replay protection — no Django, no real cache, no clock."""

from __future__ import annotations

import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from iblai_ontology.backend.identity.entra import (
    EntraIdentity,
    EntraTokenError,
    EntraValidator,
)
from iblai_ontology.backend.identity.replay import ReplayGuard

NOW = 1_000_000  # fixed unix time for deterministic TTLs


class FakeCache:
    """Minimal add/get cache with first-writer-wins ``add`` semantics."""

    def __init__(self):
        self.store: dict = {}

    def add(self, key, value, ttl):  # noqa: ARG002 - ttl unused by the fake
        if key in self.store:
            return False
        self.store[key] = value
        return True

    def get(self, key, default=None):
        return self.store.get(key, default)


def _identity(jti="tok-1", exp=NOW + 3600):
    return EntraIdentity(
        user_id="oid-1",
        email="u@x.edu",
        name="U",
        roles=[],
        groups=[],
        token_jti=jti,
        token_exp=exp,
        raw_claims={},
    )


def _guard(mode, cache=None):
    return ReplayGuard(mode, cache=cache or FakeCache(), now=lambda: NOW)


# --- bind mode ------------------------------------------------------------
def test_bind_allows_reuse_from_same_ip():
    guard = _guard("bind")
    ident = _identity()
    guard.check(ident, "1.2.3.4")
    guard.check(ident, "1.2.3.4")  # legitimate reuse — must not raise


def test_bind_rejects_reuse_from_different_ip():
    guard = _guard("bind")
    ident = _identity()
    guard.check(ident, "1.2.3.4")
    with pytest.raises(EntraTokenError, match="replay"):
        guard.check(ident, "9.9.9.9")


def test_bind_isolates_distinct_jtis():
    guard = _guard("bind")
    guard.check(_identity(jti="a"), "1.1.1.1")
    guard.check(_identity(jti="b"), "2.2.2.2")  # different token, different IP: ok


# --- strict mode ----------------------------------------------------------
def test_strict_rejects_any_reuse_even_same_ip():
    guard = _guard("strict")
    ident = _identity()
    guard.check(ident, "1.2.3.4")
    with pytest.raises(EntraTokenError, match="replay"):
        guard.check(ident, "1.2.3.4")


# --- off / degenerate modes ----------------------------------------------
def test_off_mode_is_noop():
    guard = _guard("off")
    ident = _identity()
    guard.check(ident, "1.2.3.4")
    guard.check(ident, "9.9.9.9")  # no tracking at all


def test_unknown_mode_falls_back_to_off():
    guard = _guard("nonsense")
    assert guard.mode == "off"


# --- TTL / expiry edge cases ---------------------------------------------
def test_expired_token_not_stored():
    cache = FakeCache()
    guard = _guard("strict", cache=cache)
    guard.check(_identity(exp=NOW - 10), "1.2.3.4")  # already expired
    assert cache.store == {}  # nothing recorded


def test_missing_exp_uses_ttl_fallback():
    # exp=None must not crash; the entry is simply stored with the fallback TTL.
    guard = _guard("strict")
    guard.check(_identity(exp=None), "1.2.3.4")
    with pytest.raises(EntraTokenError):
        guard.check(_identity(exp=None), "1.2.3.4")


def test_missing_jti_rejected():
    guard = _guard("bind")
    with pytest.raises(EntraTokenError, match="jti"):
        guard.check(_identity(jti=None), "1.2.3.4")


def test_cache_failure_fails_open():
    class BrokenCache:
        def add(self, *a, **k):
            raise RuntimeError("cache down")

        def get(self, *a, **k):
            raise RuntimeError("cache down")

    guard = ReplayGuard("bind", cache=BrokenCache(), now=lambda: NOW)
    guard.check(_identity(), "1.2.3.4")  # must not raise — availability over check


# --- entra now requires jti ----------------------------------------------
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
        "aud": "api://c",
        "iss": "https://login.microsoftonline.com/t/v2.0",
        "sub": "s",
        "oid": "oid-1",
        "jti": "tok-1",
        "iat": now,
        "exp": now + dt.timedelta(hours=1),
    }
    claims.update(overrides)
    return jwt.encode(claims, rsa_key, algorithm="RS256")


def test_token_without_jti_rejected(rsa_key):
    validator = EntraValidator(
        "t", "c", jwks_client=FakeJWKSClient(rsa_key.public_key())
    )
    token = jwt.encode(
        {
            "aud": "api://c",
            "iss": "https://login.microsoftonline.com/t/v2.0",
            "sub": "s",
            "oid": "oid-1",
            "iat": dt.datetime.now(tz=dt.timezone.utc),
            "exp": dt.datetime.now(tz=dt.timezone.utc) + dt.timedelta(hours=1),
        },
        rsa_key,
        algorithm="RS256",
    )
    with pytest.raises(EntraTokenError):
        validator.validate(token)


def test_validate_exposes_exp(rsa_key):
    validator = EntraValidator(
        "t", "c", jwks_client=FakeJWKSClient(rsa_key.public_key())
    )
    identity = validator.validate(_make_token(rsa_key))
    assert identity.token_jti == "tok-1"
    assert isinstance(identity.token_exp, int)


# --- integration through resolve_request ----------------------------------
def test_resolve_request_blocks_replay_from_new_ip(rsa_key, tmp_path, monkeypatch):
    from pathlib import Path

    from iblai_ontology.backend.identity.middleware import resolve_request

    # Give the resolver a real roles.yaml (the first, successful resolve needs the
    # `default` role); the second call is rejected by the guard before resolution.
    (tmp_path / "roles.yaml").write_text(Path("config/roles.yaml").read_text())
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(tmp_path))
    validator = EntraValidator(
        "t", "c", jwks_client=FakeJWKSClient(rsa_key.public_key())
    )
    guard = ReplayGuard("bind", cache=FakeCache())
    token = _make_token(rsa_key)

    resolve_request(
        token=token,
        role_header=None,
        validator=validator,
        emplid_lookup=lambda oid: None,
        replay_guard=guard,
        client_ip="1.2.3.4",
    )
    with pytest.raises(EntraTokenError):
        resolve_request(
            token=token,
            role_header=None,
            validator=validator,
            emplid_lookup=lambda oid: None,
            replay_guard=guard,
            client_ip="9.9.9.9",
        )
