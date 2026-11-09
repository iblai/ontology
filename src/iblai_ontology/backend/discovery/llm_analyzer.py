"""LLM-powered schema analysis (Component 5.4) — BYOK or the DM, with rule-based fallback.

When an LLM is configured (``ontology config llm``), the schema manifest is sent to
the model for entity grouping, table descriptions, tool suggestions, and sync
cadences, and :class:`MappingProposer` asks it how each table maps onto the house
entities. Providers: ``anthropic`` and ``openai`` with your own key, or ``iblai``,
the DM's OpenAI-compatible endpoint behind the platform API key the store already
uses. Without one, :class:`RuleBasedAnalyzer` uses the adapter's pre-built patterns.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger("iblai_ontology.llm_analyzer")


@dataclass
class TableDescription:
    table_name: str
    description: str
    entity_group: str
    suggested_sync_cadence: str
    sync_rationale: str = ""
    # The mapping layer: cache table and memory folder, source→target column renames, template.
    entity: str = ""
    fields: dict = field(default_factory=dict)
    template: str = ""


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


def _llm_settings():
    from django.conf import settings

    provider = settings.LLM_PROVIDER
    if not provider or (provider != "iblai" and not settings.LLM_API_KEY):
        raise ValueError(
            "LLM not configured. Run: ontology config llm "
            "(or set llm.provider and llm.api_key in config/ontology.yaml)"
        )
    return settings


def call_llm(system: str, prompt: str) -> str:
    """One completion from the configured provider.

    ``iblai`` posts an OpenAI chat body to the DM's ``/v1/chat/completions`` with the
    platform credentials of ``PlatformConfig`` (``Api-Token`` or ``Token``), at
    ``llm.base_url`` when the deployment serves completions from another host.
    """
    s = _llm_settings()
    if s.LLM_PROVIDER == "anthropic":
        import anthropic

        client = anthropic.Anthropic(api_key=s.LLM_API_KEY)
        resp = client.messages.create(
            model=s.LLM_MODEL,
            max_tokens=s.LLM_MAX_TOKENS,
            temperature=s.LLM_TEMPERATURE,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
    if s.LLM_PROVIDER == "openai":
        import openai

        client = openai.OpenAI(api_key=s.LLM_API_KEY)
        resp = client.chat.completions.create(
            model=s.LLM_MODEL,
            max_tokens=s.LLM_MAX_TOKENS,
            temperature=s.LLM_TEMPERATURE,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content
    if s.LLM_PROVIDER == "iblai":
        import httpx

        from iblai_ontology.backend.platform.client import PlatformConfig

        cfg = PlatformConfig.from_env()
        base = (s.LLM_BASE_URL or cfg.base_url).rstrip("/")
        resp = httpx.post(
            f"{base}/api/ai-mentor/orgs/{cfg.org}/v1/chat/completions",
            headers={"Authorization": f"{cfg.auth_scheme} {cfg.admin_token}"},
            json={
                "model": s.LLM_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "temperature": s.LLM_TEMPERATURE,
                "max_tokens": s.LLM_MAX_TOKENS,
                "stream": False,
            },
            timeout=180,
        )
        if resp.is_error:
            raise RuntimeError(
                f"DM chat/completions: HTTP {resp.status_code} {resp.text[:500]}"
            )
        return resp.json()["choices"][0]["message"]["content"]
    raise ValueError(f"Unknown LLM provider: {s.LLM_PROVIDER}")


def _json_block(raw: str) -> dict:
    """The JSON object in a completion, with or without a code fence."""
    json_str = raw
    if "```json" in json_str:
        json_str = json_str.split("```json")[1].split("```")[0]
    elif "```" in json_str:
        json_str = json_str.split("```")[1].split("```")[0]
    return json.loads(json_str.strip())


class SchemaAnalyzer:
    """Sends a schema manifest to the configured LLM."""

    def __init__(self) -> None:
        _llm_settings()  # fail before any work when no LLM is configured

    def analyze(self, manifest, analysis_limit: int = 100) -> LLMAnalysisResult:
        table_inventory = "\n".join(
            f"  {t.schema_name}.{t.table_name}: {t.row_count:,} rows, {t.column_count} columns"
            for t in sorted(manifest.tables, key=lambda t: t.row_count, reverse=True)
        )
        top_tables = sorted(manifest.tables, key=lambda t: t.row_count, reverse=True)[
            :analysis_limit
        ]
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
        return call_llm(SYSTEM_PROMPT, prompt)

    @staticmethod
    def _parse_response(raw: str) -> LLMAnalysisResult:
        data = _json_block(raw)

        result = LLMAnalysisResult(raw_llm_response=raw, used_llm=True)
        for td in data.get("table_descriptions", []):
            result.table_descriptions.append(
                TableDescription(
                    table_name=td["table_name"],
                    description=td["description"],
                    entity_group=td.get("entity_group", "other"),
                    suggested_sync_cadence=td.get("suggested_sync_cadence", "6h"),
                    sync_rationale=td.get("sync_rationale", ""),
                    entity=str(td.get("entity") or ""),
                    fields=dict(td.get("fields") or {}),
                    template=str(td.get("template") or ""),
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


MAPPING_SYSTEM_PROMPT = """You map a source database's tables onto an institution's house data model
for iblai-ontology, an on-premise knowledge layer that caches institutional data.

For each source table decide:
1. entity: the house table it fills when its columns carry the same meaning at the
   same grain (one row means the same thing); otherwise a short snake_case name for a
   table of its own (the source name lowercased, vendor prefixes dropped).
2. fields: {source_column: target_column} renames, only for columns whose name changes;
   a column with no house equivalent keeps its own name. Never invent columns.
3. template: the memory template for its rows: the house entity's singular name when
   one is listed, else "generic".
4. entity_group: the domain (students, courses, enrollment, financial_aid, hr, crm,
   facilities, other).
5. description: one plain-English sentence saying what one row represents.

Output valid JSON only:
{"tables": {"<schema.table>": {"entity": "...", "fields": {...}, "template": "...",
"entity_group": "...", "description": "..."}}}"""

_MAPPING_PROMPT = """House entities (table: columns):
{house}

Memory templates: {templates}

Source database: {database} ({db_type})

{tables}

Return the JSON mapping for every source table listed."""


class MappingProposer:
    """Asks the LLM how each discovered table maps onto the house entities.

    The prompt carries each table's columns and, unless ``sample_rows`` is 0, a few
    rows read through the service's own connection; those values leave the host for
    the configured model.
    """

    def __init__(
        self, service, *, sample_rows: int | None = None, analysis_limit: int = 100
    ) -> None:
        from django.conf import settings

        self.service = service
        self.sample_rows = (
            settings.LLM_SAMPLE_ROWS if sample_rows is None else sample_rows
        )
        self.analysis_limit = analysis_limit

    @staticmethod
    def house_entities() -> dict[str, list[str]]:
        """The deployment's hand-curated model: ``sql/schema.sql`` tables and their columns."""
        from iblai_ontology.config import config_dir

        path = config_dir().parent / "sql" / "schema.sql"
        if not path.exists():
            return {}
        out: dict[str, list[str]] = {}
        for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\);", path.read_text(), re.S):
            cols = [
                ln.split()[0]
                for ln in (ln.strip() for ln in m.group(2).splitlines())
                if ln
                and not ln.startswith(
                    ("--", "PRIMARY", "UNIQUE", "CONSTRAINT", "FOREIGN")
                )
            ]
            out[m.group(1)] = cols
        return out

    def propose(self) -> dict[str, dict]:
        from iblai_ontology.backend.provisioning.memory_generator import (
            DEFAULT_TEMPLATES,
        )
        from iblai_ontology.backend.services.registry import with_tables
        from iblai_ontology.backend.sync.engine import SyncRunner

        manifest = with_tables(self.service).schema_manifest or {}
        tables = sorted(
            manifest.get("tables") or [],
            key=lambda t: t.get("row_count", 0),
            reverse=True,
        )[: self.analysis_limit]
        runner = SyncRunner()
        blocks = []
        for t in tables:
            schema, name = t.get("schema_name") or "", t.get("table_name") or ""
            qualified = f"{schema}.{name}" if schema else name
            cols = ", ".join(
                f"{c.get('name')} ({c.get('data_type', '')})"
                for c in t.get("columns") or []
            )
            block = f"{qualified}:\n  columns: {cols}"
            if self.sample_rows:
                sample = runner.pull_table(
                    self.service, qualified, limit=self.sample_rows
                )
                block += f"\n  sample rows: {json.dumps(sample, default=str)[:4000]}"
            blocks.append(block)
        house = (
            "\n".join(
                f"  {n}: {', '.join(c)}" for n, c in self.house_entities().items()
            )
            or "  (none)"
        )
        prompt = _MAPPING_PROMPT.format(
            house=house,
            templates=", ".join(sorted(DEFAULT_TEMPLATES)),
            database=manifest.get("database", ""),
            db_type=manifest.get("db_type", ""),
            tables="\n".join(blocks),
        )
        data = _json_block(call_llm(MAPPING_SYSTEM_PROMPT, prompt))
        return {
            str(k): v
            for k, v in (data.get("tables") or {}).items()
            if isinstance(v, dict)
        }


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
