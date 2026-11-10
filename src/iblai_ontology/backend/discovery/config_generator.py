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


# Toolbox source fields, each read from <SERVICE>_DB_<SUFFIX> (.env.mcp).
_SOURCE_ENV = {
    "host": "HOST",
    "port": "PORT",
    "database": "NAME",
    "user": "USER",
    "password": "PASSWORD",
    "protocol": "PROTOCOL",
}
# ponytail: only ClickHouse declares its full Toolbox field set; the others still emit
# host alone — add a type's fields when the Toolbox serves its agent tools.
_SOURCE_FIELDS = {
    "clickhouse": ("host", "port", "database", "user", "password", "protocol"),
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
        prefix = self.service_name.upper().replace("-", "_")
        fields = _SOURCE_FIELDS.get(self.manifest.db_type, ("host",))
        docs: list[dict] = [
            {
                "kind": "source",
                "name": f"{self.service_name}-source",
                "type": self.manifest.db_type,
                **{f: "${%s_DB_%s}" % (prefix, _SOURCE_ENV[f]) for f in fields},
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

    def _map(self, table: str) -> dict:
        """A table's mapping (entity, lowercased field renames, template), defaults filled."""
        from iblai_ontology.backend.provisioning.schema_generator import cache_name

        bare = table.split(".")[-1]
        td = next(
            (
                d
                for d in self.analysis.table_descriptions
                if d.table_name in (table, bare)
            ),
            None,
        )
        fields = (td.fields if td else None) or {}
        return {
            "entity": td.entity if td and td.entity else cache_name(bare),
            "fields": {str(k).lower(): str(v).lower() for k, v in fields.items()},
            "template": td.template if td and td.template else "",
        }

    def _mappings(self) -> dict[str, dict]:
        return {
            f"{t.schema_name}.{t.table_name}": self._map(
                f"{t.schema_name}.{t.table_name}"
            )
            for t in self.manifest.tables
        }

    def sync_schedules_yaml(self) -> str:
        schedules = []
        keys = {
            f"{t.schema_name}.{t.table_name}": [
                c.lower() for c in t.primary_key_columns
            ]
            for t in self.manifest.tables
        }
        for table, cadence in self.analysis.suggested_sync_schedules.items():
            short = table.split(".")[-1].lower()
            m = self._map(table)
            output = {
                "structured_cache": m["entity"],
                "text_memories": f"/ontology/{m['entity']}/",
            }
            if keys.get(table):
                # The writer's upsert key, composite included, after the renames.
                output["primary_key"] = [m["fields"].get(c, c) for c in keys[table]]
            if m["fields"]:
                output["map"] = m["fields"]
            if m["template"]:
                output["template"] = m["template"]
            schedules.append(
                {
                    "name": f"{self.service_name}-{short}",
                    "cron": _CADENCE_CRON.get(cadence, "0 */6 * * *"),
                    "source": f"{self.service_name}-source",
                    "service": self.service_name,
                    "table": table,
                    "output": output,
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
            self.manifest, self.analysis.entity_groups, mapping=self._mappings()
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


# -- console edits on a stored analysis dict ----------------------------------

_TD_FIELDS = (
    "table_name",
    "description",
    "entity_group",
    "suggested_sync_cadence",
    "sync_rationale",
)


def _bare(name: str) -> str:
    return name.rsplit(".", 1)[-1]


def _td_from_dict(td: dict):
    from iblai_ontology.backend.discovery.llm_analyzer import TableDescription

    return TableDescription(
        **{k: str(td.get(k, "") or "") for k in _TD_FIELDS},
        entity=str(td.get("entity") or ""),
        fields=dict(td.get("fields") or {}),
        template=str(td.get("template") or ""),
    )


def analysis_from_dict(data: dict) -> LLMAnalysisResult:
    """Rebuild a stored ``llm_analysis`` (``LLMAnalysisResult.to_dict`` plus console overrides)."""
    from iblai_ontology.backend.discovery.llm_analyzer import SuggestedTool

    return LLMAnalysisResult(
        table_descriptions=[
            _td_from_dict(td) for td in data.get("table_descriptions") or []
        ],
        entity_groups=dict(data.get("entity_groups") or {}),
        suggested_tools=[
            SuggestedTool(
                name=str(t.get("name") or ""),
                description=str(t.get("description") or ""),
                sql=str(t.get("sql") or ""),
                parameters=list(t.get("parameters") or []),
                toolset=str(t.get("toolset") or "default-tools"),
            )
            for t in data.get("suggested_tools") or []
        ],
        suggested_sync_schedules=dict(data.get("suggested_sync_schedules") or {}),
        draft_cache_schema_sql=str(data.get("draft_cache_schema_sql") or ""),
        used_llm=bool(data.get("used_llm", False)),
    )


def api_schedules_yaml(
    service_name: str,
    display_name: str,
    sync_defaults: dict,
    mapping: dict | None = None,
) -> str:
    """Schedules for an API service: one ``list-<entity>`` tool per catalog ``sync_defaults``
    entry, served by the service's custom MCP server, landing in a table built from the first row.
    The catalog's ``mapping`` names the house table, column renames and template per entity."""
    schedules = []
    for entity, cadence in sync_defaults.items():
        m = (mapping or {}).get(entity) or {}
        target = m.get("entity") or entity
        output = {
            "structured_cache": target,
            "text_memories": f"/ontology/{target}/",
            "primary_key": ["id"],
            "create_table": True,
        }
        if m.get("fields"):
            output["map"] = {
                str(k).lower(): str(v).lower() for k, v in m["fields"].items()
            }
        if m.get("template"):
            output["template"] = m["template"]
        schedules.append(
            {
                "name": f"{service_name}-{entity}",
                "cron": _CADENCE_CRON.get(cadence, "0 */6 * * *"),
                "source": f"{service_name}-mcp",
                "tool": f"list-{entity}",
                "output": output,
                "description": f"Sync {entity} from {display_name} every {cadence}",
            }
        )
    return yaml.dump(
        {"schedules": schedules}, default_flow_style=False, sort_keys=False
    )


def apply_table_edits(
    analysis: dict,
    tables: list[str],
    *,
    entity_group: str | None = None,
    description: str | None = None,
    entity: str | None = None,
    fields: dict | None = None,
    template: str | None = None,
) -> dict:
    """Set the entity group, description and mapping of ``SCHEMA.TABLE`` names in place.

    ``entity_groups`` keeps bare table names (what the cache generator matches);
    the edit is also recorded under ``overrides`` so a rediscovery re-applies it.
    ``entity``, ``fields`` and ``template`` are the mapping layer the sync applies.
    """
    tds = analysis.setdefault("table_descriptions", [])
    groups = analysis.setdefault("entity_groups", {})
    overrides = analysis.setdefault("overrides", {})
    by_name: dict[str, dict] = {}
    for td in tds:
        full = str(td.get("table_name", ""))
        by_name.setdefault(full, td)
        by_name.setdefault(_bare(full), td)
    for qualified in tables:
        td = by_name.get(qualified) or by_name.get(_bare(qualified))
        if td is None:
            td = {
                "table_name": qualified,
                "description": "",
                "entity_group": "other",
                "suggested_sync_cadence": "6h",
                "sync_rationale": "",
            }
            tds.append(td)
            by_name[qualified] = by_name[_bare(qualified)] = td
        edit = overrides.setdefault(qualified, {})
        if description is not None:
            td["description"] = edit["description"] = description
        for key, value in (
            ("entity", entity),
            ("fields", fields),
            ("template", template),
        ):
            if value is not None:
                td[key] = edit[key] = value
        if entity_group is not None:
            td["entity_group"] = edit["entity_group"] = entity_group
            bare = _bare(qualified)
            for members in groups.values():
                members[:] = [m for m in members if m not in (bare, qualified)]
            groups.setdefault(entity_group, []).append(bare)
    for empty in [g for g, members in groups.items() if not members]:
        del groups[empty]
    return analysis


def apply_overrides(analysis: dict, overrides: dict) -> dict:
    """Re-apply recorded console edits (``overrides``) to a fresh analysis dict."""
    for qualified, edit in (overrides or {}).items():
        apply_table_edits(
            analysis,
            [qualified],
            entity_group=edit.get("entity_group"),
            description=edit.get("description"),
            entity=edit.get("entity"),
            fields=edit.get("fields"),
            template=edit.get("template"),
        )
    return analysis


def rewrite_entity_files(
    service_name: str, analysis: dict, out_dir: str | Path
) -> None:
    """Rewrite entity-groups.yaml and table-descriptions.md from a stored analysis dict."""
    result = LLMAnalysisResult(
        table_descriptions=[
            _td_from_dict(td) for td in analysis.get("table_descriptions") or []
        ],
        entity_groups=dict(analysis.get("entity_groups") or {}),
    )
    gen = ConfigGenerator(service_name, None, result)  # type: ignore[arg-type]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "entity-groups.yaml").write_text(gen.entity_groups_yaml())
    (out / "table-descriptions.md").write_text(gen.table_descriptions_md())


def table_descriptions(analysis: dict) -> dict[str, dict]:
    """Table description dicts keyed by qualified and by bare table name."""
    out: dict[str, dict] = {}
    for td in (analysis or {}).get("table_descriptions") or []:
        name = str(td.get("table_name", ""))
        out.setdefault(name, td)
        out.setdefault(_bare(name), td)
    return out
