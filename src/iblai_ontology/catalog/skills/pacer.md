---
name: pacer
description: PACER/CM-ECF federal court system; lets an agent retrieve docket entries, case schedules, local rules, filed documents, and scheduling orders for federal matters.
metadata: {"openclaw":{"requires":{"env":["PACER_USERNAME","PACER_PASSWORD","PACER_CLIENT_CODE","PACER_BASE_URL"]}},"primaryEnv":"PACER_PASSWORD"}
---

# PACER / CM-ECF

## What it is
PACER (Public Access to Court Electronic Records) and CM/ECF (Case Management/Electronic Case Files) are the U.S. federal judiciary's systems for accessing court dockets and filing documents electronically. PACER provides public access to docket entries, filed documents, case status, and scheduling information across all federal district, appellate, and bankruptcy courts. Access is available via the PACER API and through third-party integrations like CourtListener and Docket Alarm.

## When to use this skill
- Retrieving the current docket for a federal matter to check for new filings or orders
- Pulling scheduling orders, local civil rules, and standing orders for a filing court
- Accessing judge-specific preferences and standing orders before drafting a brief or motion
- Verifying deadlines from a scheduling order and importing them into the docket calendar
- Downloading filed documents (motions, orders, opinions) directly from the federal docket
- Confirming case status, assigned judge, and case type for a federal matter

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `PACER_USERNAME` - registered PACER account username
- `PACER_PASSWORD` - PACER account password
- `PACER_CLIENT_CODE` - optional client/matter billing code for PACER cost allocation
- `PACER_BASE_URL` - PACER API base URL (e.g., `https://pacer.login.uscourts.gov`)

## Key operations
- `POST /services/cso-auth` — authenticate and obtain a PACER session token
- `GET /pcl-public-api/rest/cases/find` — search for federal cases by party name, court, or case number
- `GET /pcl-public-api/rest/cases/{caseId}/docketEntries` — retrieve docket entries for a case
- `GET /pcl-public-api/rest/cases/{caseId}/hearings` — retrieve upcoming hearing schedule
- `GET /pcl-public-api/rest/cases/{caseId}/documents/{docId}` — download a filed document (fees may apply)
- `GET /pcl-public-api/rest/courts/{courtId}/localRules` — retrieve local rules for a specific court

## Notes
- PACER charges $0.10 per page accessed (capped at $3.00 per document); costs accumulate and are billed quarterly — use client/matter codes for accurate cost allocation.
- Judiciary documents contain sensitive case information; only download documents relevant to an active matter and store in the matter's DMS workspace.
- PACER sessions expire; re-authenticate before each request batch.
- The RECAP archive (via CourtListener) provides free access to previously downloaded PACER documents — check there first to avoid redundant fees.
- CM/ECF filing (as opposed to retrieval) requires court-specific credentials separate from the PACER account.
