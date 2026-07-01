---
name: imanage
description: iManage Work matter-centric DMS; lets an agent retrieve, file, and version legal work product organized by client and matter workspace.
metadata: {"openclaw":{"requires":{"env":["IMANAGE_CLIENT_ID","IMANAGE_CLIENT_SECRET","IMANAGE_BASE_URL","IMANAGE_CUSTOMER_ID"]}},"primaryEnv":"IMANAGE_CLIENT_SECRET"}
---

# iManage Work

## What it is
iManage Work is the second most widely deployed document management system in the legal industry, providing matter-centric workspaces for document storage, email filing, version control, and knowledge management. Large firms use iManage for its deep integration with Microsoft 365, its KM (knowledge management) profiles, and its robust API. The iManage Work 10 REST API covers documents, workspaces, folders, and search.

## When to use this skill
- Saving or retrieving briefs, contracts, and research memos by client/matter workspace
- Filing emails and attachments directly to a matter folder
- Checking in a new document version after drafting edits
- Searching work product by document type, practice area, or custom profile fields
- Accessing knowledge management workspaces for prior deal comparables or standard forms
- Retrieving version history and author information for audit or comparison purposes

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `IMANAGE_CLIENT_ID` - OAuth 2.0 client ID registered in iManage Control Center
- `IMANAGE_CLIENT_SECRET` - OAuth 2.0 client secret
- `IMANAGE_BASE_URL` - server base URL (e.g., `https://yourfirm.imanage.work`)
- `IMANAGE_CUSTOMER_ID` - iManage customer/tenant identifier

## Key operations
- `GET /work/api/v2/customers/{customerId}/documents/{docId}` — retrieve document metadata
- `POST /work/api/v2/customers/{customerId}/documents` — upload a new document with profile fields
- `GET /work/api/v2/customers/{customerId}/search` — full-text and metadata search
- `GET /work/api/v2/customers/{customerId}/workspaces/{wsId}/folders` — list workspace folder structure
- `POST /work/api/v2/customers/{customerId}/documents/{docId}/versions` — create a new document version
- `GET /work/api/v2/customers/{customerId}/documents/{docId}/versions` — list version history

## Notes
- iManage Work 10 uses OAuth 2.0; tokens expire in 1 hour by default — implement refresh logic.
- Document profile fields (client, matter, class, subclass) are mandatory; consult the firm's profile configuration before uploading.
- iManage Cloud (SaaS) and on-premises deployments have the same REST API but different base URLs and authentication endpoints.
- Email filing via the API attaches `.eml` or `.msg` files; metadata (from, to, subject, sent date) must be included in the profile.
