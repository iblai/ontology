"""Generic database adapters (schema discovery only, no pre-built patterns)."""

from __future__ import annotations

from .base import BaseAdapter, register


@register("generic-oracle")
class GenericOracleAdapter(BaseAdapter):
    SYSTEM_NAME = "generic-oracle"
    DB_TYPE = "oracle"


@register("generic-postgres")
class GenericPostgresAdapter(BaseAdapter):
    SYSTEM_NAME = "generic-postgres"
    DB_TYPE = "postgresql"


@register("generic-mysql")
class GenericMySQLAdapter(BaseAdapter):
    SYSTEM_NAME = "generic-mysql"
    DB_TYPE = "mysql"


@register("generic-mssql")
class GenericSQLServerAdapter(BaseAdapter):
    SYSTEM_NAME = "generic-mssql"
    DB_TYPE = "sqlserver"
