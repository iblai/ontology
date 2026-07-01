---
name: ironclad
description: Ironclad contract lifecycle management (CLM) platform; lets an agent upload contracts, run playbook analysis, retrieve risk scores, and track obligations and approvals.
metadata: {"openclaw":{"requires":{"env":["IRONCLAD_API_KEY","IRONCLAD_BASE_URL"]}},"primaryEnv":"IRONCLAD_API_KEY"}
---

# Ironclad

## What it is
Ironclad is a leading contract lifecycle management (CLM) platform used by legal teams to manage the full contract lifecycle — from creation and negotiation to execution and obligation tracking. It enforces standard playbooks, generates redlines against approved positions, and extracts key metadata and obligations from contracts. The Ironclad API supports document operations, playbook execution, and workflow management.

## When to use this skill
- Uploading a third-party paper contract for AI-assisted playbook review and deviation flagging
- Retrieving playbook results showing which clauses deviate from the firm's standard positions
- Accessing the obligation register for a contract to surface upcoming deadlines
- Tracking the approval workflow status for a contract under negotiation
- Retrieving the contract metadata (parties, term, governing law, auto-renewal date) for a matter
- Comparing a received redline against the firm's approved fallback language

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `IRONCLAD_API_KEY` - API key generated in the Ironclad admin settings
- `IRONCLAD_BASE_URL` - tenant base URL (e.g., `https://api.ironcladapp.com`)

## Key operations
- `POST /v1/records` — create a new contract record and upload a document for processing
- `GET /v1/records/{recordId}` — retrieve contract metadata, playbook results, and risk score
- `GET /v1/records/{recordId}/workflow` — retrieve approval workflow status and approver actions
- `GET /v1/records/{recordId}/obligations` — list extracted obligations with due dates and owners
- `POST /v1/records/{recordId}/comments` — add a review comment or redline note to a contract
- `GET /v1/workflows` — list active workflow templates (playbooks) available for a contract type

## Notes
- API authentication uses a static API key passed as a bearer token; rotate keys periodically and store in the credentials file only.
- Document processing (playbook analysis) is asynchronous; poll `GET /v1/records/{recordId}` until `status` is `ready` before reading results.
- Ironclad workflows are configured per contract type; ensure the correct workflow template ID is specified when creating a record.
- Risk scores and deviation flags are advisory; attorneys must review all flagged provisions before approving.
- Ironclad offers a sandbox environment accessible with a separate API key for integration development.
