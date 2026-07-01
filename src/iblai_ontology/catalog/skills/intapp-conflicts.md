---
name: intapp-conflicts
description: Intapp Conflicts firm-wide conflicts management system; lets an agent run new-business conflict searches, retrieve hit reports, and track waiver records.
metadata: {"openclaw":{"requires":{"env":["INTAPP_CLIENT_ID","INTAPP_CLIENT_SECRET","INTAPP_BASE_URL","INTAPP_TENANT_ID"]}},"primaryEnv":"INTAPP_CLIENT_SECRET"}
---

# Intapp Conflicts

## What it is
Intapp Conflicts is the industry-leading conflicts management platform for mid-to-large law firms, providing a centralized database of clients, matters, adverse parties, and related entities. It supports new-business intake conflict searches with fuzzy matching, phonetic matching, and corporate family tree traversal. The Intapp Open Integration Platform API exposes search and record operations for automation.

## When to use this skill
- Running a conflict search when a prospective client or matter is being evaluated for intake
- Identifying all existing matters where a new party is already adverse or related
- Retrieving the full conflict report with hit analysis (exact match, AKA, phonetic, entity hierarchy)
- Checking whether an ethical screen has been established for a specific attorney-matter combination
- Looking up waiver records for a conflict that has been previously identified and cleared
- Searching lateral arrival records for conflicts brought by a newly joined attorney

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `INTAPP_CLIENT_ID` - OAuth 2.0 client ID from the Intapp Integration Platform
- `INTAPP_CLIENT_SECRET` - OAuth 2.0 client secret
- `INTAPP_BASE_URL` - tenant base URL (e.g., `https://yourfirm.intapp.com`)
- `INTAPP_TENANT_ID` - Intapp tenant identifier

## Key operations
- `POST /api/conflicts/v1/search` — submit a new-business conflict search with party names and matter details
- `GET /api/conflicts/v1/search/{searchId}/results` — retrieve conflict search results with hit categorization
- `GET /api/conflicts/v1/matters/{matterId}/parties` — list all parties (clients, adverse, related) on an existing matter
- `GET /api/conflicts/v1/screens` — list active ethical screens and the attorneys subject to them
- `GET /api/conflicts/v1/waivers/{waiverId}` — retrieve a specific waiver record with signatories and scope
- `POST /api/conflicts/v1/waivers` — create a new waiver record after attorney approval

## Notes
- Conflict searches should include all known party name variations, DBAs, and parent/subsidiary entities to maximize match coverage.
- Fuzzy/phonetic matching may return false positives; a human conflicts analyst must review and clear all hits before matter opening.
- Ethical screen records are legally significant under professional responsibility rules; only authorized personnel should create or modify screens.
- Intapp's API is versioned; confirm the firm's deployed version supports the endpoints used.
- Integration with D&B or LexisNexis Corporate Affiliations for entity hierarchy lookups may require a separate credential set.
