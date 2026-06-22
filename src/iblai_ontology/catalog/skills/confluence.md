---
name: confluence
description: Confluence team wiki and documentation platform - lets an agent search, read, and create pages across internal knowledge bases, runbooks, technical documentation, and policy spaces.
metadata: {"openclaw":{"requires":{"env":["CONFLUENCE_BASE_URL","CONFLUENCE_USER_EMAIL","CONFLUENCE_API_TOKEN"]}},"primaryEnv":"CONFLUENCE_API_TOKEN"}
---

# Confluence

## What it is
Confluence by Atlassian is the most common enterprise wiki and documentation platform, used by engineering, IT, HR, and operations teams to maintain runbooks, technical design docs, architecture decision records (ADRs), and policy documentation. In this segment, the knowledge agent and engineering agent rely on Confluence to retrieve institutional knowledge and draft or update documentation pages.

## When to use this skill
- Searching for an existing runbook, policy, or technical document by keyword
- Retrieving the full content of a specific Confluence page for summarization
- Checking the last-modified date and author of a page to assess content freshness
- Creating or updating a page with meeting notes, a post-incident review, or onboarding documentation
- Listing pages within a specific space to inventory available documentation

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `CONFLUENCE_BASE_URL` - base URL (e.g. `https://mycompany.atlassian.net/wiki`)
- `CONFLUENCE_USER_EMAIL` - email of the service account
- `CONFLUENCE_API_TOKEN` - API token from the Atlassian account portal

## Key operations
- `GET /rest/api/content/{id}?expand=body.storage` - retrieve page content
- `GET /rest/api/content/search?cql=...` - search pages using CQL (Confluence Query Language)
- `POST /rest/api/content` - create a new page
- `PUT /rest/api/content/{id}` - update an existing page (requires current version number)
- `GET /rest/api/space` - list available spaces
- `GET /rest/api/content?spaceKey=...&type=page` - list pages within a space

## Notes
- Authentication uses HTTP Basic with email + API token (same mechanism as Jira cloud).
- Page body format options: `storage` (XML/HTML) for reading, `wiki` for simplified markup on write.
- CQL (Confluence Query Language) supports `text ~ "keyword"`, `space = "KEY"`, and `ancestor = {page_id}` filters.
- Rate limits mirror Jira cloud: ~1,000 requests/minute per token; reduce frequency for large space crawls.
- Confluence Server/Data Center has a different API base path (`/confluence/rest/api`) and uses PATs instead of API tokens.
