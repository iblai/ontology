---
name: westlaw
description: Westlaw (Thomson Reuters) legal research platform; lets an agent search case law, statutes, regulations, and validate citations via KeyCite.
metadata: {"openclaw":{"requires":{"env":["WESTLAW_CLIENT_ID","WESTLAW_CLIENT_SECRET","WESTLAW_BASE_URL"]}},"primaryEnv":"WESTLAW_CLIENT_SECRET"}
---

# Westlaw

## What it is
Westlaw is the premier legal research platform providing access to federal and state case law, statutes, the CFR, secondary sources (Am. Jur., practice guides, law reviews), and the KeyCite citation-validation service. It is used across every practice area for authoritative primary and secondary source research. The Westlaw Edge API exposes search and document retrieval programmatically.

## When to use this skill
- Researching controlling case law on a legal issue by jurisdiction and cause of action
- Retrieving current statutory or regulatory text (U.S. Code, CFR, state codes)
- Running KeyCite to verify that a citation is still good law (checking for red/yellow flags)
- Pulling secondary sources — practice guides, Am. Jur. articles, form books — for a matter
- Looking up UTBMS task codes, local court rules, or SOL rules by jurisdiction
- Generating a formatted citation list from a set of research results

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `WESTLAW_CLIENT_ID` - API client ID issued by Thomson Reuters developer portal
- `WESTLAW_CLIENT_SECRET` - API client secret for token exchange
- `WESTLAW_BASE_URL` - API base URL (e.g., `https://api.westlaw.com`)

## Key operations
- `POST /v1/search` — full-text or Boolean search across a chosen database (e.g., `ALLCASES`, `USCA`, `CFR`)
- `GET /v1/document/{citationOrId}` — retrieve full text of a case, statute, or secondary source
- `GET /v1/keycite/{citation}` — retrieve KeyCite treatment flags, citing references, and headnote-level treatment
- `GET /v1/databases` — list available databases and their identifiers
- `POST /v1/folders/{folderId}/documents` — save a retrieved document to a research folder

## Notes
- Access requires a Westlaw subscription that includes API/developer entitlements; not all firm accounts include API access by default.
- Queries are billed per transaction under many enterprise agreements; avoid broad wildcard searches in loops.
- KeyCite results include a `status` field (`positive`, `warning`, `negative`, `not-reported`); always surface red/yellow flags to the attorney before citing.
- Thomson Reuters provides a sandbox environment with a limited dataset for integration testing.
