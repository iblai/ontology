"""Schema introspection (Component 5.3).

Builds a :class:`SchemaManifest` of every accessible table, column, key, and
relationship across oracle/postgresql/mysql/sqlserver. Django-free; operates on
a DB-API 2.0 connection.
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

logger = logging.getLogger("iblai_ontology.introspection")


@dataclass
class ColumnInfo:
    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool = False
    foreign_key_table: Optional[str] = None
    foreign_key_column: Optional[str] = None
    max_length: Optional[int] = None
    comment: Optional[str] = None


@dataclass
class TableInfo:
    schema_name: str
    table_name: str
    row_count: int
    columns: list[ColumnInfo] = field(default_factory=list)
    primary_key_columns: list[str] = field(default_factory=list)
    foreign_keys: list[dict] = field(default_factory=list)
    comment: Optional[str] = None
    estimated_size_mb: Optional[float] = None

    @property
    def column_count(self) -> int:
        return len(self.columns)


@dataclass
class SchemaManifest:
    db_type: str
    host: str
    database: str
    schemas: list[str] = field(default_factory=list)
    tables: list[TableInfo] = field(default_factory=list)
    total_tables: int = 0
    total_columns: int = 0
    total_rows: int = 0
    introspection_duration_seconds: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_summary_markdown(self) -> str:
        lines = [
            f"# Schema Summary: {self.database}",
            "",
            f"- **Database type:** {self.db_type}",
            f"- **Host:** {self.host}",
            f"- **Schemas:** {', '.join(self.schemas)}",
            f"- **Total tables:** {self.total_tables}",
            f"- **Total columns:** {self.total_columns}",
            f"- **Total rows:** {self.total_rows:,}",
            f"- **Introspection time:** {self.introspection_duration_seconds:.1f}s",
            "",
            "## Tables",
            "",
        ]
        for table in sorted(self.tables, key=lambda t: t.row_count, reverse=True):
            lines.append(
                f"### {table.schema_name}.{table.table_name} "
                f"({table.row_count:,} rows, {table.column_count} columns)"
            )
            if table.comment:
                lines.extend(["", table.comment])
            lines.extend(
                [
                    "",
                    "| Column | Type | Nullable | PK | FK |",
                    "|--------|------|----------|----|----|",
                ]
            )
            for col in table.columns:
                pk = "✅" if col.is_primary_key else ""
                fk = (
                    f"→ {col.foreign_key_table}.{col.foreign_key_column}"
                    if col.foreign_key_table
                    else ""
                )
                lines.append(
                    f"| {col.name} | {col.data_type} | "
                    f"{'YES' if col.nullable else 'NO'} | {pk} | {fk} |"
                )
            lines.append("")
        return "\n".join(lines)


class SchemaIntrospector:
    """Introspects a database schema and builds a SchemaManifest."""

    def __init__(self, connection, db_type: str) -> None:
        self.connection = connection
        self.db_type = db_type

    def introspect(self) -> SchemaManifest:
        start = time.time()
        schemas = self._list_schemas()
        tables: list[TableInfo] = []
        for schema in schemas:
            tables.extend(self._list_tables(schema))
        for table in tables:
            table.columns = self._get_columns(table.schema_name, table.table_name)
            table.primary_key_columns = [
                c.name for c in table.columns if c.is_primary_key
            ]
            table.foreign_keys = self._get_foreign_keys(
                table.schema_name, table.table_name
            )

        return SchemaManifest(
            db_type=self.db_type,
            host=self._get_database_name(),
            database=self._get_database_name(),
            schemas=schemas,
            tables=tables,
            total_tables=len(tables),
            total_columns=sum(t.column_count for t in tables),
            total_rows=sum(t.row_count for t in tables),
            introspection_duration_seconds=time.time() - start,
        )

    def _cursor(self):
        return self.connection.cursor()

    def _list_schemas(self) -> list[str]:
        cursor = self._cursor()
        queries = {
            "oracle": (
                "SELECT DISTINCT owner FROM all_tables WHERE owner NOT IN "
                "('SYS','SYSTEM','DBSNMP','OUTLN','WMSYS','XDB','CTXSYS','MDSYS',"
                "'ORDSYS','OLAPSYS','ORDDATA') ORDER BY owner"
            ),
            "postgresql": (
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name "
                "NOT IN ('information_schema','pg_catalog','pg_toast') ORDER BY schema_name"
            ),
            "mysql": (
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name "
                "NOT IN ('information_schema','mysql','performance_schema','sys') "
                "ORDER BY schema_name"
            ),
            "sqlserver": (
                "SELECT name FROM sys.schemas WHERE name NOT IN "
                "('sys','guest','INFORMATION_SCHEMA') ORDER BY name"
            ),
        }
        cursor.execute(queries[self.db_type])
        return [row[0] for row in cursor.fetchall()]

    def _list_tables(self, schema: str) -> list[TableInfo]:
        cursor = self._cursor()
        queries = {
            "oracle": (
                f"SELECT table_name, num_rows FROM all_tables WHERE owner = '{schema}' "
                "ORDER BY table_name"
            ),
            "postgresql": (
                "SELECT t.table_name, (SELECT reltuples::bigint FROM pg_class c "
                "JOIN pg_namespace n ON c.relnamespace = n.oid "
                f"WHERE n.nspname = '{schema}' AND c.relname = t.table_name) AS row_count "
                "FROM information_schema.tables t "
                f"WHERE t.table_schema = '{schema}' AND t.table_type = 'BASE TABLE' "
                "ORDER BY t.table_name"
            ),
            "mysql": (
                "SELECT table_name, table_rows FROM information_schema.tables "
                f"WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE' "
                "ORDER BY table_name"
            ),
            "sqlserver": (
                "SELECT t.name, SUM(p.rows) FROM sys.tables t "
                "JOIN sys.schemas s ON t.schema_id = s.schema_id "
                "JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1) "
                f"WHERE s.name = '{schema}' GROUP BY t.name ORDER BY t.name"
            ),
        }
        cursor.execute(queries[self.db_type])
        return [
            TableInfo(schema_name=schema, table_name=row[0], row_count=int(row[1] or 0))
            for row in cursor.fetchall()
        ]

    def _get_columns(self, schema: str, table: str) -> list[ColumnInfo]:
        pk_columns = set(self._get_primary_key_columns(schema, table))
        fk_map = self._get_foreign_key_map(schema, table)
        cursor = self._cursor()
        queries = {
            "oracle": (
                "SELECT column_name, data_type, nullable, data_length, NULL "
                f"FROM all_tab_columns WHERE owner = '{schema}' AND table_name = '{table}' "
                "ORDER BY column_id"
            ),
            "postgresql": (
                "SELECT column_name, data_type, is_nullable, character_maximum_length, NULL "
                "FROM information_schema.columns "
                f"WHERE table_schema = '{schema}' AND table_name = '{table}' "
                "ORDER BY ordinal_position"
            ),
            "mysql": (
                "SELECT column_name, column_type, is_nullable, character_maximum_length, "
                "column_comment FROM information_schema.columns "
                f"WHERE table_schema = '{schema}' AND table_name = '{table}' "
                "ORDER BY ordinal_position"
            ),
            "sqlserver": (
                "SELECT c.name, t.name, c.is_nullable, c.max_length, NULL "
                "FROM sys.columns c JOIN sys.types t ON c.system_type_id = t.system_type_id "
                "AND t.name <> 'sysname' JOIN sys.tables tbl ON c.object_id = tbl.object_id "
                "JOIN sys.schemas s ON tbl.schema_id = s.schema_id "
                f"WHERE s.name = '{schema}' AND tbl.name = '{table}' ORDER BY c.column_id"
            ),
        }
        cursor.execute(queries[self.db_type])
        columns = []
        for row in cursor.fetchall():
            col_name = row[0]
            fk_info = fk_map.get(col_name, {})
            columns.append(
                ColumnInfo(
                    name=col_name,
                    data_type=str(row[1]),
                    nullable=(row[2] in ("YES", "Y", True, 1)),
                    is_primary_key=(col_name in pk_columns),
                    foreign_key_table=fk_info.get("table"),
                    foreign_key_column=fk_info.get("column"),
                    max_length=row[3],
                    comment=row[4],
                )
            )
        return columns

    def _get_primary_key_columns(self, schema: str, table: str) -> list[str]:
        cursor = self._cursor()
        queries = {
            "oracle": (
                "SELECT cc.column_name FROM all_constraints c JOIN all_cons_columns cc "
                "ON c.constraint_name = cc.constraint_name AND c.owner = cc.owner "
                f"WHERE c.owner = '{schema}' AND c.table_name = '{table}' "
                "AND c.constraint_type = 'P' ORDER BY cc.position"
            ),
            "postgresql": (
                "SELECT kcu.column_name FROM information_schema.table_constraints tc "
                "JOIN information_schema.key_column_usage kcu "
                "ON tc.constraint_name = kcu.constraint_name "
                f"WHERE tc.table_schema = '{schema}' AND tc.table_name = '{table}' "
                "AND tc.constraint_type = 'PRIMARY KEY'"
            ),
            "mysql": (
                "SELECT column_name FROM information_schema.key_column_usage "
                f"WHERE table_schema = '{schema}' AND table_name = '{table}' "
                "AND constraint_name = 'PRIMARY'"
            ),
            "sqlserver": (
                "SELECT c.name FROM sys.index_columns ic JOIN sys.columns c "
                "ON ic.object_id = c.object_id AND ic.column_id = c.column_id "
                "JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
                f"WHERE i.is_primary_key = 1 AND ic.object_id = OBJECT_ID('{schema}.{table}')"
            ),
        }
        cursor.execute(queries[self.db_type])
        return [row[0] for row in cursor.fetchall()]

    def _get_foreign_key_map(self, schema: str, table: str) -> dict:
        cursor = self._cursor()
        queries = {
            "oracle": (
                "SELECT acc.column_name, arcc.table_name, arcc.column_name "
                "FROM all_constraints ac JOIN all_cons_columns acc "
                "ON ac.constraint_name = acc.constraint_name AND ac.owner = acc.owner "
                "JOIN all_cons_columns arcc ON ac.r_constraint_name = arcc.constraint_name "
                "AND ac.r_owner = arcc.owner "
                f"WHERE ac.owner = '{schema}' AND ac.table_name = '{table}' "
                "AND ac.constraint_type = 'R'"
            ),
            "postgresql": (
                "SELECT kcu.column_name, ccu.table_name, ccu.column_name "
                "FROM information_schema.referential_constraints rc "
                "JOIN information_schema.key_column_usage kcu "
                "ON rc.constraint_name = kcu.constraint_name "
                "JOIN information_schema.constraint_column_usage ccu "
                "ON rc.unique_constraint_name = ccu.constraint_name "
                f"WHERE kcu.table_schema = '{schema}' AND kcu.table_name = '{table}'"
            ),
            "mysql": (
                "SELECT column_name, referenced_table_name, referenced_column_name "
                "FROM information_schema.key_column_usage "
                f"WHERE table_schema = '{schema}' AND table_name = '{table}' "
                "AND referenced_table_name IS NOT NULL"
            ),
            "sqlserver": (
                "SELECT COL_NAME(fc.parent_object_id, fc.parent_column_id), "
                "OBJECT_NAME(fc.referenced_object_id), "
                "COL_NAME(fc.referenced_object_id, fc.referenced_column_id) "
                f"FROM sys.foreign_key_columns fc "
                f"WHERE fc.parent_object_id = OBJECT_ID('{schema}.{table}')"
            ),
        }
        cursor.execute(queries[self.db_type])
        return {
            row[0]: {"table": row[1], "column": row[2]} for row in cursor.fetchall()
        }

    def _get_foreign_keys(self, schema: str, table: str) -> list[dict]:
        return [
            {
                "column": col,
                "references_table": info["table"],
                "references_column": info["column"],
            }
            for col, info in self._get_foreign_key_map(schema, table).items()
        ]

    def _get_database_name(self) -> str:
        cursor = self._cursor()
        queries = {
            "oracle": "SELECT ora_database_name FROM dual",
            "postgresql": "SELECT current_database()",
            "mysql": "SELECT DATABASE()",
            "sqlserver": "SELECT DB_NAME()",
        }
        try:
            cursor.execute(queries[self.db_type])
            row = cursor.fetchone()
            return row[0] if row else "unknown"
        except Exception:  # pragma: no cover - driver dependent
            return "unknown"
