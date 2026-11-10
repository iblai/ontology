"""Shared pytest fixtures for the iblai-ontology test suite."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def temp_config_dir(tmp_path, monkeypatch):
    """An isolated config dir seeded with the repo's canonical roles.yaml."""
    cfg = tmp_path / "config"
    cfg.mkdir()
    roles = REPO_ROOT / "config" / "roles.yaml"
    if roles.exists():
        shutil.copy(roles, cfg / "roles.yaml")
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    return cfg


@pytest.fixture(autouse=True)
def _no_example_roles(monkeypatch):
    """A console request writes a new platform's example roles: never from a test that did not ask."""
    try:
        from iblai_ontology.backend.identity import role_source
    except ImportError:  # the backend extra is not installed
        return
    monkeypatch.setattr(role_source, "_seed_asked", True)


@pytest.fixture()
def repo_config_dir(monkeypatch):
    """Point the config layer at the repo's real config/ directory."""
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(REPO_ROOT / "config"))
    return REPO_ROOT / "config"


class FakeDm:
    """The ibl.ai platform as the ontology calls it, in memory: the ontology records,
    the RBAC roles and their policies, with the answers the DM's own tests pin down."""

    ORG = "acme"
    RESERVED = {"Students", "Tenant Admin"}  # the DM keeps its internal role names

    def __init__(self):
        self.records: dict[tuple[str, str], dict] = {}  # (kind, key) -> record
        self.roles: list[dict] = []
        self.policies: list[dict] = []  # each names its role by ``role_id``
        self.calls: list = []  # every httpx.Request, in order
        self.down = None  # a (status, body) to answer every call with
        self.refuse_policy = None  # a (status, body) to answer every policy write with
        self.platform = self.ORG  # the platform the credential belongs to

    def sent(self, method: str | None = None) -> list[tuple[str, str]]:
        """The (method, path) of each call, or the paths of one method's calls."""
        seen = [(r.method, r.url.path) for r in self.calls]
        return [path for m, path in seen if m == method] if method else seen

    def __call__(self, request):
        import httpx

        self.calls.append(request)
        if self.down is not None:
            return httpx.Response(self.down[0], json=self.down[1])
        assert request.headers["authorization"] == "Api-Token key"
        body = json.loads(request.content) if request.content else None
        parts = request.url.path.strip("/").split("/")
        if parts[:3] == ["v1", "ontology", "kinds"] and parts[4] == "records":
            assert request.headers["iblai-org"] == self.ORG
            answer = self._records(request, parts[3], (parts[5:] or [None])[0], body)
        elif parts[:4] == ["api", "core", "rbac", "roles"]:
            answer = self._roles(request, (parts[4:] or [None])[0], body)
        elif parts[:4] == ["api", "core", "rbac", "policies"]:
            answer = self._policies(request, (parts[4:] or [None])[0], body)
        else:
            answer = 404, {"detail": "Not found."}
        return httpx.Response(answer[0], json=answer[1])

    # -- v1/ontology/kinds/<kind>/records[/<key>] --------------------------------

    @staticmethod
    def _out(key: str, record: dict) -> dict:
        return {"key": key, "created_at": None, "updated_at": None, **record}

    @staticmethod
    def _matches(data: dict, where: dict) -> bool:
        for name, match in where.items():
            value = data.get(name)
            if isinstance(match, list):
                if value not in match:
                    return False
            elif value != match:  # None matches a null and a missing field alike
                return False
        return True

    def _records(self, request, kind, key, body):
        params = request.url.params
        rows = {k: r for (knd, k), r in self.records.items() if knd == kind}
        if key is not None:
            if request.method == "PUT":
                created = key not in rows
                self.records[kind, key] = {"unique_key": None, **body}
                return (201 if created else 200), self._out(
                    key, self.records[kind, key]
                )
            if key not in rows:
                return 404, {"detail": "Not found."}
            if request.method == "DELETE":
                del self.records[kind, key]
                return 204, None
            if request.method == "PATCH":
                rows[key]["data"] = {**rows[key]["data"], **body.get("data", {})}
                if "unique_key" in body:
                    rows[key]["unique_key"] = body["unique_key"]
            return 200, self._out(key, rows[key])
        if request.method == "POST":
            items = body if isinstance(body, list) else [body]
            keys = [item["key"] for item in items]
            if len(set(keys)) < len(keys) or set(keys) & set(rows):
                return 409, {"error": "A record of this kind already has that key"}
            for item in items:
                self.records[kind, item["key"]] = {
                    "unique_key": item.get("unique_key"),
                    "data": item["data"],
                }
            return 201, {"created": len(items)}
        where = body["where"] if request.method == "DELETE" else params.get("where")
        where = json.loads(where) if isinstance(where, str) else where or {}
        found = [
            self._out(k, r)
            for k, r in sorted(rows.items())
            if self._matches(r["data"], where)
        ]
        if request.method == "DELETE":
            for record in found:
                del self.records[kind, record["key"]]
            return 200, {"deleted": len(found)}
        for name in reversed([n for n in params.get("order", "").split(",") if n]):
            field = name.lstrip("-")
            have = [r for r in found if r["data"].get(field) is not None]
            lack = [r for r in found if r["data"].get(field) is None]
            have.sort(key=lambda r: r["data"][field], reverse=name.startswith("-"))
            found = have + lack
        page, size = int(params.get("page", 1)), min(int(params["page_size"]), 500)
        return 200, {
            "count": len(found),
            "next_page": page + 1 if page * size < len(found) else None,
            "previous_page": page - 1 or None,
            "results": found[(page - 1) * size : page * size],
        }

    # -- api/core/rbac/roles/[<id>/] ---------------------------------------------

    def role(self, name: str) -> dict | None:
        return next((r for r in self.roles if r["name"] == name), None)

    def add_role(self, name: str, **fields) -> dict:
        role = {
            "id": max((r["id"] for r in self.roles), default=0) + 1,
            "name": name,
            "actions": [],
            "data_actions": [],
            "is_internal": False,
            **fields,
        }
        self.roles.append(role)
        return role

    @staticmethod
    def _page(found: list, request) -> dict:
        """One page of a core list, as DRF pages it."""
        params = request.url.params
        page, size = int(params.get("page", 1)), int(params.get("page_size", 20))
        more = page * size < len(found)
        return {
            "count": len(found),
            "next": f"https://dm.test{request.url.path}?page={page + 1}"
            if more
            else None,
            "previous": None,
            "results": found[(page - 1) * size : page * size],
        }

    def _roles(self, request, role_id, body):
        params = request.url.params
        if role_id is None and request.method == "GET":
            assert params["platform_key"] == self.ORG
            found = [r for r in self.roles if params.get("name", "") in r["name"]]
            return 200, self._page(found, request)
        if role_id is None:
            assert body["platform_key"] == self.ORG
            if body["name"] in self.RESERVED:
                return 400, {"name": [f"Role name '{body['name']}' is reserved"]}
            if self.role(body["name"]):
                return 400, {
                    "non_field_errors": [
                        "The fields name, platform must make a unique set."
                    ]
                }
            fields = {
                k: v for k, v in body.items() if k not in ("name", "platform_key")
            }
            return 201, self.add_role(body["name"], **fields)
        role = next((r for r in self.roles if r["id"] == int(role_id)), None)
        if role is None:
            return 404, {"detail": "Not found."}
        if request.method == "DELETE":
            assert params["platform_key"] == self.ORG
            self.roles.remove(role)
            # RbacPolicy.role is on_delete=CASCADE.
            self.policies = [p for p in self.policies if p["role_id"] != role["id"]]
            return 204, None
        assert body["platform_key"] == self.ORG
        role.update({k: v for k, v in body.items() if k != "platform_key"})
        return 200, role

    # -- api/core/rbac/policies/[<id>/] ------------------------------------------

    def policy(self, name: str) -> dict | None:
        return next((p for p in self.policies if p["name"] == name), None)

    def add_policy(self, name: str, role: dict, resources: list[str]) -> dict:
        policy = {
            "id": max((p["id"] for p in self.policies), default=0) + 1,
            "name": name,
            "role_id": role["id"],
            "resources": resources,
        }
        self.policies.append(policy)
        return policy

    def _policy_out(self, policy: dict) -> dict:
        role = next(r for r in self.roles if r["id"] == policy["role_id"])
        return {
            "id": policy["id"],
            "name": policy["name"],
            "role": {k: role[k] for k in ("id", "name", "actions", "data_actions")},
            "platform": {"id": 1, "key": self.platform, "name": "Acme"},
            "resources": policy["resources"],
            "is_internal": False,
        }

    @staticmethod
    def _stored(resources: list[str]) -> list[str] | None:
        """Resources as the DM keeps them (each ends in ``/``, by depth then name); None if refused."""
        for item in resources:
            if not re.fullmatch(r"/[a-zA-Z0-9/_*-]*", item):
                return None
        kept = {item if item.endswith("/") else item + "/" for item in resources}
        return sorted(kept, key=lambda r: (r.count("/"), r))

    def _policies(self, request, policy_id, body):
        params = request.url.params
        bad_resources = (
            400,
            {
                "resources": [
                    "resources items can only contain letters, numbers, '-', '_', '*' and '/'"
                ]
            },
        )
        if policy_id is None and request.method == "GET":
            name = params.get("name", "").lower()
            found = [p for p in self.policies if name in p["name"].lower()]
            if "role_id" in params:
                found = [p for p in found if p["role_id"] == int(params["role_id"])]
            page = self._page(found, request)
            page["results"] = [self._policy_out(p) for p in page["results"]]
            return 200, page
        if self.refuse_policy is not None:
            return self.refuse_policy
        if policy_id is None:
            if self.policy(body["name"]):
                return 400, {
                    "non_field_errors": [
                        "The fields platform, name must make a unique set."
                    ]
                }
            resources = self._stored(body["resources"])
            if resources is None:
                return bad_resources
            role = next(r for r in self.roles if r["id"] == body["role_id"])
            return 201, self._policy_out(self.add_policy(body["name"], role, resources))
        policy = next((p for p in self.policies if p["id"] == int(policy_id)), None)
        if policy is None:
            return 404, {"detail": "Not found."}
        if request.method == "DELETE":
            self.policies.remove(policy)
            return 204, None
        if "resources" in body:
            resources = self._stored(body["resources"])
            if resources is None:
                return bad_resources
            policy["resources"] = resources
        return 200, self._policy_out(policy)


@pytest.fixture()
def dm(tmp_path, monkeypatch):
    """dm mode against a ``FakeDm``, which the test reads and fills."""
    pytest.importorskip("django")
    httpx = pytest.importorskip("httpx")
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    from iblai_ontology.backend import bootstrap

    # Before the switch below: settings load once a process, and must load as local.
    bootstrap()
    from django.conf import settings
    from django.core.cache import cache
    from django.core.management import call_command

    from iblai_ontology.backend import store
    from iblai_ontology.backend.platform.client import PlatformClient, PlatformConfig

    # Sync runs and the audit log stay in the local database in dm mode.
    call_command("migrate", run_syncdb=True, verbosity=0)
    call_command("flush", interactive=False, verbosity=0)
    cache.clear()
    monkeypatch.setenv("ONTOLOGY_DATA_STORE", "dm")
    monkeypatch.setattr(settings, "ONTOLOGY_DATA_STORE", "dm")
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", False)
    fake = FakeDm()
    config = PlatformConfig(
        base_url="https://dm.test",
        org=FakeDm.ORG,
        admin_token="key",
        auth_scheme="Api-Token",
    )
    client = PlatformClient(
        config, client=httpx.Client(transport=httpx.MockTransport(fake))
    )
    monkeypatch.setattr(store, "client", lambda: client)
    yield fake
    cache.clear()
