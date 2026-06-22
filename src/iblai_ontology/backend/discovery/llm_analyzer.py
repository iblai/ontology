"""LLM-powered schema analysis (Component 5.4) — BYOK, with rule-based fallback.

When an LLM key is configured (``ontology config llm``), the schema manifest is
sent to the model for entity grouping, table descriptions, tool suggestions, and
sync cadences. Without a key, :class:`RuleBasedAnalyzer` uses the adapter's
pre-built patterns. Default models: anthropic→claude-opus-4-8, openai→gpt-4o.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

logger = logging.getLogger("iblai_ontology.llm_analyzer")


@dataclass
class TableDescription:
    table_name: str
    description: str
    entity_group: str
    suggested_sync_cadence: str
    sync_rationale: str = ""


@dataclass
class SuggestedTool:
    name: str
    description: str
    sql: str
    parameters: list[dict] = field(default_factory=list)
    toolset: str = "default-tools"


@dataclass
class LLMAnalysisResult:
    table_descriptions: list[TableDescription] = field(default_factory=list)
    entity_groups: dict[str, list[str]] = field(default_factory=dict)
    suggested_tools: list[SuggestedTool] = field(default_factory=list)
    suggested_sync_schedules: dict[str, str] = field(default_factory=dict)
    draft_cache_schema_sql: str = ""
    raw_llm_response: str = ""
    used_llm: bool = False

    def to_dict(self) -> dict:
        from dataclasses import asdict

        return asdict(self)


SYSTEM_PROMPT = """You are a database schema analyst for a higher education institution.
You are analyzing a database schema to help configure iblai-ontology, an on-premise
knowledge layer that caches and exposes institutional data via MCP.

Your job is to:
1. Describe each table in plain English (what it stores, what each row represents)
2. Group tables by entity domain (students, courses, financial_aid, hr, facilities, …)
3. Suggest parameterized SQL queries (MCP tools) for common use cases
4. Suggest sync schedules based on data volatility (static→weekly/daily,
   slowly-changing→6h, frequently-changing→1h or less, real-time→5m)
5. Suggest a PostgreSQL cache schema for the most important entities

Output valid JSON matching the requested schema. Be precise with SQL."""

_PROMPT_TEMPLATE = """Analyze this database schema and produce configuration for iblai-ontology.

Database type: {db_type}
Database: {database}
Schemas: {schemas}

Table inventory ({table_count} tables, {total_rows} total rows):

{table_inventory}

For the top {analysis_limit} tables by row count, column details:

{column_details}

Produce a JSON response with keys: table_descriptions[], entity_groups{{}},
suggested_tools[], suggested_sync_schedules{{}}, cache_schema_sql."""


class SchemaAnalyzer:
    """Sends a schema manifest to the configured BYOK LLM."""

    def __init__(self) -> None:
        from django.conf import settings

        self.provider = settings.LLM_PROVIDER
        self.api_key = settings.LLM_API_KEY
        self.model = settings.LLM_MODEL
        self.max_tokens = settings.LLM_MAX_TOKENS
        self.temperature = settings.LLM_TEMPERATURE
        if not self.provider or not self.api_key:
            raise ValueError(
                "LLM not configured. Run: ontology config llm "
                "(or set llm.provider and llm.api_key in config/ontology.yaml)"
            )

    def analyze(self, manifest, analysis_limit: int = 100) -> LLMAnalysisResult:
        table_inventory = "\n".join(
            f"  {t.schema_name}.{t.table_name}: {t.row_count:,} rows, {t.column_count} columns"
            for t in sorted(manifest.tables, key=lambda t: t.row_count, reverse=True)
        )
        top_tables = sorted(manifest.tables, key=lambda t: t.row_count, reverse=True)[:analysis_limit]
        column_details = ""
        for table in top_tables:
            column_details += f"\n{table.schema_name}.{table.table_name}:\n"
            for col in table.columns:
                pk = " [PK]" if col.is_primary_key else ""
                fk = (
                    f" [FK -> {col.foreign_key_table}.{col.foreign_key_column}]"
                    if col.foreign_key_table
                    else ""
                )
                column_details += (
                    f"  - {col.name} ({col.data_type}, "
                    f"{'NULL' if col.nullable else 'NOT NULL'}){pk}{fk}\n"
                )

        prompt = _PROMPT_TEMPLATE.format(
            db_type=manifest.db_type,
            database=manifest.database,
            schemas=", ".join(manifest.schemas),
            table_count=manifest.total_tables,
            total_rows=f"{manifest.total_rows:,}",
            table_inventory=table_inventory,
            column_details=column_details,
            analysis_limit=analysis_limit,
        )
        raw = self._call_llm(prompt)
        return self._parse_response(raw)

    def _call_llm(self, prompt: str) -> str:
        if self.provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=self.api_key)
            resp = client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                temperature=self.temperature,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            return resp.content[0].text
        if self.provider == "openai":
            import openai

            client = openai.OpenAI(api_key=self.api_key)
            resp = client.chat.completions.create(
                model=self.model,
                max_tokens=self.max_tokens,
                temperature=self.temperature,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            )
            return resp.choices[0].message.content
        raise ValueError(f"Unknown LLM provider: {self.provider}")

    @staticmethod
    def _parse_response(raw: str) -> LLMAnalysisResult:
        json_str = raw
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]
        data = json.loads(json_str.strip())

        result = LLMAnalysisResult(raw_llm_response=raw, used_llm=True)
        for td in data.get("table_descriptions", []):
            result.table_descriptions.append(
                TableDescription(
                    table_name=td["table_name"],
                    description=td["description"],
                    entity_group=td.get("entity_group", "other"),
                    suggested_sync_cadence=td.get("suggested_sync_cadence", "6h"),
                    sync_rationale=td.get("sync_rationale", ""),
                )
            )
        result.entity_groups = data.get("entity_groups", {})
        for st in data.get("suggested_tools", []):
            result.suggested_tools.append(
                SuggestedTool(
                    name=st["name"],
                    description=st["description"],
                    sql=st["sql"],
                    parameters=st.get("parameters", []),
                    toolset=st.get("toolset", "default-tools"),
                )
            )
        result.suggested_sync_schedules = data.get("suggested_sync_schedules", {})
        result.draft_cache_schema_sql = data.get("cache_schema_sql", "")
        return result


class RuleBasedAnalyzer:
    """Adapter-driven fallback analysis when no LLM key is configured."""

    def __init__(self, adapter) -> None:
        self.adapter = adapter

    def analyze(self, manifest, analysis_limit: int = 100) -> LLMAnalysisResult:
        result = LLMAnalysisResult(used_llm=False)
        groups: dict[str, list[str]] = {}
        for t in manifest.tables:
            group = self.adapter.classify_table(t.table_name)
            desc = self.adapter.describe_table(t.table_name)
            cadence = self.adapter.suggest_sync_cadence(t.table_name, t.row_count)
            result.table_descriptions.append(
                TableDescription(
                    table_name=f"{t.schema_name}.{t.table_name}",
                    description=desc,
                    entity_group=group,
                    suggested_sync_cadence=cadence,
                    sync_rationale="rule-based (adapter pattern)",
                )
            )
            groups.setdefault(group, []).append(t.table_name)
            result.suggested_sync_schedules[f"{t.schema_name}.{t.table_name}"] = cadence
            for tool in self.adapter.suggested_tools(t.table_name):
                result.suggested_tools.append(
                    SuggestedTool(
                        name=tool["name"],
                        description=tool["description"],
                        sql=tool["sql"],
                        parameters=tool.get("parameters", []),
                        toolset=tool.get("toolset", "default-tools"),
                    )
                )
        result.entity_groups = groups
        return result
