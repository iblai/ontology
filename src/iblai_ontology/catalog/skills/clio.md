---
name: clio
description: Clio Manage/Grow practice management platform; lets an agent create matters, log time, generate invoices, manage client intake, and sync docket deadlines.
metadata: {"openclaw":{"requires":{"env":["CLIO_CLIENT_ID","CLIO_CLIENT_SECRET","CLIO_REFRESH_TOKEN","CLIO_BASE_URL"]}},"primaryEnv":"CLIO_REFRESH_TOKEN"}
---

# Clio

## What it is
Clio is the leading cloud-based legal practice management platform, combining matter management, time tracking, billing, client intake (Clio Grow), and trust accounting in one system. Law firms use it as the single source of truth for client records, matter lifecycle, billing, and deadlines. It exposes a REST API covering nearly every object in the platform.

## When to use this skill
- Creating or updating client and matter records after a new intake is confirmed
- Logging time entries and expense entries against a matter
- Generating, finalizing, and delivering invoices; querying AR aging
- Setting up retainer and trust ledger accounts for a new matter
- Creating and updating calendar deadlines and task reminders on a matter
- Retrieving engagement letter templates and billing rate tables

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `CLIO_CLIENT_ID` - OAuth 2.0 client ID for the Clio API app
- `CLIO_CLIENT_SECRET` - OAuth 2.0 client secret for the Clio API app
- `CLIO_REFRESH_TOKEN` - long-lived refresh token obtained after initial OAuth consent
- `CLIO_BASE_URL` - regional base URL (e.g., `https://app.clio.com` for US)

## Key operations
- `GET /api/v4/matters` — list and search matters by client, status, or practice area
- `POST /api/v4/activities` — create a time or expense entry on a matter
- `POST /api/v4/bills` — generate a pre-bill or finalize an invoice
- `GET /api/v4/contacts` — retrieve or search client and opposing-party contact records
- `POST /api/v4/calendar_entries` — create deadline or hearing calendar entries
- `GET /api/v4/trust_ledger_entries` — query trust account transactions

## Notes
- OAuth tokens expire in 24 hours; always use the refresh flow before making requests.
- Clio has separate regional endpoints (US, EU, CA, AU); set `CLIO_BASE_URL` to match the firm's data residency region.
- Rate limit: 10 requests/second per token; back off on 429 responses.
- Sandbox: Clio offers a developer sandbox at `https://app.clio.com` with test credentials — use a separate `CLIO_REFRESH_TOKEN` for sandbox vs. production.
