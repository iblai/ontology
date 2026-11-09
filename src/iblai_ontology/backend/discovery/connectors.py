"""NVIDIA auto-ontology connectors behind the DB-API seam (Component 5).

Snowflake, Trino and ClickHouse have no DB-API driver here; the ``auto-ontology``
extra brings NVIDIA's ``SQLDatabase`` connectors, which speak DataFrames.
:class:`ConnectorConnection` gives them the cursor shape the safety suite expects
and :func:`manifest_from_connector` maps their metadata frames onto
:class:`SchemaManifest`. Django-free; ``auto_ontology`` is imported lazily so the
package loads without the extra.
"""

from __future__ import annotations

import json
import time
from typing import Optional

from iblai_ontology.backend.discovery.introspection import (
    ColumnInfo,
    SchemaManifest,
    TableInfo,
)

# db_types served by an auto-ontology connector (and an MCP Toolbox kind of the same name).
CONNECTOR_DB_TYPES = frozenset({"snowflake", "trino", "clickhouse"})
# Engines addressed by account/host alone.
PORTLESS = frozenset({"snowflake"})

_EXTRA_HINT = "pip install 'iblai-ontology[auto-ontology]'"


def connect(db_type: str, config: dict) -> ConnectorConnection:
    """Open an auto-ontology connector for ``config`` and wrap it DB-API style."""
    try:
        from auto_ontology.connectors.connection_string_factory import (
            build_connection_string,
        )
        from auto_ontology.connectors.registry import create_connector
    except ImportError as exc:
        raise ValueError(
            f"db_type '{db_type}' needs the auto-ontology extra: {_EXTRA_HINT}"
        ) from exc

    spec = {
        "type": db_type,
        "host": config.get("host") or "",
        "port": config.get("port") or "",
        "database": config.get("database") or "",
        "user": config.get("username") or "",
        "password": config.get("password") or "",
        **(config.get("options") or {}),
    }
    if db_type == "snowflake":
        spec.setdefault("account", spec["host"])
    return ConnectorConnection(create_connector(build_connection_string(spec)), db_type)


class _ConnectorCursor:
    def __init__(self, connector) -> None:
        self._connector = connector
        self._rows: list[tuple] = []
        self.description: list[tuple] | None = None

    def execute(self, sql: str) -> None:
        frame = self._connector.execute(sql)
        if frame is None:
            self.description, self._rows = None, []
            return
        # JSON-native values (ints, floats, ISO dates, None) so rows bind on any cache DB.
        records = json.loads(
            frame.to_json(orient="records", date_format="iso", default_handler=str)
        )
        columns = [str(c) for c in frame.columns]
        self.description = [(c, None, None, None, None, None, None) for c in columns]
        self._rows = [tuple(r.get(c) for c in columns) for r in records]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple]:
        return list(self._rows)


class ConnectorConnection:
    """DB-API shape over a ``SQLDatabase`` so the safety suite and introspector reuse it."""

    def __init__(self, connector, db_type: str) -> None:
        self.connector = connector
        self.db_type = db_type

    def cursor(self) -> _ConnectorCursor:
        return _ConnectorCursor(self.connector)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        self.connector.close()


def _base_tables(frame):
    """Rows of a tables frame that are base tables (views carry no row to probe)."""
    if frame is None or frame.empty or "table_type" not in frame.columns:
        return frame
    kinds = frame["table_type"].astype("string").str.lower().fillna("base table")
    return frame[kinds == "base table"]


def first_table_and_column(connector) -> Optional[tuple[str, str]]:
    """A quoted ``schema.table`` and one quoted column for the safety suite's write probes."""
    from auto_ontology.utils.sql_identifiers import quoted_identifier

    tables = _base_tables(connector.get_tables())
    if tables is None or tables.empty:
        return None
    columns = connector.get_columns()
    for row in tables.itertuples(index=False):
        own = columns[
            (columns["table_schema"] == row.table_schema)
            & (columns["table_name"] == row.table_name)
        ]
        if own.empty:
            continue
        return (
            connector.qualify(str(row.table_schema), str(row.table_name)),
            quoted_identifier(str(own.iloc[0]["column_name"]), connector.dialect),
        )
    return None


def manifest_from_connector(connector, db_type: str) -> SchemaManifest:
    """Build a SchemaManifest from an auto-ontology connector's metadata frames."""
    import pandas as pd
    from auto_ontology.catalog.extract import extract_tabular_db_data

    start = time.time()
    data = extract_tabular_db_data(connector)
    columns = data["columns"]
    pks = {
        (str(r.table_schema), str(r.table_name), str(r.column_name))
        for r in data["pks"].itertuples(index=False)
    }
    fks = {
        (str(r.table_schema), str(r.table_name), str(r.column_name)): (
            str(r.referenced_table),
            str(r.referenced_column),
        )
        for r in data["fks"].itertuples(index=False)
    }

    tables: list[TableInfo] = []
    for t in _base_tables(data["tables"]).itertuples(index=False):
        schema, table = str(t.table_schema), str(t.table_name)
        own = columns[
            (columns["table_schema"] == schema) & (columns["table_name"] == table)
        ]
        if "ordinal_position" in own.columns:
            own = own.sort_values("ordinal_position")
        cols: list[ColumnInfo] = []
        for c in own.itertuples(index=False):
            name = str(c.column_name)
            ref = fks.get((schema, table, name))
            cols.append(
                ColumnInfo(
                    name=name,
                    data_type=str(c.data_type),
                    nullable=True if pd.isna(c.is_nullable) else bool(c.is_nullable),
                    is_primary_key=(schema, table, name) in pks,
                    foreign_key_table=ref[0] if ref else None,
                    foreign_key_column=ref[1] if ref else None,
                )
            )
        tables.append(
            TableInfo(
                schema_name=schema,
                table_name=table,
                # ponytail: row counts are not in the connector contract; COUNT(*) per table if cadence heuristics need them.
                row_count=0,
                columns=cols,
                primary_key_columns=[c.name for c in cols if c.is_primary_key],
                foreign_keys=[
                    {
                        "column": c.name,
                        "references_table": c.foreign_key_table,
                        "references_column": c.foreign_key_column,
                    }
                    for c in cols
                    if c.foreign_key_table
                ],
            )
        )

    name = str(connector.database_name)
    return SchemaManifest(
        db_type=db_type,
        host=name,
        database=name,
        schemas=sorted({t.schema_name for t in tables}),
        tables=tables,
        total_tables=len(tables),
        total_columns=sum(t.column_count for t in tables),
        total_rows=0,
        introspection_duration_seconds=time.time() - start,
    )
