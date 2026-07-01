---
name: workiva
description: Workiva (Wdesk) financial reporting and compliance platform; lets an agent draft SEC filings, manage XBRL tagging, track reviewer sign-offs, and retrieve SOX workpaper data.
metadata: {"openclaw":{"requires":{"env":["WORKIVA_CLIENT_ID","WORKIVA_CLIENT_SECRET","WORKIVA_BASE_URL"]}},"primaryEnv":"WORKIVA_CLIENT_ID"}
---

# Workiva

## What it is
Workiva (Wdesk) is the cloud platform used by public companies and financial institutions to produce SEC filings (ADV, 13F, 8-K, 10-K), SOX/ICFR workpapers, and regulatory capital reports. It provides cross-linked data, collaborative review workflows, XBRL inline tagging, and a complete sign-off audit trail required for regulatory submissions and external audits.

## When to use this skill
- Retrieve the status of an in-progress SEC filing and its reviewer sign-off chain
- Pull XBRL tagging validation results and flag outstanding errors before submission
- Access SOX control narratives, process documentation, and evidence cross-references
- Retrieve linked data cells to verify source system values match filing disclosures
- Track section sign-off status and certification deadlines across the filing team
- Export workpaper packages for examination response or audit evidence requests

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `WORKIVA_CLIENT_ID` - OAuth2 client ID issued by Workiva
- `WORKIVA_CLIENT_SECRET` - OAuth2 client secret
- `WORKIVA_BASE_URL` - API base URL (e.g. `https://api.app.wdesk.com`)

## Key operations
- `GET /platform/v1/documents` — list documents in the workspace with status and owner
- `GET /platform/v1/documents/{id}` — retrieve document metadata, version, and sign-off status
- `GET /platform/v1/spreadsheets/{id}/sheets/{sheetId}/cells` — read linked cell values from a spreadsheet
- `GET /platform/v1/tasks` — list open review tasks and due dates
- `POST /platform/v1/documents/{id}/export` — export document to PDF or Word for distribution
- `GET /platform/v1/audit-trail` — retrieve audit events for a document or workspace

## Notes
- The Workiva API uses OAuth2 client credentials flow; tokens expire after 3,600 seconds — implement refresh logic
- XBRL validation is performed server-side; retrieval of tag-level error details requires the Taxonomy Services endpoint
- Write operations (updating cell values, approving tasks) require elevated `document:write` scope — scope down integrations to read-only where possible
- Workiva environments are tenant-isolated; sandbox and production tenants have separate client credentials
