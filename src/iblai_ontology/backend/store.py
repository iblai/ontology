"""Where the registry and run history live: Django's own database or the DM platform database.

``ONTOLOGY_DATA_STORE=local`` (the default) is the ORM. ``dm`` keeps the same models in the
ibl.ai DM's platform database (Supabase behind the DM's PostgREST proxy, DM PR #3103), reached
through ``PlatformClient``. Callers pass model classes and get model instances back either way;
the Django models stay the one schema definition, and ``ensure_schema`` derives the DM's from
them. Filters are ``field``, ``field__gt|gte|icontains`` or a foreign key by pk — nothing else.
"""

from __future__ import annotations

import json
from functools import cache

from django.conf import settings
from django.db import models

DATABASE = "ontology"
# Rows read from the DM carry an alias DATABASES lacks, so a missed related lookup raises.
DM_ALIAS = "dm"
_BODY_MAX = 2_000_000  # the DM proxy refuses request bodies over 2 MiB
_LOOKUPS = {"": "eq", "gt": "gt", "gte": "gte", "icontains": "ilike"}
_TYPES = {
    "CharField": "TEXT",
    "TextField": "TEXT",
    "GenericIPAddressField": "TEXT",
    "BinaryField": "TEXT",  # Fernet tokens are ASCII
    "IntegerField": "NUMBER",
    "BigIntegerField": "NUMBER",
    "DecimalField": "NUMBER",
    "BooleanField": "BOOLEAN",
    "DateTimeField": "DATE_TIME",
    "JSONField": "RAW_JSON",
    "UUIDField": "UUID",
    "ForeignKey": "RELATION",
}
_SYSTEM = {"id", "created_at", "updated_at"}  # every DM object has these already
_ON_DELETE = {models.CASCADE: "cascade", models.SET_NULL: "set_null"}


def _dm() -> bool:
    return settings.ONTOLOGY_DATA_STORE == "dm"


@cache
def _client():
    from iblai_ontology.backend.platform.client import PlatformClient

    return PlatformClient()


def _path(model) -> str:
    return f"{DATABASE}/rest/v1/{model._meta.db_table}"


def _json(value) -> bytes:
    return json.dumps(
        value, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o)
    ).encode()


def _wire(value) -> str:
    if isinstance(value, models.Model):
        value = value.pk
    if isinstance(value, bool):
        return "true" if value else "false"
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _where(model, where: dict) -> list[tuple[str, str]]:
    params = []
    for key, value in where.items():
        name, _, lookup = key.partition("__")
        if lookup not in _LOOKUPS:
            raise ValueError(f"store: unsupported lookup {key!r}")
        column = model._meta.get_field(name).column
        if value is None and not lookup:
            params.append((column, "is.null"))
        elif lookup == "icontains":
            # ponytail: % _ * in the value act as wildcards here; the ORM escapes them.
            params.append((column, f"ilike.*{_wire(value)}*"))
        else:
            params.append((column, f"{_LOOKUPS[lookup]}.{_wire(value)}"))
    return params


def _order(model, order) -> str:
    keys = [order] if isinstance(order, str) else list(order or model._meta.ordering)
    parts = [
        f"{model._meta.get_field(k.lstrip('-')).column}."
        + ("desc" if k.startswith("-") else "asc")
        for k in keys
    ]
    return ",".join([*parts, "id.asc"])


def _total(resp) -> int:
    return int(resp.headers["content-range"].rsplit("/", 1)[1])


def _instance(model, row: dict):
    fields = model._meta.concrete_fields
    values = []
    for f in fields:
        v = row.get(f.column)
        if v is not None:
            # BinaryField.to_python would base64-decode the token text.
            v = (
                v.encode("ascii")
                if isinstance(f, models.BinaryField)
                else f.to_python(v)
            )
        values.append(v)
    return model.from_db(DM_ALIAS, [f.attname for f in fields], values)


def _row(obj, names, *, add: bool) -> dict:
    """The columns to send: every field on insert, ``names`` on update (``pre_save`` as the ORM)."""
    out = {}
    for f in obj._meta.concrete_fields:
        if not add and f.name not in names and f.attname not in names:
            continue
        value = f.pre_save(obj, add)
        if isinstance(f, models.BinaryField) and value is not None:
            value = bytes(value).decode("ascii")
        out[f.column] = value
    return out


def _post(model, body: bytes) -> None:
    # Bytes, not a stream: the DM answers 411 to a chunked body.
    _client().db(
        "POST", _path(model), content=body, headers={"Prefer": "return=minimal"}
    )


def filter(model, *, order=None, limit: int | None = None, **where) -> list:
    """Rows of ``model`` matching ``where``, in ``order`` (default: the model's ordering)."""
    if not _dm():
        qs = model.objects.filter(**where)
        if order:
            qs = qs.order_by(*([order] if isinstance(order, str) else order))
        return list(qs[:limit])
    params = [*_where(model, where), ("order", _order(model, order))]
    if limit is not None:
        resp = _client().db(
            "GET", _path(model), params=[*params, ("limit", str(limit))]
        )
        return [_instance(model, r) for r in resp.json()]
    rows: list[dict] = []
    while (
        True
    ):  # page to Content-Range's total, so a server-side row cap can't truncate
        resp = _client().db(
            "GET",
            _path(model),
            params=[*params, ("offset", str(len(rows)))],
            headers={"Prefer": "count=exact"},
        )
        page = resp.json()
        rows += page
        if not page or len(rows) >= _total(resp):
            return [_instance(model, r) for r in rows]


def first(model, *, order=None, **where):
    found = filter(model, order=order, limit=1, **where)
    return found[0] if found else None


def get(model, **where):
    obj = first(model, **where)
    if obj is None:
        raise model.DoesNotExist(f"No {model.__name__} matches {where}.")
    return obj


def count(model, **where) -> int:
    if not _dm():
        return model.objects.filter(**where).count()
    resp = _client().db(
        "HEAD",
        _path(model),
        params=_where(model, where),
        headers={"Prefer": "count=exact"},
    )
    return _total(resp)


def save(obj, fields: list[str] | None = None) -> None:
    """Insert ``obj`` when it is new, else update ``fields`` (every field when None)."""
    if not _dm():
        obj.save(update_fields=fields)
        return
    model = type(obj)
    if obj._state.adding:
        _post(model, _json([_row(obj, (), add=True)]))
        obj._state.adding, obj._state.db = False, DM_ALIAS
        return
    if fields is None:
        fields = [f.name for f in model._meta.concrete_fields if not f.primary_key]
    resp = _client().db(
        "PATCH",
        _path(model),
        params=[("id", f"eq.{obj.pk}"), ("select", "id")],
        content=_json(_row(obj, fields, add=False)),
        headers={"Prefer": "return=representation"},
    )
    if (
        not resp.json()
    ):  # no row updated, as Django raises on a 0-row update_fields save
        raise model.DoesNotExist(f"{model.__name__} {obj.pk} is gone.")


def create(model, **values):
    obj = model(**values)
    save(obj)
    return obj


def bulk_create(model, objs: list) -> None:
    """Insert ``objs`` in as few requests as the DM's body cap allows."""
    if not _dm():
        model.objects.bulk_create(objs)
        return
    batch: list[bytes] = []
    size = 2
    for obj in objs:
        row = _json(_row(obj, (), add=True))
        if batch and size + len(row) + 1 > _BODY_MAX:
            _post(model, b"[" + b",".join(batch) + b"]")
            batch, size = [], 2
        batch.append(row)
        size += len(row) + 1
        obj._state.adding, obj._state.db = False, DM_ALIAS
    if batch:
        _post(model, b"[" + b",".join(batch) + b"]")


def delete(model, **where) -> None:
    """Delete matching rows; the database cascades to related rows in both stores."""
    if not _dm():
        model.objects.filter(**where).delete()
        return
    # An unfiltered delete still sends a filter, for a PostgREST that refuses one without.
    _client().db(
        "DELETE", _path(model), params=_where(model, where) or [("id", "not.is.null")]
    )


# -- DM schema ---------------------------------------------------------------


def _models() -> list:
    """The models the store holds, relation targets before the objects that point at them."""
    from iblai_ontology.backend.discovery.models import SafetyReport
    from iblai_ontology.backend.identity.models import AuditLog
    from iblai_ontology.backend.provisioning.models import (
        ProvisioningRun,
        ProvisioningStep,
    )
    from iblai_ontology.backend.services.models import (
        Service,
        ServiceHealth,
        ServiceTable,
    )
    from iblai_ontology.backend.sync.models import SyncRun

    return [
        Service,
        ServiceTable,
        ServiceHealth,
        ProvisioningRun,
        ProvisioningStep,
        SafetyReport,
        SyncRun,
        AuditLog,
    ]


def field_spec(f) -> dict:
    """A model field as the DM's typed schema API declares it."""
    spec = {
        "name": f.column,
        "type": _TYPES[f.get_internal_type()],  # any other type fails loudly
        "is_nullable": f.null,
        "is_unique": f.unique,
    }
    if f.is_relation:
        on_delete = _ON_DELETE.get(f.remote_field.on_delete, "restrict")
        spec["relation"] = {
            "target": f.related_model._meta.db_table,
            "on_delete": on_delete,
        }
    elif f.has_default() and not f.null and not f.unique:
        # The DM needs one when a NOT NULL field joins an object that holds rows.
        spec["default"] = json.loads(_json(f.get_default()))
    return spec


def ensure_schema() -> list[str]:
    """Create the DM database, then whatever objects and fields it lacks; never alters or drops."""
    client = _client()
    created = []
    if client.db("GET", f"{DATABASE}/", ok=(404,)).status_code == 404:
        client.db("POST", "", json={"name": DATABASE})
        created.append(DATABASE)
    have: dict[str, set[str]] = {}
    page = 1
    while page:
        body = client.db("GET", f"{DATABASE}/objects/", params={"page": page}).json()
        have.update(
            {o["name"]: {f["name"] for f in o["fields"]} for o in body["results"]}
        )
        page = body["next_page"]
    for model in _models():
        table = model._meta.db_table
        specs = [
            field_spec(f)
            for f in model._meta.concrete_fields
            if f.column not in _SYSTEM
        ]
        if table not in have:
            client.db(
                "POST", f"{DATABASE}/objects/", json={"name": table, "fields": specs}
            )
            created.append(table)
            continue
        for spec in specs:
            if spec["name"] not in have[table]:
                client.db("POST", f"{DATABASE}/objects/{table}/fields/", json=spec)
                created.append(f"{table}.{spec['name']}")
    return created
