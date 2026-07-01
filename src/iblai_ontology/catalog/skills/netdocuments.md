---
name: netdocuments
description: NetDocuments cloud DMS; lets an agent store, retrieve, version, and search matter documents including briefs, contracts, and precedents.
metadata: {"openclaw":{"requires":{"env":["NETDOCUMENTS_CLIENT_ID","NETDOCUMENTS_CLIENT_SECRET","NETDOCUMENTS_REFRESH_TOKEN","NETDOCUMENTS_BASE_URL"]}},"primaryEnv":"NETDOCUMENTS_REFRESH_TOKEN"}
---

# NetDocuments

## What it is
NetDocuments is the leading cloud-based document management system (DMS) for law firms, providing secure matter-centric document storage, full-text search, version control, and collaboration. It is the authoritative repository for all firm work product — briefs, contracts, correspondence, research memos, and templates. NetDocuments exposes a REST API (ndOffice API) for document and workspace operations.

## When to use this skill
- Saving a completed draft brief, memo, or contract to the correct matter workspace
- Retrieving a prior filing, form template, or precedent document by matter number or document ID
- Checking in or checking out a document for editing and creating a new version
- Searching full text or metadata across a practice area or matter workspace for relevant precedents
- Linking related documents (amendments, exhibits, schedules) to a parent contract record
- Verifying the latest approved version of an engagement letter or standard form

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `NETDOCUMENTS_CLIENT_ID` - OAuth 2.0 client ID from the NetDocuments developer portal
- `NETDOCUMENTS_CLIENT_SECRET` - OAuth 2.0 client secret
- `NETDOCUMENTS_REFRESH_TOKEN` - refresh token obtained after initial OAuth consent flow
- `NETDOCUMENTS_BASE_URL` - repository base URL (e.g., `https://vault.netvoyage.com`)

## Key operations
- `GET /v1/Document/{docId}` — retrieve document metadata and download URL
- `POST /v1/Document` — upload a new document to a cabinet/folder
- `PUT /v1/Document/{docId}/Content` — check in a new version of an existing document
- `GET /v1/Search` — full-text or profile-field search across cabinets
- `GET /v1/Folder/{folderId}/Documents` — list documents in a matter workspace folder
- `POST /v1/Document/{docId}/Checkout` — check out a document for exclusive editing

## Notes
- OAuth access tokens expire in 1 hour; use the refresh token to obtain a new one automatically.
- NetDocuments enforces cabinet- and folder-level ACLs; the service account must be provisioned with appropriate access per matter.
- Document profile fields (client number, matter number, document type) are required on upload; missing profile fields will cause the document to land in a default catch-all folder.
- The EU-hosted repository uses `https://eu.netdocuments.com`; set `NETDOCUMENTS_BASE_URL` to match the firm's data residency region.
