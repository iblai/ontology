"""Twenty CRM read and changed by the backend itself (``backend/services/twenty.py``).

``FakeTwenty`` answers as Twenty 2.48's REST API did when it was read live: the metadata
with each field's type, cursor-paged lists, one record, create and update with composite
values nested, and its refusals in ``messages``.
"""

from __future__ import annotations

import json
import shutil
import uuid
from contextlib import contextmanager

import httpx
import pytest

from iblai_ontology.backend.services import twenty

# Per REST plural: its singular, and each field's metadata type.
OBJECTS = {
    "people": (
        "person",
        {
            "name": "FULL_NAME",
            "emails": "EMAILS",
            "phones": "PHONES",
            "jobTitle": "TEXT",
            "company": "RELATION",
        },
    ),
    "companies": (
        "company",
        {
            "name": "TEXT",
            "domainName": "LINKS",
            "address": "ADDRESS",
            "accountOwner": "RELATION",
        },
    ),
    "opportunities": (
        "opportunity",
        {
            "name": "TEXT",
            "amount": "CURRENCY",
            "closeDate": "DATE_TIME",
            "stage": "SELECT",
            "pointOfContact": "RELATION",
            "company": "RELATION",
            "owner": "RELATION",
        },
    ),
    "workspaceMembers": (
        "workspaceMember",
        {"name": "FULL_NAME", "userEmail": "TEXT", "userId": "UUID"},
    ),
    "notes": ("note", {"title": "TEXT", "bodyV2": "RICH_TEXT"}),
    "tasks": (
        "task",
        {
            "title": "TEXT",
            "bodyV2": "RICH_TEXT",
            "dueAt": "DATE_TIME",
            "status": "SELECT",
            "assignee": "RELATION",
        },
    ),
    "noteTargets": (
        "noteTarget",
        {
            "note": "RELATION",
            "targetPerson": "MORPH_RELATION",
            "targetCompany": "MORPH_RELATION",
            "targetOpportunity": "MORPH_RELATION",
        },
    ),
    "taskTargets": (
        "taskTarget",
        {
            "task": "RELATION",
            "targetPerson": "MORPH_RELATION",
            "targetCompany": "MORPH_RELATION",
            "targetOpportunity": "MORPH_RELATION",
        },
    ),
}
SUBFIELDS = {
    "FULL_NAME": ("firstName", "lastName"),
    "EMAILS": ("primaryEmail", "additionalEmails"),
    "PHONES": ("primaryPhoneNumber",),
    "LINKS": ("primaryLinkUrl",),
    "ADDRESS": ("addressStreet1", "addressCity"),
    "CURRENCY": ("amountMicros", "currencyCode"),
    "RICH_TEXT": ("blocknote", "markdown"),
}
RELATIONS = ("RELATION", "MORPH_RELATION")
STAGES = ("NEW", "SCREENING", "MEETING", "PROPOSAL", "CUSTOMER")


class FakeTwenty:
    """Twenty's REST API as the backend calls it, in memory."""

    URL = "https://crm.acme.test"
    KEY = "the-workspace-key"

    def __init__(self):
        self.records: dict[str, dict[str, dict]] = {plural: {} for plural in OBJECTS}
        self.calls: list[httpx.Request] = []
        self.page = 2  # records a list answers at once, so every list is paged

    def sent(self) -> list[tuple[str, str]]:
        return [(r.method, r.url.path) for r in self.calls]

    def add(self, plural: str, **values) -> dict:
        """A record as Twenty holds one: every field present, composites as objects."""
        record = {
            "id": str(uuid.uuid4()),
            "createdAt": "2026-01-01T00:00:00.000Z",
            "deletedAt": None,
        }
        for name, kind in OBJECTS[plural][1].items():
            if kind in RELATIONS:
                record[f"{name}Id"] = None
            elif kind in SUBFIELDS:
                record[name] = dict.fromkeys(SUBFIELDS[kind])
            else:
                record[name] = None
        self.records[plural][record["id"]] = record
        self._merge(plural, record, values)
        return record

    @staticmethod
    def _merge(plural: str, record: dict, values: dict) -> None:
        fields = OBJECTS[plural][1]
        for name, value in values.items():
            if fields.get(name) in SUBFIELDS:
                record[name].update(value)  # a composite is merged by sub-field
            else:
                record[name] = value

    @staticmethod
    def _refuses(plural: str, body: dict) -> str | None:
        singular, fields = OBJECTS[plural]
        takes = {n for n, k in fields.items() if k not in RELATIONS}
        takes |= {f"{n}Id" for n, k in fields.items() if k in RELATIONS}
        for name, value in body.items():
            if name not in takes:
                return f'Object {singular} doesn\'t have any "{name}" field.'
            if name == "stage" and value not in STAGES:
                return (
                    f'Invalid value "{value}" for field "stage". '
                    f"Valid values are: {', '.join(STAGES)}"
                )
        return None

    @staticmethod
    def _no(status: int, message: str, error: str = "BadRequestException"):
        body = {"statusCode": status, "messages": [message], "error": error}
        return httpx.Response(status, json=body)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.host == "down.acme.test":
            raise httpx.ConnectError("Connection refused")
        if request.url.host == "blog.acme.test":
            return httpx.Response(200, text="<html>Welcome to the Acme blog</html>")
        if request.headers["authorization"] != f"Bearer {self.KEY}":
            return self._no(401, "Token invalid.", "UNAUTHENTICATED")
        parts = request.url.path.strip("/").split("/")
        params = request.url.params
        if parts == ["rest", "metadata", "objects"]:
            objects = [
                {
                    "namePlural": plural,
                    "nameSingular": singular,
                    "fields": [{"name": n, "type": k} for n, k in fields.items()],
                }
                for plural, (singular, fields) in OBJECTS.items()
            ]
            return httpx.Response(200, json={"data": {"objects": objects}})
        plural = parts[1]
        if plural not in OBJECTS:
            return self._no(400, f"object '{plural}' not found. eg: companies")
        # Nested relations would be columns the cache does not have.
        assert params.get("depth") == "0", request.url
        singular = OBJECTS[plural][0]
        records = self.records[plural]
        if len(parts) == 2 and request.method == "GET":
            assert params["limit"] == str(twenty.PAGE)
            start = int(params.get("starting_after", 0))
            found = list(records.values())[start : start + self.page]
            end = start + len(found)
            page = {"hasNextPage": end < len(records), "endCursor": str(end)}
            body = {
                "data": {plural: found},
                "pageInfo": page,
                "totalCount": len(records),
            }
            return httpx.Response(200, json=body)
        body = json.loads(request.content) if request.content else {}
        refused = self._refuses(plural, body)
        if refused:
            return self._no(400, refused)
        if len(parts) == 2:  # POST
            record = self.add(plural, **body)
            answer = {"data": {f"create{singular[:1].upper()}{singular[1:]}": record}}
            return httpx.Response(201, json=answer)
        record = records.get(parts[2])
        if record is None:
            return self._no(404, "Record not found", "NotFoundException")
        if request.method == "PATCH":
            self._merge(plural, record, body)
            answer = {"data": {f"update{singular[:1].upper()}{singular[1:]}": record}}
            return httpx.Response(200, json=answer)
        return httpx.Response(200, json={"data": {singular: record}})


@pytest.fixture()
def crm(monkeypatch):
    """A fake Twenty, reached wherever the module would open a connection."""
    fake = FakeTwenty()

    @contextmanager
    def client(config):
        with httpx.Client(
            base_url=config["host"],
            headers={"Authorization": f"Bearer {config['api_key']}"},
            transport=httpx.MockTransport(fake),
        ) as opened:
            yield opened

    monkeypatch.setattr(twenty, "_client", client)
    return fake


def _config(fake, **changed):
    return {"db_type": "api", "host": fake.URL, "api_key": fake.KEY, **changed}


# -- the module alone ------------------------------------------------------------------------


def test_flatten_expands_composites_only_and_nest_is_its_inverse():
    composites = {"name", "emails", "linkedinLink", "createdBy"}
    row = {
        "id": "1",
        "name": {"firstName": "Tim", "lastName": "Cook"},
        "emails": {"primaryEmail": "t@a.dev", "additionalEmails": []},
        "linkedinLink": {"primaryLinkUrl": "https://l.example/tim"},
        "createdBy": {"source": "MANUAL", "context": {}},
        "avatarFile": {"x": 1},
        "companyId": "c1",
    }
    flat = twenty.flatten(row, composites)
    assert flat == {
        "id": "1",
        "nameFirstName": "Tim",
        "nameLastName": "Cook",
        "emailsPrimaryEmail": "t@a.dev",
        "emailsAdditionalEmails": [],
        "linkedinLinkPrimaryLinkUrl": "https://l.example/tim",
        "createdBySource": "MANUAL",
        "createdByContext": {},
        "avatarFile": {"x": 1},  # a JSON value, not a composite
        "companyId": "c1",
    }
    assert twenty.nest(flat, composites) == row
    # The longest composite that starts a column owns it, and a plain column stays one.
    nested = twenty.nest(
        {"linkUrl": "a", "linkedinLinkUrl": "b"}, {"link", "linkedinLink"}
    )
    assert nested == {"link": {"url": "a"}, "linkedinLink": {"url": "b"}}
    assert twenty.nest({"namespace": "x"}, {"name"}) == {"namespace": "x"}


def test_an_address_is_https_or_this_machine():
    assert twenty.address(" https://crm.acme.edu/ ") == "https://crm.acme.edu"
    assert twenty.address("http://localhost:3000") == "http://localhost:3000"
    for refused in (
        "http://crm.acme.edu",  # the key would ride in the clear
        "crm.acme.edu",
        "ftp://crm.acme.edu",
        "https://user:pw@crm.acme.edu",
        "",
    ):
        with pytest.raises(twenty.TwentyError):
            twenty.address(refused)


def test_list_records_pages_by_cursor_and_flattens(crm):
    for first in ("Ada", "Grace", "Edsger"):
        crm.add("people", name={"firstName": first, "lastName": "X"}, jobTitle="Dr")
    rows = twenty.list_records(_config(crm), "people")
    assert [r["nameFirstName"] for r in rows] == ["Ada", "Grace", "Edsger"]
    assert "name" not in rows[0] and rows[0]["companyId"] is None
    # The metadata once, then two pages of two.
    assert crm.sent() == [
        ("GET", "/rest/metadata/objects"),
        ("GET", "/rest/people"),
        ("GET", "/rest/people"),
    ]
    assert crm.calls[2].url.params["starting_after"] == "2"
    with pytest.raises(twenty.TwentyError, match="no object named rockets"):
        twenty.list_records(_config(crm), "rockets")


def test_check_says_why_an_address_or_a_key_is_refused(crm):
    twenty.check(_config(crm))
    for changed, why in (
        ({"api_key": "wrong"}, "Twenty refused the API key: Token invalid."),
        ({"host": "https://down.acme.test"}, "Twenty did not answer at"),
        ({"host": "https://blog.acme.test"}, "did not answer as Twenty's API does"),
    ):
        with pytest.raises(twenty.TwentyError, match=why):
            twenty.check(_config(crm, **changed))


def _tool(plural, operation):
    name = f"crm-{operation}-{OBJECTS[plural][0]}"
    return {"name": name, "object": plural, "operation": operation}


def test_call_creates_updates_and_links_in_twentys_own_shape(crm):
    from iblai_ontology.catalog import get_entry

    entry, config = get_entry("twenty"), _config(crm)
    made, rows = twenty.call(
        config,
        entry,
        _tool("people", "create"),
        {"first_name": "Ada", "primary_email": "ada@acme.edu", "job_title": "Analyst"},
    )
    held = crm.records["people"][made["id"]]
    # Twenty was sent its own nested fields, and answers in house column names.
    assert held["name"] == {"firstName": "Ada", "lastName": None}
    assert held["emails"]["primaryEmail"] == "ada@acme.edu"
    assert (made["first_name"], made["primary_email"]) == ("Ada", "ada@acme.edu")
    assert list(rows) == ["people"] and rows["people"][0]["nameFirstName"] == "Ada"

    changed, _ = twenty.call(
        config,
        entry,
        _tool("people", "update"),
        {"id": made["id"], "last_name": "Lovelace"},
    )
    assert (changed["first_name"], changed["last_name"]) == ("Ada", "Lovelace")

    deal, _ = twenty.call(
        config,
        entry,
        _tool("opportunities", "create"),
        {"title": "Lab", "amount_micros": 5_000_000, "currency": "USD", "stage": "NEW"},
    )
    assert crm.records["opportunities"][deal["id"]]["amount"] == {
        "amountMicros": 5_000_000,
        "currencyCode": "USD",
    }
    assert (deal["title"], deal["amount_micros"]) == ("Lab", 5_000_000)

    # A note about a person and a deal: one target row each, as Twenty links them.
    note, rows = twenty.call(
        config,
        entry,
        _tool("notes", "create"),
        {
            "title": "Call",
            "body": "Rang.",
            "person_id": made["id"],
            "deal_id": deal["id"],
        },
    )
    assert crm.records["notes"][note["id"]]["bodyV2"]["markdown"] == "Rang."
    targets = [
        (t["noteId"], t["targetPersonId"], t["targetOpportunityId"])
        for t in rows["noteTargets"]
    ]
    assert targets == [(note["id"], made["id"], None), (note["id"], None, deal["id"])]
    # Linking alone is an update with nothing to patch.
    task = crm.add("tasks", title="Follow up")["id"]
    del crm.calls[:]
    twenty.call(
        config, entry, _tool("tasks", "update"), {"id": task, "person_id": made["id"]}
    )
    assert "PATCH" not in [method for method, _ in crm.sent()]
    assert [t["taskId"] for t in crm.records["taskTargets"].values()] == [task]


def test_call_refuses_what_the_catalog_does_not_name_and_says_what_twenty_refuses(crm):
    from iblai_ontology.catalog import get_entry

    entry, config = get_entry("twenty"), _config(crm)
    person = crm.add("people")["id"]
    create, update = _tool("people", "create"), _tool("people", "update")
    for arguments, why in (
        ({"nickname": "A"}, "takes no nickname; it takes first_name"),
        ({"first_name": 5}, "first_name must be string, not 5"),
        ({}, "was given nothing to create"),
    ):
        with pytest.raises(twenty.TwentyError, match=why):
            twenty.call(config, entry, create, arguments)
    deal = _tool("opportunities", "create")
    with pytest.raises(twenty.TwentyError, match="amount_micros must be integer"):
        twenty.call(config, entry, deal, {"amount_micros": True})
    # An id goes into the address: nothing but a record id passes.
    for bad in ("../../metadata/objects", "", None, "1 OR 1=1"):
        with pytest.raises(twenty.TwentyError, match="must be a record id"):
            twenty.call(config, entry, update, {"id": bad, "job_title": "x"})
    assert [m for m, _ in crm.sent() if m != "GET"] == []  # nothing reached Twenty
    with pytest.raises(twenty.TwentyError, match="answered 404: Record not found"):
        gone = str(uuid.uuid4())
        twenty.call(config, entry, update, {"id": gone, "job_title": "x"})
    with pytest.raises(twenty.TwentyError, match='Invalid value "NOPE"'):
        twenty.call(config, entry, deal, {"title": "x", "stage": "NOPE"})
    # A link that is no id is refused before the note is made.
    with pytest.raises(twenty.TwentyError, match="person_id must be a record id"):
        note = _tool("notes", "create")
        twenty.call(config, entry, note, {"title": "x", "person_id": "nope"})
    assert crm.records["notes"] == {}
    assert crm.records["people"][person]["jobTitle"] is None


def test_the_catalog_names_only_fields_twenty_has():
    from iblai_ontology.catalog import get_entry

    entry = get_entry("twenty")
    assert set(entry.writes) == {
        "people",
        "companies",
        "opportunities",
        "notes",
        "tasks",
    }
    for plural, rules in entry.writes.items():
        renames = {v: k for k, v in entry.mapping[plural]["fields"].items()}
        composites = {n for n, k in OBJECTS[plural][1].items() if k in SUBFIELDS}
        assert set(rules["fields"].values()) <= set(twenty._TYPES), plural
        assert set(rules.get("help") or {}) <= set(rules["fields"]), plural
        # Every house column lands on a field the object has.
        columns = {renames.get(c, c): "NEW" for c in rules["fields"]}
        sent = twenty.nest(columns, composites)
        assert FakeTwenty._refuses(plural, sent) is None, (plural, sent)
        targets = rules.get("targets")
        if targets:
            house = set(entry.mapping[targets["object"]]["fields"].values())
            assert {targets["owner"], *targets["links"]} <= house, plural


# -- connected through the console, used through the gateway -----------------------------------

TABLES = (
    "persons",
    "organizations",
    "deals",
    "notes",
    "tasks",
    "note_targets",
    "task_targets",
)


@pytest.fixture()
def backend(tmp_path, monkeypatch):
    for needed in ("django", "cryptography", "rest_framework"):
        pytest.importorskip(needed)
    from cryptography.fernet import Fernet

    from tests.conftest import REPO_ROOT

    cfg = tmp_path / "config"
    cfg.mkdir()
    for name in ("roles.yaml", "tools.yaml"):
        shutil.copy(REPO_ROOT / "config" / name, cfg / name)
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    monkeypatch.setenv("ONTOLOGY_SQLITE_PATH", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ONTOLOGY_FILES_ROOT", str(tmp_path / "ontology"))
    monkeypatch.chdir(tmp_path)  # generated config is written under ./config/generated
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from django.conf import settings
    from django.core.management import call_command
    from django.db import connection

    from iblai_ontology.backend.sync.engine import SyncRunner

    call_command("migrate", run_syncdb=True, verbosity=0)
    call_command("flush", interactive=False, verbosity=0)
    with connection.cursor() as cursor:
        for (
            table
        ) in TABLES:  # one SQLite a process: an earlier test's shape is not ours
            cursor.execute(f"DROP TABLE IF EXISTS {table}")
    monkeypatch.setattr(settings, "ONTOLOGY_API_DEV_ALLOW_ANON", True)
    # No vector store in the tests: a connection timeout a schedule otherwise.
    monkeypatch.setattr(SyncRunner, "_indexer", staticmethod(lambda: None))
    return tmp_path


def _console(view, method="post", data=None, **kwargs):
    """A request as the dev-anon admin through a console view's whole stack."""
    from rest_framework.test import APIRequestFactory

    factory = getattr(APIRequestFactory(), method)
    raw = factory("/x", data, format="json") if data is not None else factory("/x")
    raw.ontology = None
    resp = view.as_view()(raw, **kwargs)
    resp.render()
    return resp.data


def _connect(crm, **changed):
    from iblai_ontology.backend.api.views import ServicesView

    body = {"name": "crm", "adapter": "twenty_api", "host": crm.URL, "api_key": crm.KEY}
    return _console(ServicesView, data={**body, **changed})


def _cache(sql, *params):
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()


@pytest.mark.django
def test_connect_tries_the_key_then_approves_and_syncs_without_a_review(backend, crm):
    from iblai_ontology.backend.api.views import ServicesView
    from iblai_ontology.backend.mcp_server.toolbox_compat import validate_tools_yaml
    from iblai_ontology.backend.mcp_server.toolbox_config import build_toolbox_config
    from iblai_ontology.backend.services.encryption import decrypt_connection_config
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.backend.sync.models import SyncRun
    from iblai_ontology.catalog import get_entry
    from iblai_ontology.config.reader import ConfigReader

    for first in ("Ada", "Grace", "Edsger"):
        crm.add("people", name={"firstName": first, "lastName": "X"}, jobTitle="Dr")

    # A wrong key or address is said at Connect, and leaves nothing behind.
    refused = _connect(crm, api_key="wrong")
    assert dict(refused) == {
        "ok": False,
        "message": "Twenty refused the API key: Token invalid.",
    }
    assert _connect(crm, api_key="")["message"] == "Twenty needs an API key."
    assert "https" in _connect(crm, host="http://crm.acme.test")["message"]
    assert not Service.objects.exists()
    assert not (backend / "config" / "generated").exists()

    connected = _connect(crm)
    assert connected["ok"] is True and "on their way" in connected["message"]
    service = Service.objects.get(name="crm")
    assert (service.status, service.service_type, service.adapter, service.host) == (
        "active",
        "api",
        "twenty_api",
        crm.URL,
    )
    # The key is the registry's, encrypted, and never the console's.
    kept = decrypt_connection_config(service.connection_config_encrypted)
    assert kept == {"db_type": "api", "host": crm.URL, "api_key": crm.KEY}
    assert crm.KEY.encode() not in bytes(service.connection_config_encrypted)
    listed = _console(ServicesView, "get")[0]
    assert listed["connection_config"]["api_key"] == "********"
    assert crm.KEY not in json.dumps(listed, default=str)

    # Its schedules take the database's shape: no connector container to run.
    reader = ConfigReader()
    schedules = {s["name"]: s for s in reader.get_sync_schedules()}
    assert set(schedules) == {f"crm-{p}" for p in get_entry("twenty").sync_defaults}
    people = schedules["crm-people"]
    assert (people["service"], people["table"], people["source"]) == (
        "crm",
        "people",
        "crm",
    )
    assert "tool" not in people and people["output"]["structured_cache"] == "persons"
    # Its ten operations sit in one toolset that changes data, and the file still validates.
    writes = reader.get_toolsets()["crm-writes"]
    assert writes["write"] is True and len(writes["tools"]) == 10
    tools = backend / "config" / "tools.yaml"
    assert validate_tools_yaml(tools).ok
    built = build_toolbox_config(tools)  # the Toolbox is never handed them
    assert set(writes["tools"]) <= set(built.native_tools)
    assert "crm-writes" not in built.config["toolsets"]

    # Connecting made the role of its name: its tables, their memory and its operations.
    tables = sorted(m["entity"] for m in get_entry("twenty").mapping.values())
    assert reader.get_roles()["crm"] == {
        "display_name": "Twenty CRM",
        "memory_paths": [f"/ontology/{table}/**" for table in tables],
        "mcp_toolsets": ["crm-writes"],
        "cache_tables": tables,
    }
    assert "No role" not in connected["message"]

    # The first sync ran (no broker in the tests: inside the request).
    runs = {run.schedule_name: run for run in SyncRun.objects.all()}
    assert set(runs) == set(schedules)
    assert {run.status for run in runs.values()} == {"success"}, [
        (run.schedule_name, run.error_message) for run in runs.values()
    ]
    assert runs["crm-people"].records_processed == 3
    rows = _cache("SELECT first_name, job_title FROM persons ORDER BY first_name")
    assert rows == [("Ada", "Dr"), ("Edsger", "Dr"), ("Grace", "Dr")]
    assert len(list((backend / "ontology" / "persons").glob("*.md"))) == 3

    # The same name again is refused; a name that is no slug is not taken at all.
    assert "already exists" in _connect(crm)["message"]
    assert "name" in _connect(crm, name="../crm")
    assert "name" in _connect(crm, name="databases")


@pytest.mark.django
def test_a_connect_that_cannot_be_approved_leaves_nothing_half_connected(
    backend, crm, monkeypatch
):
    from iblai_ontology.backend.provisioning.pipeline import ProvisioningEngine
    from iblai_ontology.backend.services.models import Service

    def fails(self, service, gen):
        raise RuntimeError("the platform refused the schedules")

    monkeypatch.setattr(ProvisioningEngine, "_step_sync_schedules", fails)
    refused = _connect(crm)
    assert refused["ok"] is False and "refused the schedules" in refused["message"]
    assert not Service.objects.exists()
    assert not (backend / "config" / "generated" / "crm").exists()
    # The tools an earlier step had merged went back out with it.
    assert "crm-create-person" not in (backend / "config" / "tools.yaml").read_text()


@pytest.mark.django
def test_a_role_the_platform_refuses_leaves_the_system_connected_and_says_so(
    backend, crm, monkeypatch
):
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.config.reader import ConfigReader

    def refused(name, spec):
        raise RuntimeError(
            "You cannot grant a policy whose permissions exceed your own."
        )

    monkeypatch.setattr(role_source, "put_role", refused)
    connected = _connect(crm)
    assert connected["ok"] is True and "on their way" in connected["message"]
    assert "No role was made for it: You cannot grant" in connected["message"]
    assert Service.objects.get(name="crm").status == "active"
    assert "crm" not in ConfigReader().get_roles()


@pytest.mark.django
def test_a_systems_role_keeps_what_an_admin_added_and_goes_when_nothing_is_left(
    backend,
):
    from iblai_ontology.backend.identity import role_source

    people = {"cache_tables": ["persons"], "memory_paths": ["/ontology/persons/**"]}
    role_source.extend_role("crm", people, "Twenty CRM")
    role_source.extend_role("crm", {"cache_tables": ["students"]})  # as an admin adds
    assert role_source.load_roles()["crm"] == {
        "display_name": "Twenty CRM",
        "memory_paths": ["/ontology/persons/**"],
        "mcp_toolsets": [],
        "cache_tables": ["persons", "students"],
    }
    role_source.reduce_role("crm", people)
    assert role_source.load_roles()["crm"]["cache_tables"] == ["students"]
    role_source.reduce_role("crm", {"cache_tables": ["students"]})
    assert "crm" not in role_source.load_roles()
    role_source.reduce_role("crm", people)  # a role that is gone is nothing to reduce

    # The role every signed-in member holds never takes a system's reach.
    before = role_source.load_roles()["default"]
    with pytest.raises(RuntimeError, match="every signed-in member"):
        role_source.extend_role("default", people)
    role_source.reduce_role("default", before)
    assert role_source.load_roles()["default"] == before


@pytest.mark.django
def test_a_role_that_holds_the_writes_changes_twenty_and_the_cache_follows(
    backend, crm, monkeypatch
):
    from iblai_ontology.backend.identity.roles import Permissions
    from iblai_ontology.backend.mcp_server.handlers import (
        MCPContext,
        MCPHandlers,
        PermissionDenied,
        dispatch,
    )
    from iblai_ontology.backend.sync import tasks

    crm.add("people", name={"firstName": "Ada", "lastName": "X"})
    assert _connect(crm)["ok"] is True
    recorded = []

    def handlers(*toolsets, record=True):
        perms = Permissions(role="Sales", display_name="x", mcp_toolsets=list(toolsets))
        before = (lambda name, arguments: recorded.append(name)) if record else None
        return MCPHandlers(MCPContext(permissions=perms, before_write=before))

    sales = handlers("crm-writes")
    listed = {t["name"]: t for t in sales.list_tools()}
    assert listed["crm-create-person"]["annotations"] == {
        "readOnlyHint": False,
        "destructiveHint": True,
    }
    assert listed["crm-create-person"]["inputSchema"]["required"] == []
    assert listed["crm-update-person"]["inputSchema"]["required"] == ["id"]
    assert "person_id" in listed["crm-create-note"]["inputSchema"]["properties"]

    made = sales.call_tool(
        "crm-create-person", {"first_name": "Grace", "primary_email": "g@acme.edu"}
    )
    # Recorded first, made in Twenty, and the cache row is there without a sync.
    assert recorded == ["crm-create-person"] and made["cache"] == "refresh queued"
    person = made["record"]
    assert crm.records["people"][person["id"]]["name"]["firstName"] == "Grace"
    found = _cache("SELECT first_name FROM persons WHERE id = %s", person["id"])
    assert found == [("Grace",)]
    assert (backend / "ontology" / "persons" / f"{person['id']}.md").exists()

    sales.call_tool("crm-update-person", {"id": person["id"], "job_title": "Admiral"})
    found = _cache("SELECT job_title FROM persons WHERE id = %s", person["id"])
    assert found == [("Admiral",)]

    # A note about that person: the link's row reaches a table no sync had made yet.
    note = sales.call_tool(
        "crm-create-note", {"title": "Call", "body": "Rang.", "person_id": person["id"]}
    )["record"]
    linked = _cache("SELECT note_id, person_id FROM note_targets")
    assert linked == [(note["id"], person["id"])]

    # What Twenty or the catalog refuses is the tool's error for the agent, never a 500.
    for arguments, why in (
        ({"title": "x", "stage": "NOPE"}, "Valid values are: NEW"),
        ({"nickname": "x"}, "takes no nickname"),
    ):
        call = {"name": "crm-create-opportunity", "arguments": arguments}
        message = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call}
        result = dispatch(sales, message)["result"]
        assert result["isError"] is True and why in result["content"][0]["text"]

    # A worker that cannot be told is said in the answer: the change already happened.
    def down(*args, **kwargs):
        raise ConnectionError("the broker refused the connection")

    with monkeypatch.context() as patched:
        patched.setattr(tasks.write_rows, "delay", down)
        late = sales.call_tool("crm-create-person", {"first_name": "Late"})
    assert late["cache"].startswith("not refreshed (the broker refused")
    assert late["record"]["id"] in crm.records["people"]
    assert not _cache("SELECT 1 FROM persons WHERE id = %s", late["record"]["id"])

    # Every read-only toolset is not this one, and no recorder is no change.
    reader = handlers("*")
    assert "crm-create-person" not in {t["name"] for t in reader.list_tools()}
    with pytest.raises(PermissionDenied):
        reader.call_tool("crm-create-person", {"first_name": "x"})
    with pytest.raises(PermissionDenied, match="records the call first"):
        handlers("crm-writes", record=False).call_tool(
            "crm-create-person", {"first_name": "x"}
        )
    assert len(crm.records["people"]) == 3


@pytest.mark.django
def test_an_api_system_answers_status_and_says_it_has_no_read_only_test(backend, crm):
    from iblai_ontology.backend.api.views import (
        ServiceDiscoverView,
        ServiceStatusView,
        ServiceTestView,
    )
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    assert _connect(crm)["ok"] is True
    status = _console(ServiceStatusView, name="crm")
    # Its one key also makes the changes a role is granted: not a read-only login.
    assert (status["connected"], status["read_only"]) == (True, False)
    assert "no read-only test" in _console(ServiceTestView, name="crm")["message"]
    assert "no schema" in _console(ServiceDiscoverView, name="crm")["message"]
    crm.KEY = "rotated"
    assert "refused the API key" in _console(ServiceStatusView, name="crm")["message"]

    # A system read by its own connector container is said so, in place of a driver error.
    Service.objects.create(
        name="lms",
        display_name="Canvas",
        service_type="api",
        adapter="canvas",
        connection_config_encrypted=encrypt_connection_config({"db_type": "api"}),
    )
    refused = _console(ServiceStatusView, name="lms")
    assert refused["ok"] is False and "connector container" in refused["message"]


@pytest.mark.django
def test_removing_twenty_takes_its_schedules_its_tools_and_the_grants_on_them(
    backend, crm
):
    import yaml

    from iblai_ontology.backend.api.views import ServiceDetailView
    from iblai_ontology.backend.services.models import Service
    from iblai_ontology.config.reader import ConfigReader

    assert _connect(crm)["ok"] is True
    roles_path = backend / "config" / "roles.yaml"
    roles = yaml.safe_load(roles_path.read_text())
    held = ["admin-analytics-tools", "crm-writes"]
    roles["roles"]["Sales"] = {"display_name": "Sales", "mcp_toolsets": held}
    roles_path.write_text(yaml.safe_dump(roles))
    stock = {t["name"] for t in ConfigReader().get_tools()} - {
        t for t in ConfigReader().get_toolsets()["crm-writes"]["tools"]
    }

    assert _console(ServiceDetailView, "delete", name="crm")["ok"] is True
    reader = ConfigReader()
    assert not Service.objects.exists()
    assert reader.get_sync_schedules() == []
    assert {t["name"] for t in reader.get_tools()} == stock
    assert "crm-writes" not in reader.get_toolsets()
    assert "admin-analytics-tools" in reader.get_toolsets()
    # A role naming a toolset that is gone could not be saved again.
    left = yaml.safe_load(roles_path.read_text())["roles"]
    assert left["Sales"]["mcp_toolsets"] == ["admin-analytics-tools"]
    assert left["Executive"]["mcp_toolsets"] == ["*"]
    # The role connecting it made went with it: nothing else had been added to it.
    assert "crm" in roles["roles"] and "crm" not in left
    assert not (backend / "config" / "generated" / "crm").exists()
    # Gone is said, and a system that fails to go stays to be tried again.
    assert _console(ServiceDetailView, "delete", name="crm")["ok"] is False


@pytest.mark.django
def test_a_schedule_from_before_the_backend_read_twenty_says_to_add_it_again(
    backend, crm, monkeypatch
):
    from iblai_ontology.backend.sync.engine import SyncRunner
    from iblai_ontology.backend.sync.models import SyncRun

    assert _connect(crm)["ok"] is True
    monkeypatch.delenv("MCP_CRM_URL", raising=False)
    old = {"name": "crm-old", "source": "crm-mcp", "tool": "list-people"}
    assert SyncRunner()._run_schedule(old, force_full=False).status == "failed"
    said = SyncRun.objects.get(schedule_name="crm-old").error_message
    assert "remove this system and add it again" in said
    # Any other system's missing connector keeps its own words.
    other = {"name": "lms-old", "source": "lms-mcp", "tool": "list-people"}
    SyncRunner()._run_schedule(other, force_full=False)
    said = SyncRun.objects.get(schedule_name="lms-old").error_message
    assert "MCP_LMS_URL is not set" in said
