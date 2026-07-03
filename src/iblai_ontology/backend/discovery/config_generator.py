"""Generate reviewable configuration from a discovery result (Component 5).

Writes a per-service package the Provisioning Engine (Component 6) can execute:

    config/generated/<service>/tools.yaml
    config/generated/<service>/sync-schedules.yaml
    config/generated/<service>/cache-schema.sql
    config/generated/<service>/entity-groups.yaml
    config/generated/<service>/table-descriptions.md
"""

from __future__ import annotations

from pathlib import Path

import yaml

from iblai_ontology.backend.discovery.introspection import SchemaManifest
from iblai_ontology.backend.discovery.llm_analyzer import LLMAnalysisResult

# Sync cadence -> cron expression.
_CADENCE_CRON = {
    "5m": "*/5 * * * *",
    "15m": "*/15 * * * *",
    "1h": "0 * * * *",
    "6h": "0 */6 * * *",
    "24h": "0 2 * * *",
    "weekly": "0 6 * * 1",
}


class ConfigGenerator:
    """Turns a manifest + analysis into reviewable config files."""

    def __init__(
        self,
        service_name: str,
        manifest: SchemaManifest,
        analysis: LLMAnalysisResult,
    ) -> None:
        self.service_name = service_name
        self.manifest = manifest
        self.analysis = analysis

    # -- individual artifacts -------------------------------------------
    def tools_yaml(self) -> str:
        docs: list[dict] = [
            {
                "kind": "source",
                "name": f"{self.service_name}-source",
                "type": self.manifest.db_type,
                "host": "${%s_DB_HOST}" % self.service_name.upper().replace("-", "_"),
            }
        ]
        toolsets: dict[str, list[str]] = {}
        for tool in self.analysis.suggested_tools:
            docs.append(
                {
                    "kind": "tool",
                    "name": tool.name,
                    "type": f"{self.manifest.db_type}-sql",
                    "source": f"{self.service_name}-source",
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "statement": tool.sql,
                }
            )
            toolsets.setdefault(tool.toolset, []).append(tool.name)
        for name, tools in toolsets.items():
            docs.append({"kind": "toolset", "name": name, "tools": tools})
        return yaml.dump_all(docs, default_flow_style=False, sort_keys=False)

    def sync_schedules_yaml(self) -> str:
        schedules = []
        for table, cadence in self.analysis.suggested_sync_schedules.items():
            short = table.split(".")[-1].lower()
            schedules.append(
                {
                    "name": f"{self.service_name}-{short}",
                    "cron": _CADENCE_CRON.get(cadence, "0 */6 * * *"),
                    "source": f"{self.service_name}-source",
                    "tool": f"get-{short}",
                    "output": {"structured_cache": short},
                    "description": f"Sync {table} every {cadence}",
                }
            )
        return yaml.dump(
            {"schedules": schedules}, default_flow_style=False, sort_keys=False
        )

    def entity_groups_yaml(self) -> str:
        return yaml.dump(
            {"entity_groups": self.analysis.entity_groups},
            default_flow_style=False,
            sort_keys=False,
        )

    def table_descriptions_md(self) -> str:
        lines = [f"# {self.service_name} — Table Descriptions", ""]
        for td in self.analysis.table_descriptions:
            lines.append(
                f"## {td.table_name}  _({td.entity_group}, sync {td.suggested_sync_cadence})_"
            )
            lines.append("")
            lines.append(td.description)
            if td.sync_rationale:
                lines.append("")
                lines.append(f"> {td.sync_rationale}")
            lines.append("")
        return "\n".join(lines)

    def cache_schema_sql(self) -> str:
        if self.analysis.draft_cache_schema_sql:
            return self.analysis.draft_cache_schema_sql
        # Fall back to the provisioning generator's projection.
        from iblai_ontology.backend.provisioning.schema_generator import (
            CacheSchemaGenerator,
        )

        return CacheSchemaGenerator(
            self.manifest, self.analysis.entity_groups
        ).generate()

    # -- orchestration ---------------------------------------------------
    def generate_all(self, output_dir: str) -> dict[str, str]:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        artifacts = {
            "tools.yaml": self.tools_yaml(),
            "sync-schedules.yaml": self.sync_schedules_yaml(),
            "entity-groups.yaml": self.entity_groups_yaml(),
            "table-descriptions.md": self.table_descriptions_md(),
            "cache-schema.sql": self.cache_schema_sql(),
        }
        written = {}
        for name, content in artifacts.items():
            path = out / name
            path.write_text(content)
            written[name] = str(path)
        return written
