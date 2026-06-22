---
name: snowflake
description: Snowflake cloud data warehouse - lets an agent execute read-only SQL queries, explore table and schema metadata, and retrieve business intelligence results for reporting and analysis.
metadata: {"openclaw":{"requires":{"env":["SNOWFLAKE_ACCOUNT","SNOWFLAKE_USER","SNOWFLAKE_PASSWORD","SNOWFLAKE_WAREHOUSE","SNOWFLAKE_DATABASE","SNOWFLAKE_SCHEMA","SNOWFLAKE_ROLE"]}},"primaryEnv":"SNOWFLAKE_ACCOUNT"}
---

# Snowflake

## What it is
Snowflake is the leading cloud data warehouse platform, used by enterprise data and analytics teams as the central repository for structured business data. In this segment the data analysis agent uses Snowflake to run ad-hoc SQL queries, retrieve metric snapshots, and explore data model lineage. All access is read-only, routed through a dedicated reporting warehouse to avoid impacting production workloads.

## When to use this skill
- Running a SQL query to answer a business question about revenue, headcount, or operational KPIs
- Exploring available databases, schemas, and tables before constructing a query
- Fetching query results to populate a report or dashboard narrative
- Checking table row counts and last-updated timestamps to assess data freshness
- Validating a metric definition against the underlying table structure

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `SNOWFLAKE_ACCOUNT` - account identifier (e.g. `myorg-myaccount`)
- `SNOWFLAKE_USER` - service account username
- `SNOWFLAKE_PASSWORD` - service account password (or use key-pair; see Notes)
- `SNOWFLAKE_WAREHOUSE` - virtual warehouse to use for query execution
- `SNOWFLAKE_DATABASE` - default database context
- `SNOWFLAKE_SCHEMA` - default schema context
- `SNOWFLAKE_ROLE` - role to assume (should be a read-only reporting role)

## Key operations
- `POST /api/v2/statements` - execute a SQL statement via the Snowflake SQL REST API
- `GET /api/v2/statements/{statementHandle}` - poll for async query results
- `SHOW DATABASES` - list available databases
- `SHOW SCHEMAS IN DATABASE {db}` - list schemas
- `SHOW TABLES IN SCHEMA {db}.{schema}` - list tables with metadata

## Notes
- Always use a dedicated read-only role; never grant ACCOUNTADMIN or SYSADMIN to the service account.
- Set `QUERY_TAG` on each session to identify agent-generated queries in the query history for auditing.
- Credit consumption depends on warehouse size; use XS or S warehouse for reporting queries.
- Key-pair authentication is preferred over password for production; store private key path separately.
- Results larger than 10 MB are returned via pre-signed S3/GCS/Azure URLs in the REST API response.
