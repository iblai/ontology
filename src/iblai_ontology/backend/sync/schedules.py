"""Sync schedules: sync-schedules.yaml on this host, or records of the ibl.ai platform in dm mode.

There is no model. A schedule is the mapping the YAML holds; in dm it is a record of kind
``sync_schedule`` whose key is the schedule's name, stored and read as written (``${VAR}`` is
expanded for the file only).
"""

from __future__ import annotations

from iblai_ontology.config import dm_store

KIND = "sync_schedule"


def all() -> list[dict]:
    """Every schedule, as the scheduler, the sync engine and the console read them."""
    if not dm_store():
        from iblai_ontology.config.reader import ConfigReader

        return ConfigReader().get_sync_schedules()
    from iblai_ontology.backend import store

    # The platform returns records by key, so by name.
    return [{**r["data"], "name": r["key"]} for r in store.records(KIND)]


def upsert(spec: dict) -> None:
    """Create or replace one schedule in the platform; the file is merged by its generator."""
    from iblai_ontology.backend import store

    store.put_record(KIND, spec["name"], spec)


def delete(name: str) -> bool:
    """False when there is no such schedule."""
    if not dm_store():
        from iblai_ontology.config import writer

        return writer.delete_schedule(name)
    from iblai_ontology.backend import store

    return store.delete_record(KIND, name)
