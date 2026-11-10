"""ONTOLOGY_DATA_STORE=dm: roles, sync schedules and the connected services read from and
written to the ibl.ai platform (the ``dm`` fixture's fake of it), never the three YAML files."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import yaml

pytest.importorskip("django")
pytest.importorskip("httpx")
pytest.importorskip("rest_framework")
pytestmark = pytest.mark.django

ROOT = "/custom/ontology/"
NIGHTLY = {"cron": "0 2 * * *", "source": "ps-source", "tool": "get-students"}
# What the DM answers a policy that grants more than its writer holds.
EXCEEDS = (
    403,
    {"detail": "You cannot grant a policy whose permissions exceed your own."},
)


@pytest.fixture()
def empty_config(dm, tmp_path, monkeypatch):
    """dm mode with a config directory that holds nothing: no file can be the answer."""
    cfg = tmp_path / "config"
    cfg.mkdir()
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    return cfg


def _run(view, method="get", data=None, **view_kwargs):
    """A request as the dev-anon admin through the view's whole stack."""
    from django.conf import settings
    from rest_framework.test import APIRequestFactory

    settings.ONTOLOGY_API_DEV_ALLOW_ANON = True
    factory = getattr(APIRequestFactory(), method)
    raw = factory("/x", data, format="json") if data is not None else factory("/x")
    raw.ontology = None
    resp = view.as_view()(raw, **view_kwargs)
    resp.render()
    return resp


def _schedule(dm, name, **data):
    dm.records["sync_schedule", name] = {"unique_key": None, "data": data}


def _cli(*args):
    from typer.testing import CliRunner

    from iblai_ontology.cli import app

    return CliRunner().invoke(app, list(args))


def _role(dm, name, resources=(), actions=("Ontology/*",), **kept):
    """A role as the platform holds one: its policy when it grants, its record when it has fields."""
    role = dm.add_role(name, actions=list(actions))
    if resources:
        dm.add_policy(f"Ontology: {name}", role, list(resources))
    if kept:
        dm.records["role", name] = {"unique_key": None, "data": kept}
    return role


def _as_read(name, spec):
    """A roles.yaml spec as the platform gives it back: every field, the lists in order."""
    return {
        "display_name": spec.get("display_name", name),
        "memory_paths": sorted(spec.get("memory_paths", [])),
        "mcp_toolsets": sorted(spec.get("mcp_toolsets", [])),
        "cache_tables": sorted(spec.get("cache_tables", [])),
        "agents": spec.get("agents", []),
        "concurrency_limits": spec.get("concurrency_limits", {}),
        "admin_dashboard": spec.get("admin_dashboard", False),
        "self_service": spec.get("self_service", False),
    }


def _writes(dm, since=0):
    """The (method, path) of every call past the first ``since`` that changed something."""
    return [call for call in dm.sent()[since:] if call[0] != "GET"]


def _stock_roles():
    from tests.conftest import REPO_ROOT

    roles = {}
    for name in ("roles.yaml", "roles.higher-ed.example.yaml"):
        roles |= yaml.safe_load((REPO_ROOT / "config" / name).read_text())["roles"]
    return roles


# -- roles -----------------------------------------------------------------------------------


def test_the_example_roles_are_the_stock_roles_yaml():
    from iblai_ontology.backend.identity import role_source
    from tests.conftest import REPO_ROOT

    stock = yaml.safe_load((REPO_ROOT / "config" / "roles.yaml").read_text())
    assert role_source.EXAMPLE_ROLES == stock["roles"]


def test_every_stock_role_is_stored_as_grants_and_reads_back_the_same(dm):
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.identity.roles import RoleResolver

    stock = _stock_roles()
    for name, spec in stock.items():
        role_source.put_role(name, spec)
    assert role_source.load_roles() == {n: _as_read(n, s) for n, s in stock.items()}
    assert all(role["actions"] == ["Ontology/*"] for role in dm.roles)

    # A wildcard is the kind's own resource, and not being self-service is a grant.
    assert dm.policy("Ontology: Executive")["resources"] == [
        ROOT + "memory/",
        ROOT + "subjects/",
        ROOT + "tables/",
        ROOT + "toolsets/",
    ]
    # A file ends in *, which stands for its .md; the caller's own id is USER_EMPLID.
    assert dm.policy("Ontology: Student")["resources"] == [
        ROOT + "toolsets/student-self-service-tools/",
        ROOT + "memory/courses/_index*/",
        ROOT + "memory/courses/by-dept/",
        ROOT + "memory/students/by-id/USER_EMPLID*/",
    ]
    # What is not a grant is the role's record.
    assert dm.records["role", "Student"]["data"] == {
        "display_name": "Student",
        "agents": ["student-self-service-agent"],
        "concurrency_limits": {"max_records_per_query": 1},
    }
    student = RoleResolver().resolve("Student", user_emplid="1234")
    assert student.self_service and not student.admin_dashboard
    assert student.allows_memory_path("/ontology/students/by-id/1234.md")
    assert not student.allows_memory_path("/ontology/students/by-id/9999.md")
    assert RoleResolver().resolve("IblaiOntologyAdmin").admin_dashboard


def test_a_role_reads_as_its_one_policy_grants_and_no_wider(dm, caplog):
    from iblai_ontology.backend.identity import role_source

    for n in range(120):  # a second page of the platform's own roles
        dm.add_role(f"platform-role-{n}", actions=["Ibl.Core/Roles/read"])
    strict = _role(
        dm,
        "Strict",
        [
            ROOT + "toolsets/kept/",
            ROOT + "toolsets/too/deep/",
            ROOT + "toolsets/star*/",
            ROOT + "tables/a_table/",
            ROOT + "memory/students/by-id/USER_EMPLID*/",
            ROOT + "memory/a*/b/",
            ROOT + "console/x/",
            ROOT + "unknown/",
            "/mentors/",
        ],
    )
    # A policy an admin made for a few users does not widen the role for every agent.
    dm.add_policy("Advisors of 2026", strict, [ROOT])
    _role(dm, "Parent", ["/custom/"])
    narrow = ["Ontology/Toolsets/*", "Ibl.Mentor/Mentors/list"]
    _role(dm, "Narrow", [ROOT], actions=narrow)
    _role(dm, "Before", [ROOT])["name"] = "After"  # renamed in the platform
    dm.add_role("Internal", actions=["Ontology/*"], is_internal=True)

    with caplog.at_level("WARNING"):
        roles = role_source.load_roles()
    assert roles == {
        # Only the table's shapes count; the other five are skipped, never widened.
        "Strict": _as_read(
            "Strict",
            {
                "memory_paths": ["/ontology/students/by-id/${USER_EMPLID}.md"],
                "mcp_toolsets": ["kept"],
                "cache_tables": ["a_table"],
                "self_service": True,
            },
        ),
        # A parent of the root covers everything beneath, as in the DM.
        "Parent": _as_read(
            "Parent",
            {
                "memory_paths": ["/ontology/**"],
                "mcp_toolsets": ["*"],
                "cache_tables": ["*"],
                "admin_dashboard": True,
            },
        ),
        # A resource counts only when the role holds its kind's verb.
        "Narrow": _as_read("Narrow", {"mcp_toolsets": ["*"], "self_service": True}),
        # Its policy still carries the old name: it grants nothing.
        "After": _as_read("After", {"self_service": True}),
    }
    assert caplog.text.count("grants nothing here") == 5

    assert dm.sent() == [
        ("GET", "/api/core/rbac/policies/"),
        ("GET", "/v1/ontology/kinds/role/records"),
        ("GET", "/api/core/rbac/roles/"),
        ("GET", "/api/core/rbac/roles/"),
    ]
    assert dict(dm.calls[0].url.params) == {
        "include_users": "false",
        "include_groups": "false",
        "name": "Ontology:",
        "platform_key": "acme",
        "page_size": "100",
        "page": "1",
    }
    asked = [r.url.params for r in dm.calls[2:]]
    assert [(p["page"], p["page_size"], p["platform_key"]) for p in asked] == [
        ("1", "100", "acme"),
        ("2", "100", "acme"),
    ]


def test_policies_of_another_platform_stop_the_read(dm):
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.identity.roles import RoleResolver, RolesUnavailable

    _role(dm, "Executive", [ROOT])
    dm.platform = "someone-else"  # the credential's platform, whatever key was sent
    with pytest.raises(RuntimeError, match="not a credential of IBLAI_ORG"):
        role_source.load_roles()
    with pytest.raises(RolesUnavailable):
        RoleResolver().role_names()


def test_a_resolve_inside_the_ttl_asks_the_platform_nothing(dm, monkeypatch):
    from django.conf import settings

    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.identity.roles import RoleResolver

    grants = [
        ROOT + "toolsets/",
        ROOT + "console/",
        ROOT + "memory/students/by-id/USER_EMPLID*/",
    ]
    _role(dm, "Executive", grants, display_name="University Executive")
    _role(dm, "default")
    resolver = RoleResolver()
    assert isinstance(resolver.reader, role_source.DmRoles)
    granted = resolver.resolve("Executive", user_emplid="1234")
    assert granted.admin_dashboard and granted.mcp_toolsets == ["*"]
    # The caller's own id is filled in.
    assert granted.memory_paths == ["/ontology/students/by-id/1234.md"]
    assert resolver.resolve("nobody").role == "default"

    asked = len(dm.calls)
    assert resolver.role_names() == ["Executive", "default"]
    assert RoleResolver().resolve("Executive").display_name == "University Executive"
    # The policies, the records and one page of roles, once.
    assert len(dm.calls) == asked == 3

    # A change made in the platform shows when the TTL has passed, not before.
    dm.records["role", "Executive"]["data"]["display_name"] = "Exec"
    assert resolver.resolve("Executive").display_name == "University Executive"
    monkeypatch.setattr(settings, "ONTOLOGY_ROLES_TTL", 0)
    assert resolver.resolve("Executive").display_name == "Exec"


def test_the_last_copy_serves_while_the_platform_is_down_and_a_cold_cache_refuses(
    dm, monkeypatch, caplog
):
    from django.conf import settings
    from django.core.cache import cache

    from iblai_ontology.backend.identity.roles import RoleResolver, RolesUnavailable

    _role(dm, "default")
    resolver = RoleResolver()
    assert resolver.role_names() == ["default"]
    monkeypatch.setattr(settings, "ONTOLOGY_ROLES_TTL", 0)
    dm.down = (500, {"detail": "the platform is on fire"})
    with caplog.at_level("WARNING"):
        assert resolver.role_names() == ["default"]
    assert "on fire" in caplog.text and "keeping the last copy" in caplog.text
    # Asked once a TTL while it is down, not once a request.
    monkeypatch.setattr(settings, "ONTOLOGY_ROLES_TTL", 60)
    asked = len(dm.calls)
    assert resolver.role_names() == ["default"] and len(dm.calls) == asked

    cache.clear()
    with caplog.at_level("ERROR"), pytest.raises(RolesUnavailable):
        resolver.role_names()


def test_a_platform_error_on_a_cold_cache_is_a_503_never_the_default_role(
    dm, monkeypatch
):
    from django.conf import settings
    from django.http import HttpResponse
    from django.test import RequestFactory

    from iblai_ontology.backend.identity import middleware
    from iblai_ontology.backend.identity.entra import EntraIdentity

    token = "s" * 40
    monkeypatch.setattr(settings, "SERVICE_TOKEN", token)
    reached = []
    gateway = middleware.OntologyIdentityMiddleware(
        lambda request: reached.append(request) or HttpResponse("reached")
    )
    caller = EntraIdentity(
        user_id="oid-1",
        email="e@uni.edu",
        name="E",
        roles=["Executive"],
        groups=[],
        token_jti="jti-1",
        token_exp=None,
        raw_claims={},
    )
    gateway.validator = SimpleNamespace(validate=lambda _: caller)
    dm.down = (500, {"detail": "boom"})

    def call(bearer, role=None):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {bearer}"}
        if role:
            headers["HTTP_X_IBLAI_ROLE"] = role
        return gateway(RequestFactory().post("/mcp", **headers))

    # The service token and a user's token, with a role named and with none.
    for bearer in (token, "a-users-jwt"):
        for role in ("Executive", None):
            resp = call(bearer, role)
            assert resp.status_code == 503, (bearer, role)
            assert json.loads(resp.content) == {"error": middleware.ROLES_UNAVAILABLE}
    assert reached == []

    dm.down = None
    _role(dm, "Executive", [ROOT])
    _role(dm, "default")
    assert call(token, "Executive").status_code == 200
    assert reached[-1].ontology.permissions.role == "Executive"


def test_saving_a_role_writes_the_role_its_one_policy_and_its_record(empty_config, dm):
    from iblai_ontology.backend.api.views import RoleDetailView, RolesView
    from iblai_ontology.backend.identity.roles import RoleResolver

    assert RoleResolver().role_names() == []  # cached: the platform has none of ours

    body = {
        "display_name": "Academic Advisor",
        "mcp_toolsets": ["enrollment-tools"],
        "memory_paths": ["/ontology/students/**"],
        "agents": ["advising-agent"],
    }
    assert _run(RoleDetailView, "put", body, name="Advisor").data["ok"] is True
    # A new name: a platform role that holds every ontology verb, its policy, its record.
    assert _writes(dm) == [
        ("POST", "/api/core/rbac/roles/"),
        ("POST", "/api/core/rbac/policies/"),
        ("PUT", "/v1/ontology/kinds/role/records/Advisor"),
    ]
    post = next(r for r in dm.calls if r.method == "POST")
    assert json.loads(post.content) == {
        "platform_key": "acme",
        "name": "Advisor",
        "actions": ["Ontology/*"],
    }
    advisor, policy = dm.role("Advisor"), dm.policy("Ontology: Advisor")
    grants = [
        ROOT + "subjects/",
        ROOT + "memory/students/",
        ROOT + "toolsets/enrollment-tools/",
    ]
    assert policy["role_id"] == advisor["id"] and policy["resources"] == grants
    assert dm.records["role", "Advisor"]["data"] == {
        "display_name": "Academic Advisor",
        "agents": ["advising-agent"],
    }
    # The cache key was dropped, so the role is there now.
    assert [r["name"] for r in _run(RolesView).data] == ["Advisor"]

    # A partial save keeps the rest of the spec, and never touches the role's verbs.
    asked = len(dm.calls)
    _run(RoleDetailView, "put", {"display_name": "Advisor"}, name="Advisor")
    assert _writes(dm, asked) == [
        ("PATCH", f"/api/core/rbac/policies/{policy['id']}/"),
        ("PUT", "/v1/ontology/kinds/role/records/Advisor"),
    ]
    patch = next(r for r in dm.calls[asked:] if r.method == "PATCH")
    assert json.loads(patch.content) == {"platform_key": "acme", "resources": grants}
    kept = dm.records["role", "Advisor"]["data"]
    assert (kept["display_name"], kept["agents"]) == ("Advisor", ["advising-agent"])
    assert advisor["actions"] == ["Ontology/*"]
    assert list(empty_config.iterdir()) == []


def test_a_role_that_cannot_be_stored_is_refused_with_the_reason(empty_config, dm):
    from iblai_ontology.backend.api.views import RoleDetailView

    def refused(name, **spec):
        asked = len(dm.calls)
        data = _run(RoleDetailView, "put", spec, name=name).data
        assert data["ok"] is False and _writes(dm, asked) == [], data
        return data["message"]

    # What a resource cannot spell, before anything is written.
    assert "'has.a.dot'" in refused(
        "Odd", display_name="Odd", mcp_toolsets=["has.a.dot"]
    )
    assert "cache_tables" in refused("Odd", display_name="Odd", cache_tables=["a b"])
    for path in (
        "/ontology/courses/*.md",  # neither a folder nor one file
        "/ontology/courses/notes.txt",
        "/elsewhere/**",
        "/ontology/students/USER_EMPLID.md",  # would read back as the caller's own id
    ):
        assert path in refused("Odd", display_name="Odd", memory_paths=[path])
    assert dm.role("Odd") is None

    # A name a platform role already has, when that role is not an ontology role.
    dm.add_role("Staff", actions=["Ibl.Mentor/Mentors/list"])
    assert "no Ontology verb" in refused("Staff", display_name="Staff")
    assert dm.role("Staff")["actions"] == ["Ibl.Mentor/Mentors/list"]

    # A grant whose verb a role made in the platform does not hold: the verbs stay its own.
    _role(dm, "Narrow", actions=["Ontology/Toolsets/action"])
    assert "Ontology/Tables/read" in refused("Narrow", cache_tables=["students"])
    assert _run(RoleDetailView, "put", {"mcp_toolsets": ["one"]}, name="Narrow").data[
        "ok"
    ]
    assert dm.policy("Ontology: Narrow")["resources"] == [ROOT + "toolsets/one/"]
    assert dm.role("Narrow")["actions"] == ["Ontology/Toolsets/action"]

    # What the platform refuses comes back in its own words, not as a 500.
    data = _run(RoleDetailView, "put", {"display_name": "S"}, name="Students").data
    assert data["ok"] is False and "'Students' is reserved" in data["message"]
    assert dm.role("Students") is None


def test_a_refused_policy_leaves_no_new_role_behind(empty_config, dm):
    from iblai_ontology.backend.api.views import RoleDetailView

    def put(name, **spec):
        return _run(RoleDetailView, "put", spec, name=name).data

    _role(dm, "Kept", [ROOT + "toolsets/"])
    dm.refuse_policy = EXCEEDS
    data = put("Auditor", display_name="Auditor")
    assert data["ok"] is False and "exceed your own" in data["message"]
    assert _writes(dm) == [
        ("POST", "/api/core/rbac/roles/"),
        ("POST", "/api/core/rbac/policies/"),
        ("DELETE", "/api/core/rbac/roles/2/"),
    ]
    assert dm.role("Auditor") is None and ("role", "Auditor") not in dm.records
    # A role that was there before stays, as it was.
    assert put("Kept", mcp_toolsets=["one"])["ok"] is False
    assert dm.policy("Ontology: Kept")["resources"] == [ROOT + "toolsets/"]
    dm.refuse_policy = None

    # A policy of that name that binds another role is not taken over.
    dm.add_policy("Ontology: Taken", dm.role("Kept"), [ROOT])
    data = put("Taken", display_name="Taken")
    assert data["ok"] is False and "bound to the role 'Kept'" in data["message"]
    assert dm.role("Taken") is None

    # A parent of the root is replaced by what was asked; what is not the ontology's stays.
    _role(dm, "Wide", ["/custom/", "/mentors/"])
    assert put("Wide", mcp_toolsets=["one"])["ok"] is True
    assert dm.policy("Ontology: Wide")["resources"] == [
        "/mentors/",
        ROOT + "console/",
        ROOT + "memory/",
        ROOT + "subjects/",
        ROOT + "tables/",
        ROOT + "toolsets/one/",
    ]


def test_the_access_pages_requests_become_resources(empty_config, dm):
    """Each switch sends the whole role as /roles listed it, with one list changed."""
    from iblai_ontology.backend.api.views import RoleDetailView, RolesView
    from iblai_ontology.backend.identity import role_source

    def listed(name):
        return next(dict(r) for r in _run(RolesView).data if r["name"] == name)

    def save(role):
        data = _run(RoleDetailView, "put", role, name=role["name"]).data
        assert data["ok"] is True, data
        return dm.policy(f"Ontology: {role['name']}")["resources"]

    role_source.put_role("Executive", role_source.EXAMPLE_ROLES["Executive"])
    role = listed("Executive")
    assert role["mcp_toolsets"] == role["cache_tables"] == ["*"]

    # A toolset switched off on a role that had them all: the others, by name.
    others = ["admin-analytics-tools", "client-postgres-tools"]
    assert save({**role, "mcp_toolsets": others}) == [
        ROOT + "memory/",
        ROOT + "subjects/",
        ROOT + "tables/",
        ROOT + "toolsets/admin-analytics-tools/",
        ROOT + "toolsets/client-postgres-tools/",
    ]
    # A memory domain's read switch, then its cache switch: the domain's own tables.
    role = {**listed("Executive"), "memory_paths": ["/ontology/students/**"]}
    assert ROOT + "memory/students/" in save(role)
    resources = save({**listed("Executive"), "cache_tables": ["students", "holds"]})
    assert [r for r in resources if "/tables/" in r] == [
        ROOT + "tables/holds/",
        ROOT + "tables/students/",
    ]
    assert listed("Executive")["agents"] == ["executive-dashboard-agent"]

    # "New role": the dialog's body creates the role, its policy and its record.
    new = {
        "name": "Registrar",
        "display_name": "Registrar Staff",
        "mcp_toolsets": [],
        "memory_paths": [],
        "cache_tables": [],
        "agents": [],
        "admin_dashboard": False,
    }
    assert save(new) == [ROOT + "subjects/"]
    assert dm.role("Registrar")["actions"] == ["Ontology/*"]
    assert dm.records["role", "Registrar"]["data"]["display_name"] == "Registrar Staff"


def test_deleting_a_role_removes_the_platform_role_its_policy_and_its_record(
    empty_config, dm
):
    from iblai_ontology.backend.api.views import RoleDetailView

    def delete(name):
        return _run(RoleDetailView, "delete", name=name).data

    ours = _role(dm, "Ours", [ROOT], display_name="Ours")
    shared = _role(dm, "Shared", [ROOT])
    dm.add_policy("Advisors of 2026", shared, [ROOT + "toolsets/"])
    dm.add_role("Plain", actions=["Ibl.Mentor/Mentors/list"])
    _role(dm, "default")

    assert delete("Ours")["ok"] is True
    assert dm.sent("DELETE") == [
        f"/api/core/rbac/roles/{ours['id']}/",
        "/v1/ontology/kinds/role/records/Ours",
    ]
    gone = next(r for r in dm.calls if r.method == "DELETE")
    assert gone.url.params["platform_key"] == "acme"
    assert dm.role("Ours") is None and dm.policy("Ontology: Ours") is None
    assert ("role", "Ours") not in dm.records

    # Another policy binds it, and the platform would delete that one with the role.
    data = delete("Shared")
    assert data["ok"] is False and "Advisors of 2026" in data["message"]
    assert dm.role("Shared") is not None and len(dm.policies) == 2

    # Not ours, already gone, or the fallback: nothing is touched.
    writes = len(_writes(dm))
    assert delete("Plain")["ok"] is False and delete("Ours")["ok"] is False
    assert delete("default")["ok"] is False
    assert len(_writes(dm)) == writes
    assert dm.role("Plain") is not None and dm.role("default") is not None


def test_roles_import_copies_a_named_file_and_says_what_was_refused(dm, tmp_path):
    from tests.conftest import REPO_ROOT

    stock = REPO_ROOT / "config" / "roles.yaml"
    result = _cli("roles", "import", str(stock))
    assert result.exit_code == 0, result.output
    names = ["default", "DataAnalyst", "Executive", "IblaiOntologyAdmin"]
    assert result.output.split() == names
    assert [r["name"] for r in dm.roles] == names
    assert all(r["actions"] == ["Ontology/*"] for r in dm.roles)

    # A second import updates and adds nothing. A role that cannot be stored is named
    # with the reason, the rest are still written, and the command fails.
    mine = tmp_path / "mine.yaml"
    own = "/ontology/students/by-id/${USER_EMPLID}.md"
    roles = {
        "Odd": {"display_name": "Odd", "mcp_toolsets": ["has.a.dot"]},
        "Executive": {"display_name": "Exec", "memory_paths": [own]},
    }
    mine.write_text(yaml.safe_dump({"roles": roles}))
    result = _cli("roles", "import", str(mine))
    assert result.exit_code == 1
    assert "Odd: mcp_toolsets: 'has.a.dot'" in result.output
    assert "Executive" in result.output.split()
    assert len(dm.roles) == 4 and dm.role("Odd") is None
    assert dm.policy("Ontology: Executive")["resources"] == [
        ROOT + "subjects/",
        ROOT + "memory/students/by-id/USER_EMPLID*/",
    ]

    listed = _cli("roles", "list")
    assert "the ibl.ai platform" in listed.output and "Executive" in listed.output
    shown = _cli("roles", "show", "Executive")
    assert yaml.safe_load(shown.output) == {
        "Executive": _as_read("Executive", roles["Executive"])
    }
    assert _cli("roles", "import", str(tmp_path / "missing.yaml")).exit_code == 1


def test_roles_import_has_no_default_file(dm, monkeypatch):
    from tests.conftest import REPO_ROOT

    # The config directory's own roles.yaml is never picked up.
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(REPO_ROOT / "config"))
    result = _cli("roles", "import")
    assert result.exit_code == 2 and "Missing argument" in result.output
    assert dm.calls == []


def test_the_import_commands_refuse_local_mode(dm, monkeypatch):
    monkeypatch.delenv("ONTOLOGY_DATA_STORE")
    for command in (("roles", "import", "roles.yaml"), ("sync", "import")):
        result = _cli(*command)
        assert result.exit_code == 1 and "Not in dm mode" in result.output
    assert dm.calls == []


# -- the example roles, at a platform's first console request --------------------------------


def _first_request(monkeypatch):
    """The roles a console request lists, from a process that has not yet asked about examples."""
    from iblai_ontology.backend.api.views import RolesView
    from iblai_ontology.backend.identity import role_source

    monkeypatch.setattr(role_source, "_seed_asked", False)
    return [role["name"] for role in _run(RolesView).data]


def test_the_first_console_request_writes_the_example_roles_once_a_platform(
    empty_config, dm, monkeypatch
):
    from django.core.cache import cache

    from iblai_ontology.backend.api.views import RolesView
    from iblai_ontology.backend.identity import role_source

    names = list(role_source.EXAMPLE_ROLES)
    assert _first_request(monkeypatch) == names
    assert [role["name"] for role in dm.roles] == names
    assert dm.records["setup", "roles"]["data"] == {"roles": names}
    assert dm.policy("Ontology: Executive")["resources"] == [
        ROOT + "memory/",
        ROOT + "subjects/",
        ROOT + "tables/",
        ROOT + "toolsets/",
    ]
    # From the built-in copy: no file is read or written.
    assert list(empty_config.iterdir()) == []

    # The same process asks nothing more.
    asked = len(dm.calls)
    _run(RolesView)
    assert len(dm.calls) == asked

    # An admin deletes them all: another process reads the record and writes nothing.
    dm.roles.clear()
    dm.policies.clear()
    cache.clear()
    assert _first_request(monkeypatch) == []
    assert dm.sent()[asked] == ("GET", "/v1/ontology/kinds/setup/records/roles")
    assert _writes(dm, asked) == []


def test_a_platform_that_has_roles_gets_only_the_record(dm, monkeypatch):
    _role(dm, "Mine", [ROOT])
    assert _first_request(monkeypatch) == ["Mine"]
    assert dm.records["setup", "roles"]["data"] == {"roles": []}
    assert _writes(dm) == [("PUT", "/v1/ontology/kinds/setup/records/roles")]


def test_a_refused_example_role_does_not_stop_the_others(dm, monkeypatch, caplog):
    dm.add_role("Executive", actions=["Ibl.Mentor/Mentors/list"])  # the name is taken
    with caplog.at_level("ERROR"):
        written = _first_request(monkeypatch)
    assert written == ["default", "DataAnalyst", "IblaiOntologyAdmin"]
    assert dm.records["setup", "roles"]["data"] == {"roles": written}
    assert "the example role Executive was refused" in caplog.text


def test_nothing_is_marked_when_no_example_role_could_be_written(dm, monkeypatch):
    dm.refuse_policy = EXCEEDS  # a platform whose admins do not hold custom/ yet
    assert _first_request(monkeypatch) == []
    assert dm.roles == [] and dm.records == {}
    # The next start tries again.
    dm.refuse_policy = None
    assert len(_first_request(monkeypatch)) == 4


def test_only_the_console_writes_the_example_roles(dm, monkeypatch):
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.identity.roles import RoleResolver

    monkeypatch.setattr(role_source, "_seed_asked", False)
    # The gateway's resolver and the CLI read, and seed nothing.
    assert RoleResolver().role_names() == []
    assert _cli("roles", "list").exit_code == 0
    assert dm.roles == [] and dm.records == {}


def test_a_roles_yaml_in_the_config_directory_is_never_read(empty_config, dm):
    from iblai_ontology.backend.api.views import CountsView, GraphView, RolesView
    from iblai_ontology.config.reader import ConfigReader
    from iblai_ontology.config.validator import ConfigValidator

    stale = {"display_name": "From The File", "mcp_toolsets": ["no-such-toolset"]}
    (empty_config / "roles.yaml").write_text(
        yaml.safe_dump({"roles": {"FromTheFile": stale}})
    )
    (empty_config / "sync-schedules.yaml").write_text("schedules:\n- name: no-cron\n")
    _role(dm, "Mine", [ROOT], display_name="Mine")

    assert [r["name"] for r in _run(RolesView).data] == ["Mine"]
    assert _run(CountsView).data["roles"] == 1
    graph = _run(GraphView).data
    assert graph["ok"] is True and "FromTheFile" not in json.dumps(graph["nodes"])
    assert "FromTheFile" not in ConfigReader().show_all()
    for command in (("list",), ("show", "Mine"), ("validate",)):
        result = _cli("roles", *command)
        assert result.exit_code == 0, result.output
        assert "FromTheFile" not in result.output
    assert _cli("roles", "show", "FromTheFile").exit_code == 1

    # `config validate` and the doctor leave both files out, and say where the two live.
    items = {item.file: item for item in ConfigValidator().validate_all().items}
    assert not {"roles.yaml", "sync-schedules.yaml"} & set(items)
    assert items["roles, sync schedules"].valid
    assert "ibl.ai platform" in items["roles, sync schedules"].message


# -- sync schedules --------------------------------------------------------------------------


def test_beat_is_built_from_the_platforms_schedules(dm):
    pytest.importorskip("celery")
    from iblai_ontology.backend.sync.scheduler import build_beat_schedule

    _schedule(dm, "nightly", **NIGHTLY)
    _schedule(dm, "paused", **NIGHTLY, enabled=False)
    _schedule(dm, "on-event", source="canvas", tool="get-activity")
    beat = build_beat_schedule()
    assert list(beat) == ["sync-nightly"]
    assert beat["sync-nightly"]["args"] == ("nightly",)
    assert dm.sent() == [("GET", "/v1/ontology/kinds/sync_schedule/records")]


def test_run_schedule_finds_a_platform_schedule_or_says_not_found(dm, monkeypatch):
    pytest.importorskip("celery")
    from iblai_ontology.backend.sync import tasks
    from iblai_ontology.backend.sync.engine import SyncRunner

    assert tasks.run_schedule("nightly") == {
        "schedule": "nightly",
        "status": "not_found",
    }
    _schedule(dm, "nightly", **NIGHTLY)
    ran = []

    def fake_run(self, sched, *, force_full):
        ran.append(sched)
        return SimpleNamespace(
            schedule_name=sched["name"], status="success", records_processed=3
        )

    monkeypatch.setattr(SyncRunner, "_run_schedule", fake_run)
    assert tasks.run_schedule("nightly") == {
        "schedule": "nightly",
        "status": "success",
        "records": 3,
    }
    assert ran == [{**NIGHTLY, "name": "nightly"}]
    # Run-all skips what is disabled, as it does for the file.
    _schedule(dm, "paused", **NIGHTLY, enabled=False)
    assert [r.schedule_name for r in SyncRunner().run_all_due()] == ["nightly"]


def test_approving_a_service_upserts_its_schedules_and_leaves_the_file_alone(
    empty_config, dm
):
    from iblai_ontology.backend.provisioning.sync_generator import (
        SyncScheduleGenerator,
    )
    from iblai_ontology.backend.sync import schedules

    on_disk = empty_config / "sync-schedules.yaml"
    on_disk.write_text("schedules:\n- name: from-the-file\n  cron: '0 1 * * *'\n")
    _schedule(dm, "kept", **NIGHTLY)
    _schedule(dm, "crm-people", cron="0 0 * * *", source="old", tool="old")
    generated = {
        "schedules": [
            {
                "name": "crm-people",
                "cron": "0 */6 * * *",
                "source": "crm-mcp",
                "tool": "list-people",
                "output": {"structured_cache": "people", "path": "${ONTOLOGY_X}"},
            }
        ]
    }
    where = SyncScheduleGenerator().apply(yaml.safe_dump(generated))
    assert where == "the ibl.ai platform"
    assert dm.sent("PUT") == ["/v1/ontology/kinds/sync_schedule/records/crm-people"]
    # Replaced whole and as written; the others are untouched; by name.
    assert schedules.all() == [
        generated["schedules"][0],
        {**NIGHTLY, "name": "kept"},
    ]
    assert on_disk.read_text().count("from-the-file") == 1
    assert [p.name for p in empty_config.iterdir()] == ["sync-schedules.yaml"]


def test_the_console_saves_lists_and_removes_a_schedule_in_the_platform(
    empty_config, dm
):
    from iblai_ontology.backend.api.views import (
        SyncScheduleDetailView,
        SyncSchedulesView,
    )

    new = {"source": "s", "tool": "t", "cron": "0 * * * *", "mode": "full"}
    assert _run(SyncScheduleDetailView, "put", new, name="hourly").data["ok"] is True
    assert dm.records["sync_schedule", "hourly"]["data"] == {**new, "name": "hourly"}
    # A partial save keeps the rest.
    _run(SyncScheduleDetailView, "put", {"enabled": False}, name="hourly")
    stored = dm.records["sync_schedule", "hourly"]["data"]
    assert (stored["cron"], stored["enabled"]) == ("0 * * * *", False)
    listed = _run(SyncSchedulesView).data
    assert [(s["name"], s["enabled"]) for s in listed] == [("hourly", False)]

    assert _run(SyncScheduleDetailView, "delete", name="hourly").data["ok"] is True
    assert dm.records == {}
    assert _run(SyncScheduleDetailView, "delete", name="hourly").data["ok"] is False
    assert list(empty_config.iterdir()) == []


def test_sync_import_copies_a_file_as_written_and_prints_each_name(
    dm, tmp_path, monkeypatch
):
    from tests.conftest import REPO_ROOT

    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(REPO_ROOT / "config"))
    monkeypatch.setenv("ONTOLOGY_X", "from-the-environment")
    result = _cli("sync", "import")
    assert result.exit_code == 0, result.output
    names = result.output.split()
    assert len(names) == 7 and "students-full" in names
    assert sorted(key for _, key in dm.records) == sorted(names)
    assert dm.records["sync_schedule", "students-full"]["data"]["cron"] == "0 2 * * *"

    mine = tmp_path / "mine.yaml"
    table = {"name": "crm-people", "service": "crm", "table": "public.people"}
    event = {"name": "on-event", "source": "s", "tool": "${ONTOLOGY_X}"}
    mine.write_text(yaml.safe_dump({"schedules": [table, event]}))
    assert _cli("sync", "import", str(mine)).output.split() == [
        "crm-people",
        "on-event",
    ]
    assert dm.records["sync_schedule", "on-event"]["data"]["tool"] == "${ONTOLOGY_X}"

    # A schedule with no tool, or with no cron, is listed all the same.
    listed = _cli("sync", "schedule")
    assert listed.exit_code == 0, listed.output
    assert "the ibl.ai platform" in listed.output


# -- connected services, counts, the map -----------------------------------------------------


def _service(name, adapter):
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    return store.create(
        Service, name=name, display_name=name, service_type="api", adapter=adapter
    )


def test_doctor_checks_the_environment_of_the_platforms_services(
    empty_config, dm, monkeypatch
):
    from iblai_ontology.commands.doctor import run_checks

    monkeypatch.setenv("TWENTY_API_KEY", "k")
    monkeypatch.delenv("TWENTY_BASE_URL", raising=False)
    _service("crm", "twenty")
    _service("homegrown", "not-in-the-catalog")
    checks = {c.name: c for c in run_checks()}
    assert checks["env:crm"].ok is False
    assert checks["env:crm"].detail == "missing: TWENTY_BASE_URL"
    assert "env:homegrown" not in checks and "services" not in checks

    # A registry that cannot be read is a line of its own, not a silent skip.
    dm.down = (503, {"error": "not available on this instance yet"})
    checks = {c.name: c for c in run_checks()}
    assert checks["services"].ok is False and "503" in checks["services"].detail
    assert not [name for name in checks if name.startswith("env:")]


def test_config_show_reads_the_three_from_the_platform(empty_config, dm):
    from iblai_ontology.config.reader import ConfigReader

    _role(dm, "Executive", [ROOT + "toolsets/"], display_name="University Executive")
    _schedule(dm, "nightly", **NIGHTLY)
    _service("crm", "twenty")
    shown = yaml.safe_load(ConfigReader().show_all())
    executive = shown["roles"]["roles"]["Executive"]
    assert executive["display_name"] == "University Executive"
    assert executive["mcp_toolsets"] == ["*"] and list(shown["roles"]["roles"]) == [
        "Executive"
    ]
    assert shown["sync_schedules"] == {"schedules": [{**NIGHTLY, "name": "nightly"}]}
    assert [s["name"] for s in shown["services"]["services"]] == ["crm"]


def test_config_leaves_out_the_two_files_the_platform_holds(empty_config, dm):
    from iblai_ontology.backend.api.views import ConfigFilesView

    (empty_config / "roles.yaml").write_text("roles: {}\n")
    (empty_config / "tools.yaml").write_text("kind: source\npassword: hunter2\n")
    files = {f["id"]: f for f in _run(ConfigFilesView).data["files"]}
    assert list(files) == ["ontology", "tools", "caddyfile", "catalog"]
    assert files["tools"]["content"] == "kind: source\npassword: ••••••••\n"
    assert dm.calls == []


def test_platform_address_records_where_the_backend_is_reached(dm):
    result = _cli("platform", "address", "--url", "https://ontology.acme.edu/")
    assert result.exit_code == 0, result.output
    assert "acme: https://ontology.acme.edu" in result.output
    assert dm.records["backend", "default"]["data"] == {
        "url": "https://ontology.acme.edu"
    }

    # What the frontend would refuse is refused here, before the platform is asked.
    asked = len(dm.calls)
    for url in (
        "http://ontology.acme.edu",
        "ontology.acme.edu",
        "//acme.edu",
        "ftp://x",
    ):
        assert _cli("platform", "address", "--url", url).exit_code == 1, url
    assert len(dm.calls) == asked
    assert _cli("platform", "address", "--url", "http://localhost:8000").exit_code == 0

    # What the platform refuses is said, not thrown.
    dm.down = (403, {"detail": "You do not have permission to perform this action."})
    refused = _cli("platform", "address", "--url", "https://ontology.acme.edu")
    assert refused.exit_code == 1 and "403" in refused.output


def test_counts_and_the_map_read_the_platform(empty_config, dm):
    from iblai_ontology.backend.api.views import CountsView, GraphView

    _role(dm, "Executive", [ROOT], display_name="University Executive")
    _role(dm, "default")
    _schedule(dm, "nightly", **NIGHTLY)
    _service("crm", "twenty")
    counts = _run(CountsView).data
    assert (counts["data_store"], counts["services"], counts["roles"]) == ("dm", 1, 2)

    graph = _run(GraphView).data
    assert graph["ok"] is True, graph["message"]
    assert {"service", "role", "schedule"} <= {n["kind"] for n in graph["nodes"]}
    assert "Executive" in json.dumps(graph["nodes"])
    # The platform not answering is told to the console, not thrown at it.
    dm.down = (502, {"detail": "bad gateway"})
    graph = _run(GraphView).data
    assert graph["ok"] is False and "502" in graph["message"]
