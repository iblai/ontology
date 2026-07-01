---
name: federal-register
description: Official U.S. rulemaking and regulatory publication API; lets agents search and retrieve federal rules, proposed rules, notices, and executive orders with full text and comment period data.
metadata: {"openclaw":{"requires":{"env":["FEDERAL_REGISTER_API_BASE_URL"]}}}
---

# Federal Register API

## What it is
The Federal Register API (federalregister.gov) provides structured programmatic access to the daily journal of U.S. federal government rules, proposed rules, notices, and presidential documents. It is maintained by the Office of the Federal Register (National Archives). Legislative affairs, compliance, and knowledge agents use it to track active rulemaking, retrieve current regulations, and monitor comment periods.

## When to use this skill
- Tracking rulemaking actions (NOPRs, interim final rules, final rules) affecting agency programs
- Retrieving full text of a specific rule or notice by document number or CFR citation
- Identifying open public comment periods for proposed rules in a program area
- Monitoring the Unified Regulatory Agenda for planned agency rulemaking actions
- Retrieving executive orders and presidential documents by date or subject

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `FEDERAL_REGISTER_API_BASE_URL` - base URL (default: `https://www.federalregister.gov/api/v1`)

> Note: The Federal Register API is public and does not require an API key.

## Key operations
- `GET /documents` — search documents by agency, type, date range, CFR part, or keyword
- `GET /documents/{document_number}` — retrieve full details for a specific document number
- `GET /documents/{document_number}.json` — fetch structured JSON with full text, CFR references, and docket ID
- `GET /agencies` — list agencies with their short slugs for filtering
- `GET /public-inspection/current.json` — retrieve documents on public inspection (pre-publication)
- `POST /documents/search.json` — advanced search with multiple filters, field selection, and pagination

## Notes
- No authentication required; the API is fully open.
- Default rate limit: approximately 1,000 requests/hour; use respectful polling intervals.
- Full document text is available in the `full_text_xml_url` or `body_html_url` fields; plain-text extraction may require HTML stripping.
- The Unified Regulatory Agenda is published twice yearly (spring/fall) and is best retrieved from `regulations.gov` or `reginfo.gov` for structured RIN data.
- Document numbers follow the format `YYYY-NNNNN`; CFR citations use standard Title-Part-Section notation.
