---
name: zendesk
description: Zendesk customer service platform - lets an agent create, read, update, and search support tickets, manage user records, apply macros, and retrieve CSAT survey results.
metadata: {"openclaw":{"requires":{"env":["ZENDESK_SUBDOMAIN","ZENDESK_EMAIL","ZENDESK_API_TOKEN"]}},"primaryEnv":"ZENDESK_API_TOKEN"}
---

# Zendesk

## What it is
Zendesk is a widely used customer service and ticketing platform, serving as the primary helpdesk for customer-facing support teams in this segment. The customer support agent uses Zendesk to open and update tickets on behalf of customers, retrieve account and organization context tied to a requester, apply canned response macros, and monitor SLA compliance. It is also used to fetch CSAT scores and tag tickets for quality analysis.

## When to use this skill
- Creating a new support ticket from a customer inquiry
- Updating ticket status, priority, or assignee during an escalation
- Searching for existing tickets from a customer to understand their issue history
- Applying a macro (canned response template) to a ticket
- Retrieving CSAT rating and comments for a resolved ticket
- Looking up a customer's organization record for account context

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `ZENDESK_SUBDOMAIN` - Zendesk subdomain (e.g. `mycompany` for `mycompany.zendesk.com`)
- `ZENDESK_EMAIL` - email of the agent/service account performing API calls
- `ZENDESK_API_TOKEN` - API token from the Zendesk Admin Center

## Key operations
- `GET /api/v2/tickets/{ticket_id}` - retrieve a ticket by ID
- `POST /api/v2/tickets` - create a new ticket
- `PUT /api/v2/tickets/{ticket_id}` - update ticket fields
- `GET /api/v2/search?query=...` - full-text search across tickets, users, and orgs
- `POST /api/v2/tickets/{ticket_id}/macros/apply/{macro_id}` - apply a macro to a ticket
- `GET /api/v2/users/{user_id}` - retrieve a user (requester) profile

## Notes
- Authenticate with `{email}/token:{api_token}` using HTTP Basic.
- Rate limit is 700 requests/minute across all endpoints for Enterprise plans; lower tiers have stricter limits.
- Ticket side-loads (e.g., `?include=users,organizations`) reduce round-trips but count as additional data points toward rate limits.
- Sandbox Zendesk instances have separate subdomains; never write test tickets to production.
- Attachments in tickets are retrieved via pre-signed URLs and expire after 24 hours.
