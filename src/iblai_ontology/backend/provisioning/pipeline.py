"""Provisioning pipeline orchestrator (Component 6).

Takes the discovery output for a service and runs the strict, idempotent
pipeline that makes the integration operational:

    cache schema -> text templates -> MCP tools -> sync schedules
    -> docker-compose -> validation

Each step records a ProvisioningStep; the run records rollback data so a failed
run (or ``teardown``) can be undone.
"""

from __future__ import annotations

import logging
from pathlib import Path

from iblai_ontology.config import config_dir

logger = logging.getLogger("iblai_ontology.provisioning")


class ProvisioningEngine:
    """Runs and reverses the provisioning pipeline for a service."""

    def __init__(self, generated_root: str | Path = "config/generated") -> None:
        self.generated_root = Path(generated_root)

    def _generated_dir(self, name: str) -> Path:
        return self.generated_root / name

    def provision(self, name: str):
        from django.utils import timezone

        from iblai_ontology.backend.provisioning.models import (
            ProvisioningRun,
            ProvisioningStep,
        )
        from iblai_ontology.backend.services.models import Service

        service = Service.objects.get(name=name)
        gen = self._generated_dir(name)
        if not gen.exists():
            raise FileNotFoundError(
                f"No generated config for '{name}'. Run `ontology service discover {name}` first."
            )

        run = ProvisioningRun.objects.create(
            service=service, status=ProvisioningRun.Status.RUNNING
        )
        steps = [
            (ProvisioningStep.StepType.CACHE_SCHEMA, self._step_cache_schema),
            (ProvisioningStep.StepType.TEXT_TEMPLATES, self._step_text_templates),
            (ProvisioningStep.StepType.MCP_TOOLS, self._step_mcp_tools),
            (ProvisioningStep.StepType.SYNC_SCHEDULES, self._step_sync_schedules),
            (ProvisioningStep.StepType.DOCKER_COMPOSE, self._step_docker_compose),
            (ProvisioningStep.StepType.VALIDATION, self._step_validation),
        ]
        try:
            for order, (step_type, fn) in enumerate(steps):
                step = ProvisioningStep.objects.create(
                    run=run,
                    step_type=step_type,
                    order=order,
                    status=ProvisioningStep.Status.RUNNING,
                    started_at=timezone.now(),
                )
                output = fn(service, gen)
                step.output = output or {}
                step.status = ProvisioningStep.Status.COMPLETED
                step.completed_at = timezone.now()
                step.save()
            run.status = ProvisioningRun.Status.COMPLETED
            run.completed_at = timezone.now()
            run.save()
            service.status = Service.Status.ACTIVE
            service.save(update_fields=["status"])
        except Exception as exc:
            run.status = ProvisioningRun.Status.FAILED
            run.error_message = str(exc)[:1000]
            run.completed_at = timezone.now()
            run.save()
            raise
        return run

    # -- steps (each idempotent) ----------------------------------------
    def _step_cache_schema(self, service, gen: Path) -> dict:
        sql_path = gen / "cache-schema.sql"
        if not sql_path.exists():
            return {"skipped": "no cache-schema.sql"}
        target = config_dir().parent / "sql" / f"{service.name}-cache.sql"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sql_path.read_text())
        # Applying DDL against the live cache happens at deploy time (init SQL).
        return {"cache_schema": str(target)}

    def _step_text_templates(self, service, gen: Path) -> dict:
        from iblai_ontology.backend.provisioning.memory_generator import MemoryGenerator

        written = MemoryGenerator().write_templates(config_dir().parent / "templates")
        return {"templates": written}

    def _step_mcp_tools(self, service, gen: Path) -> dict:
        from iblai_ontology.backend.provisioning.tools_generator import ToolsGenerator

        tools_yaml = gen / "tools.yaml"
        if not tools_yaml.exists():
            return {"skipped": "no tools.yaml"}
        path = ToolsGenerator().apply(tools_yaml.read_text())
        return {"tools_yaml": path}

    def _step_sync_schedules(self, service, gen: Path) -> dict:
        from iblai_ontology.backend.provisioning.sync_generator import (
            SyncScheduleGenerator,
        )

        sync_yaml = gen / "sync-schedules.yaml"
        if not sync_yaml.exists():
            return {"skipped": "no sync-schedules.yaml"}
        path = SyncScheduleGenerator().apply(sync_yaml.read_text())
        return {"sync_schedules": path}

    def _step_docker_compose(self, service, gen: Path) -> dict:
        from iblai_ontology.backend.provisioning.compose_generator import (
            mcp_service_fragment,
            needs_compose_update,
        )

        if not needs_compose_update(service.service_type):
            return {"skipped": "database service uses shared MCP Toolbox"}
        return {"compose_fragment": mcp_service_fragment(service.name)}

    def _step_validation(self, service, gen: Path) -> dict:
        from iblai_ontology.backend.provisioning.validator import ProvisioningValidator

        report = ProvisioningValidator(service).validate()
        return {
            "ok": report.ok,
            "tables": [
                {"table": r.table, "records": r.records, "ok": r.ok}
                for r in report.results
            ],
        }

    # -- teardown --------------------------------------------------------
    def teardown(self, name: str) -> None:
        """Remove a service integration: drop generated config + registry rows."""
        from iblai_ontology.backend.services.models import Service

        gen = self._generated_dir(name)
        if gen.exists():
            for f in gen.glob("*"):
                f.unlink()
            gen.rmdir()
        Service.objects.filter(name=name).delete()
        logger.info("Tore down service '%s'", name)
