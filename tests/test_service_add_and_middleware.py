"""Coverage for `service add` seed paths and the identity middleware core."""

from __future__ import annotations

import datetime as dt

import pytest
from typer.testing import CliRunner

from iblai_ontology.cli import app

runner = CliRunner()


# --- service add: API/catalog/skill seed paths (no backend needed) --------
def test_service_add_from_api_catalog_key():
    # canvas is an API catalog entry -> prints the skill seed and returns.
    r = runner.invoke(app, ["service", "add", "--name", "canvas-lms", "--from", "canvas"])
    assert r.exit_code == 0
    assert "CANVAS_API_TOKEN" in r.stdout


def test_service_add_from_skill():
    r = runner.invoke(app, ["service", "add", "--name", "jira-prod", "--skill", "jira"])
    assert r.exit_code == 0
    assert "JIRA_API_TOKEN" in r.stdout


def test_service_add_unknown_catalog():
    r = runner.invoke(app, ["service", "add", "--name", "x", "--from", "nope"])
    assert r.exit_code == 1


def test_service_add_database_path(monkeypatch):
    # peoplesoft is a database entry -> runs the discovery engine (mocked).
    calls = {}

    class FakeEngine:
        def run(self, **kw):
            calls.update(kw)

    import iblai_ontology.backend as backend

    monkeypatch.setattr(backend, "bootstrap", lambda: None)
    import iblai_ontology.backend.discovery.engine as engine_mod

    monkeypatch.setattr(engine_mod, "DiscoveryEngine", FakeEngine)

    r = runner.invoke(
        app,
        ["service", "add", "--name", "ps", "--from", "peoplesoft",
         "--service-type", "peoplesoft",
         "--host", "db.edu", "--database", "CSPRD", "--user", "ro", "--password", "p"],
    )
    assert r.exit_code == 0, r.stdout
    assert calls["service_type"] == "peoplesoft"
    assert calls["port"] == 1521  # prefilled from catalog default_port


# --- identity middleware core (Django-free) -------------------------------
def _token(rsa_key, tenant, client):
    import jwt

    now = dt.datetime.now(tz=dt.timezone.utc)
    return jwt.encode(
        {
            "aud": f"api://{client}", "iss": f"https://login.microsoftonline.com/{tenant}/v2.0",
            "sub": "s", "oid": "oid-1", "preferred_username": "u@x.edu", "name": "U",
            "roles": [], "jti": "j", "iat": now, "exp": now + dt.timedelta(hours=1),
        },
        rsa_key,
        algorithm="RS256",
    )


def test_resolve_request_and_emplid(tmp_path, monkeypatch):
    from pathlib import Path

    import yaml
    from cryptography.hazmat.primitives.asymmetric import rsa

    from iblai_ontology.backend.identity.entra import EntraValidator
    from iblai_ontology.backend.identity.middleware import resolve_request, write_audit

    cfg = tmp_path / "config"
    cfg.mkdir()
    # Merge baseline + higher-ed sample roles (this test uses the Student role).
    merged: dict = {"roles": {}}
    for name in ("config/roles.yaml", "config/roles.higher-ed.example.yaml"):
        data = yaml.safe_load(Path(name).read_text()) or {}
        merged["roles"].update(data.get("roles", {}))
    (cfg / "roles.yaml").write_text(yaml.safe_dump(merged))
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            class _K:
                key = rsa_pub

            return _K()

    rsa_pub = key.public_key()
    validator = EntraValidator("t", "c", jwks_client=FakeJWKS())
    resolved = resolve_request(
        token=_token(key, "t", "c"),
        role_header="Student",
        validator=validator,
        emplid_lookup=lambda oid: "001234567",
    )
    assert resolved.permissions.role == "Student"
    assert resolved.emplid == "001234567"
    assert "/ontology/students/by-id/001234567.md" in resolved.permissions.memory_paths
    # write_audit is best-effort and must not raise without a DB.
    write_audit(resolved, action="read", resource="/x", allowed=True)
