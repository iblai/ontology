---
name: oracle-epm-cloud
description: Oracle Enterprise Performance Management (EPM) Cloud - lets an agent read application and dimension metadata, run and monitor data-integration and business-rule jobs, and export financial planning, budgeting, and consolidation data across EPM business processes.
metadata: {"openclaw":{"requires":{"env":["ORACLE_EPM_BASE_URL","ORACLE_EPM_IDENTITY_DOMAIN","ORACLE_EPM_USERNAME","ORACLE_EPM_PASSWORD"]}},"primaryEnv":"ORACLE_EPM_BASE_URL"}
---

# Oracle EPM Cloud

## What it is
Oracle EPM Cloud is Oracle's enterprise performance management suite, covering financial planning and budgeting (Planning / EPBCS), financial close and consolidation (FCCS), account reconciliation (ARCS), profitability and cost management (PCMCS), and tax reporting. Finance and FP&A agents use EPM to read application and dimension metadata, trigger and monitor data-load and business-rule jobs, and export plan-versus-actual data for analysis and reporting. It complements the general ledger (e.g. Oracle ERP, Workday) by holding the planning, consolidation, and management-reporting layer.

## When to use this skill
- Listing the EPM applications and business processes available in a tenant
- Retrieving dimension and member metadata for a Planning or Consolidation app
- Running a data-integration (Data Management / Data Exchange) job and polling its status
- Launching a business rule or ruleset (e.g. an allocation or aggregation) and checking the result
- Exporting plan, budget, forecast, or consolidated actuals data to a file for downstream analysis
- Checking the status of a previously submitted job by job ID

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `ORACLE_EPM_BASE_URL` - tenant REST endpoint, e.g. `https://<tenant>.epm.<region>.ocs.oraclecloud.com`
- `ORACLE_EPM_IDENTITY_DOMAIN` - identity domain the user belongs to
- `ORACLE_EPM_USERNAME` - service user, sent as `<identityDomain>.<username>` for Basic auth
- `ORACLE_EPM_PASSWORD` - service user password

## Key operations
- `GET /interop/rest/{api_version}/applicationsnapshots` - list application snapshots (Migration)
- `GET /HyperionPlanning/rest/{api_version}/applications` - list Planning applications
- `GET /HyperionPlanning/rest/{api_version}/applications/{app}/dimensions` - list dimensions for an app
- `POST /HyperionPlanning/rest/{api_version}/applications/{app}/jobs` - run a job (rule, ruleset, import/export data, refresh cube)
- `GET /HyperionPlanning/rest/{api_version}/applications/{app}/jobs/{jobId}` - poll job status
- `POST /aif/rest/{api_version}/jobs` - run a Data Management / Data Integration job
- `GET /interop/rest/{api_version}/services/runningservices/{jobId}` - check a running interop job

## Notes
- REST calls use Basic authentication; the username must be prefixed with the identity domain (`<identityDomain>.<username>`). OAuth 2.0 is also supported for OCI-Gen2 tenants.
- The `{api_version}` segment differs per API family (e.g. Planning uses `v3`, EPM Automate/interop uses `11.1.2.3.600`); confirm against the tenant's API version endpoint.
- Job-running endpoints are asynchronous: submit returns a job ID, then poll the status endpoint until the job reaches a terminal state.
- Many bulk operations (metadata/data import/export, backups) round-trip files through the tenant inbox/outbox rather than returning data inline.
- Rate and concurrency limits apply per tenant; long-running jobs (consolidations, large data loads) should be polled with backoff rather than tight loops.
- Test against a non-production (test) tenant where available; EPM provisions paired test and production environments.
