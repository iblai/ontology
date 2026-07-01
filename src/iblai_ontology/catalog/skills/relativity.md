---
name: relativity
description: Relativity e-discovery platform; lets an agent manage review workspaces, run searches, track coding decisions, and generate privilege logs and production sets.
metadata: {"openclaw":{"requires":{"env":["RELATIVITY_BASE_URL","RELATIVITY_USERNAME","RELATIVITY_PASSWORD","RELATIVITY_WORKSPACE_ID"]}},"primaryEnv":"RELATIVITY_PASSWORD"}
---

# Relativity

## What it is
Relativity is the industry-standard e-discovery and document review platform used by law firms, corporations, and government agencies. It hosts ESI collections, supports technology-assisted review (TAR/CAL), manages coding workflows (responsive, privilege, hot docs), and orchestrates productions. RelativityOne (cloud) and on-premises Relativity both expose a REST API for workspace and document operations.

## When to use this skill
- Querying document counts and coding status (responsive/privilege/hot) for a review workspace
- Running saved searches or creating new keyword search term reports (STRs)
- Retrieving privilege log data for a specified matter workspace
- Checking TAR/predictive coding scores and review round progress
- Initiating or monitoring a production set build and export
- Reporting hold notice status when integrated with a hold management module

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `RELATIVITY_BASE_URL` - instance base URL (e.g., `https://yourfirm.relativity.one`)
- `RELATIVITY_USERNAME` - service account username
- `RELATIVITY_PASSWORD` - service account password (used in Basic auth for token exchange)
- `RELATIVITY_WORKSPACE_ID` - default workspace artifact ID (can be overridden per matter)

## Key operations
- `POST /Relativity.REST/API/Workspace/{workspaceId}/Search` — execute a keyword or saved search
- `GET /Relativity.REST/API/Workspace/{workspaceId}/Document/{documentId}` — retrieve document metadata and field values
- `POST /Relativity.REST/API/Workspace/{workspaceId}/ProductionSet` — create a production set
- `GET /Relativity.REST/API/Workspace/{workspaceId}/Review/Stats` — retrieve coding progress statistics
- `POST /Relativity.REST/API/Workspace/{workspaceId}/PrivilegeLog/Export` — export privilege log in standard format

## Notes
- RelativityOne uses bearer tokens obtained via `/Identity/connect/token`; tokens expire in 1 hour.
- Workspace artifact IDs are matter-specific; do not hard-code — look up by matter number at runtime.
- Large document exports are asynchronous; poll the job status endpoint until complete before downloading.
- Privilege log exports may contain attorney-client and work-product protected content; restrict to need-to-know personnel.
- Rate limits vary by instance tier; on-premises deployments may have custom throttling configured by IT.
