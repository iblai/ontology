---
name: twenty
description: Twenty CRM - lets an agent read people, companies, opportunities, notes and tasks from a self-hosted or cloud Twenty workspace through its REST API.
metadata: {"openclaw":{"requires":{"env":["TWENTY_API_KEY","TWENTY_BASE_URL"]}},"primaryEnv":"TWENTY_API_KEY"}
---

# Twenty

## What it is
Twenty is an open-source CRM (twenty.com) built around a few standard objects — people, companies, opportunities, notes, tasks, workspace members — plus the custom objects a workspace adds. A self-hosted instance keeps every workspace in its own PostgreSQL schema; a workspace on Twenty's cloud is reached through the REST API only, with an API key created in Settings → APIs.

## When to use this skill
- Listing or searching people and the companies they belong to
- Reading the opportunity pipeline: stage, amount, close date, point of contact
- Reading the notes and tasks attached to a person, company or opportunity

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `TWENTY_API_KEY` - an API key from Settings → APIs, sent as `Authorization: Bearer <key>`; its role decides what is readable
- `TWENTY_BASE_URL` - `https://api.twenty.com` for the cloud, or the self-hosted server URL

## Key operations
- `GET /rest/people` - list people (`limit` up to 200, `starting_after` cursor, `depth=0` for flat records)
- `GET /rest/companies` - list companies
- `GET /rest/opportunities` - list opportunities with stage and amount
- `GET /rest/notes` - list notes; `GET /rest/noteTargets` links them to records
- `GET /rest/tasks` - list tasks; `GET /rest/taskTargets` links them to records
- `GET /rest/workspaceMembers` - list workspace members (owners and assignees)
- `GET /rest/metadata/objects` - the workspace's objects and fields
- `GET /rest/open-api/core` - the OpenAPI document of the workspace
- `POST /rest/people` - create a person

## Notes
- Composite fields come nested (`name: {firstName, lastName}`, `emails: {primaryEmail, additionalEmails}`, `amount: {amountMicros, currencyCode}`); the database column of a sub-field is `<field><SubField>` (`nameFirstName`).
- A list answers `{data: {<plural>: [...]}, totalCount, pageInfo: {hasNextPage, endCursor}}`; page with `starting_after=<endCursor>`.
- Records are soft-deleted (`deletedAt`) and left out of REST lists.
- The same key also opens Twenty's own MCP endpoint, `POST /mcp`.
