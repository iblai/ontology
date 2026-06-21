"""Service registry helpers — sync the Service table to/from config/services.yaml."""

from __future__ import annotations

from typing import Any

from iblai_ontology.config import config_dir


def export_services_yaml() -> str:
    """Render the current Service table as services.yaml content."""
    import yaml

    from iblai_ontology.backend.services.models import Service

    services: list[dict[str, Any]] = []
    for s in Service.objects.all():
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


def write_services_yaml() -> str:
    """Write services.yaml to the active config directory; return the path."""
    path = config_dir() / "services.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(export_services_yaml())
    return str(path)
