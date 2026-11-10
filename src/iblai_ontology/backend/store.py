"""Where the service registry lives: Django's own database, or the ibl.ai platform.

``ONTOLOGY_DATA_STORE=local`` (the default) is the ORM. ``dm`` keeps the registry (services,
their tables, health checks, safety reports, provisioning runs and steps) in the ibl.ai
platform as records, one kind per model, reached through ``PlatformClient``. Sync runs and the
audit log use the ORM in both modes. Callers pass model classes and get model instances back
either way. Filters are ``field`` (``None`` for null) or a foreign key by pk; the ORM alone
also answers ``field__gt|gte|icontains``.
"""

from __future__ import annotations

import json
from datetime import datetime
from functools import cache

from django.db import models
from django.db.models.deletion import get_candidate_relations_to_delete

from iblai_ontology.config import dm_store

# Rows read from the DM carry an alias DATABASES lacks, so a missed related lookup raises.
DM_ALIAS = "dm"
_BODY_MAX = 2_000_000  # the DM refuses request bodies over 2 MiB
_PAGE = 500  # the DM's largest page
_KEYS = 200  # parents named in one cascading delete
_LOCAL = {"SyncRun", "AuditLog"}  # the two logs never leave this host


def _dm(model) -> bool:
    return dm_store() and model.__name__ not in _LOCAL


@cache
def client():
    """The DM client the registry, the sync schedules and the roles share."""
    from iblai_ontology.backend.platform.client import PlatformClient

    return PlatformClient()


def _text(value) -> str:
    if isinstance(value, datetime):
        # Fixed width, so timestamps order as text whatever the DM's collation.
        return value.isoformat(timespec="microseconds")
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _json(value) -> bytes:
    return json.dumps(value, default=_text).encode()


# -- records: what the DM stores, whatever model (or none) stands behind a kind -------------


def records(
    kind: str,
    where: dict | None = None,
    order: str = "",
    limit: int | None = None,
) -> list[dict]:
    """The DM's records of ``kind`` matching ``where``: every page, or the first ``limit``."""
    params: dict = {"page_size": min(limit or _PAGE, _PAGE)}
    if where:
        params["where"] = _json(where).decode()
    if order:
        params["order"] = order
    found: list[dict] = []
    page = 1
    while page and (limit is None or len(found) < limit):
        body = client().records("GET", kind, params={**params, "page": page}).json()
        found += body["results"]
        page = body["next_page"]
    return found[:limit]


def put_record(kind: str, key: str, data: dict, unique_key: str | None = None) -> None:
    """Create the record or replace it whole."""
    body = {"data": data, "unique_key": unique_key}
    # Bytes, not a stream: the DM answers 411 to a chunked body.
    client().records("PUT", kind, key, content=_json(body))


def delete_record(kind: str, key: str) -> bool:
    """False when the DM holds no such record."""
    return client().records("DELETE", kind, key, ok=(404,)).status_code != 404


# -- models over records ---------------------------------------------------------------------


def _where(model, where: dict) -> dict:
    out = {}
    for name, value in where.items():
        if "__" in name:
            raise ValueError(
                f"store: {name!r} is not answered for {model.__name__} in the DM"
            )
        if isinstance(value, models.Model):
            value = value.pk
        # As the DM holds it: a UUID or a timestamp as its text.
        out[model._meta.get_field(name).column] = json.loads(_json(value))
    return out


def _order(model, order) -> str:
    keys = [order] if isinstance(order, str) else list(order or model._meta.ordering)
    return ",".join(
        ("-" if k.startswith("-") else "") + model._meta.get_field(k.lstrip("-")).column
        for k in keys
    )


def _unique(model):
    """The model's one unique field besides its key, which the DM keeps unique too."""
    unique = [f for f in model._meta.concrete_fields if f.unique and not f.primary_key]
    if len(unique) > 1:
        raise NotImplementedError(
            f"store: {model.__name__} has more than one unique field"
        )
    return unique[0] if unique else None


def _instance(model, record: dict):
    row = record["data"]
    fields = model._meta.concrete_fields
    values = []
    for f in fields:
        # A field newer than the record reads as its default.
        v = row[f.column] if f.column in row else f.get_default()
        if isinstance(f, models.BinaryField) and isinstance(v, str):
            # BinaryField.to_python would base64-decode the token text.
            v = v.encode("ascii")
        elif v is not None:
            v = f.to_python(v)
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


def _record(obj) -> dict:
    unique = _unique(type(obj))
    return {
        "key": str(obj.pk),
        "unique_key": getattr(obj, unique.attname) if unique else None,
        "data": _row(obj, (), add=True),
    }


def filter(model, *, order=None, limit: int | None = None, **where) -> list:
    """Rows of ``model`` matching ``where``, in ``order`` (default: the model's ordering)."""
    if not _dm(model):
        qs = model.objects.filter(**where)
        if order:
            qs = qs.order_by(*([order] if isinstance(order, str) else order))
        return list(qs[:limit])
    found = records(
        model._meta.db_table, _where(model, where), _order(model, order), limit
    )
    return [_instance(model, r) for r in found]


def first(model, *, order=None, **where):
    found = filter(model, order=order, limit=1, **where)
    return found[0] if found else None


def get(model, **where):
    obj = first(model, **where)
    if obj is None:
        raise model.DoesNotExist(f"No {model.__name__} matches {where}.")
    return obj


def count(model, **where) -> int:
    if not _dm(model):
        return model.objects.filter(**where).count()
    params: dict = {"page_size": 1}
    if where:
        params["where"] = _json(_where(model, where)).decode()
    return client().records("GET", model._meta.db_table, params=params).json()["count"]


def save(obj, fields: list[str] | None = None) -> None:
    """Insert ``obj`` when it is new, else update ``fields`` (every field when None)."""
    model = type(obj)
    if not _dm(model):
        obj.save(update_fields=fields)
        return
    kind = model._meta.db_table
    if obj._state.adding:
        client().records("POST", kind, content=_json(_record(obj)))
        obj._state.adding, obj._state.db = False, DM_ALIAS
        return
    if fields is None:
        fields = [f.name for f in model._meta.concrete_fields if not f.primary_key]
    body = {"data": _row(obj, fields, add=False)}
    unique = _unique(model)
    if unique and unique.name in fields:
        body["unique_key"] = getattr(obj, unique.attname)
    resp = client().records("PATCH", kind, str(obj.pk), content=_json(body), ok=(404,))
    if resp.status_code == 404:  # as Django raises on a 0-row update_fields save
        raise model.DoesNotExist(f"{model.__name__} {obj.pk} is gone.")


def create(model, **values):
    obj = model(**values)
    save(obj)
    return obj


def bulk_create(model, objs: list) -> None:
    """Insert ``objs`` in as few requests as the DM's body cap allows."""
    if not _dm(model):
        model.objects.bulk_create(objs)
        return
    kind = model._meta.db_table
    batch: list[bytes] = []
    size = 2
    for obj in objs:
        row = _json(_record(obj))
        if batch and size + len(row) + 1 > _BODY_MAX:
            client().records("POST", kind, content=b"[" + b",".join(batch) + b"]")
            batch, size = [], 2
        batch.append(row)
        size += len(row) + 1
        obj._state.adding, obj._state.db = False, DM_ALIAS
    if batch:
        client().records("POST", kind, content=b"[" + b",".join(batch) + b"]")


def delete(model, **where) -> None:
    """Delete matching rows and every row that points at them, as the database cascades locally."""
    if not _dm(model):
        model.objects.filter(**where).delete()
        return
    _delete(model, _where(model, where))


def _delete(model, where: dict) -> None:
    # ponytail: several requests, not one transaction; children go first, so a failure
    # midway leaves parents that a second delete finishes.
    kind = model._meta.db_table
    children = list(get_candidate_relations_to_delete(model._meta))
    keys = [r["key"] for r in records(kind, where)] if children else []
    for relation in children:
        if relation.on_delete is not models.CASCADE:
            raise NotImplementedError(
                f"store: {relation.related_model.__name__} does not cascade"
            )
        for start in range(0, len(keys), _KEYS):
            parents = {relation.field.column: keys[start : start + _KEYS]}
            _delete(relation.related_model, parents)
    client().records("DELETE", kind, content=_json({"where": where}))
