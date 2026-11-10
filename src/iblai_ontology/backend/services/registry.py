"""Service registry helpers — the manifest's table rows, and services.yaml export."""

from __future__ import annotations

from typing import Any


def _summary(table: dict) -> dict:
    return {
        "schema_name": table.get("schema_name", ""),
        "table_name": table.get("table_name", ""),
        "row_count": table.get("row_count", 0),
        "column_count": table.get("column_count", len(table.get("columns") or [])),
    }


def save_manifest(service, manifest: dict, fields: tuple[str, ...] = ()) -> None:
    """Store a discovered manifest: full tables as ServiceTable rows, summaries on the service.

    The summaries go last and mark the write finished. ``fields`` saves along with them.
    """
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    tables = manifest.get("tables") or []
    # ponytail: delete-then-insert is not atomic; a failed batch leaves a partial table
    # set until the next Discover (the tables are re-derivable; edits live in llm_analysis).
    store.delete(ServiceTable, service=service.pk)
    store.bulk_create(
        ServiceTable,
        [
            ServiceTable(service=service, position=i, payload=t)
            for i, t in enumerate(tables)
        ],
    )
    service.schema_manifest = {**manifest, "tables": [_summary(t) for t in tables]}
    store.save(service, ["schema_manifest", *fields])


def with_tables(service):
    """``service`` with its full tables back in ``schema_manifest`` — in memory, never saved."""
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import ServiceTable

    rows = store.filter(ServiceTable, service=service.pk)
    service.schema_manifest = {
        **(service.schema_manifest or {}),
        "tables": [t.payload for t in rows],
    }
    return service


def export_services_yaml() -> str:
    """Render the current Service table as services.yaml content."""
    import yaml

    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    services: list[dict[str, Any]] = []
    for s in store.filter(Service):
        services.append(
            {
                "name": s.name,
                "display_name": s.display_name,
                "type": s.service_type,
                "adapter": s.adapter,
                "status": s.status,
                "host": s.host,
                "safety": {"status": s.safety_status},
                "sync": {"status": s.sync_status, "tables_synced": s.tables_synced},
            }
        )
    return yaml.dump({"services": services}, default_flow_style=False, sort_keys=False)
