---
name: workday-government
description: Cloud HRIS and payroll platform for government; lets agents retrieve employee position data, personnel actions, leave balances, pay information, and performance plan status.
metadata: {"openclaw":{"requires":{"env":["WORKDAY_BASE_URL","WORKDAY_CLIENT_ID","WORKDAY_CLIENT_SECRET","WORKDAY_REFRESH_TOKEN","WORKDAY_RAAS_ENDPOINT"]}},"primaryEnv":"WORKDAY_CLIENT_SECRET"}
---

# Workday Government

## What it is
Workday Government is a FedRAMP-authorized cloud Human Resource Information System (HRIS) used by federal agencies and large state/local governments for HR, payroll, and talent management. It consolidates personnel records, position management, leave tracking, payroll, and performance planning in a single system of record, replacing legacy systems like PeopleSoft and NFC for many agencies.

## When to use this skill
- Retrieving an employee's position details (title, series, grade, duty station, appointment type)
- Checking leave balances (annual, sick, FMLA, LWOP, comp time) for a specific employee
- Reviewing the status of a personnel action request (PAR / SF-52) through the approval chain
- Looking up supervisor assignments, org hierarchy, or FTE counts for an organizational unit
- Accessing SF-50 history, performance ratings, and training completions for a personnel record

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `WORKDAY_BASE_URL` - agency Workday tenant URL (e.g., `https://wd2.myworkday.com/agency`)
- `WORKDAY_CLIENT_ID` - OAuth 2.0 client ID for the registered API client
- `WORKDAY_CLIENT_SECRET` - OAuth 2.0 client secret
- `WORKDAY_REFRESH_TOKEN` - long-lived refresh token for non-interactive API access
- `WORKDAY_RAAS_ENDPOINT` - Report-as-a-Service (RaaS) URL for custom worker data reports

## Key operations
- `POST /ccx/oauth2/{tenant}/token` — exchange refresh token for a short-lived access token
- `GET /api/v1/{tenant}/workers/{id}` — retrieve worker profile including position and job details
- `GET /api/v1/{tenant}/workers/{id}/timeOff/balances` — query leave balances by leave type
- `GET /api/v1/{tenant}/businessProcesses?type=staffing` — list open personnel action workflows and approval status
- `GET {RAAS_ENDPOINT}?format=json` — run a pre-built Report-as-a-Service for bulk org or payroll data
- `GET /api/v1/{tenant}/organizations/{id}/workers` — list workers in an organizational unit

## Notes
- Workday uses a tenant-specific URL structure; all endpoints are prefixed with the agency tenant name.
- Personnel data is Privacy Act-protected; the API service account must be scoped to minimum necessary data domains (e.g., HR Partner, Payroll Administrator).
- RaaS reports must be pre-configured by a Workday Administrator before the agent can query them; coordinate with the agency Workday team.
- Token expiry is typically 1 hour; implement refresh-token rotation in the credential manager.
- Write operations (initiating PARs, changing pay) require advanced security group permissions and are not recommended for automated agent use without human-in-the-loop approval.
