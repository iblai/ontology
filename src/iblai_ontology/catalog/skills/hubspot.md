---
name: hubspot
description: HubSpot CRM and Marketing Hub - lets an agent read and update deals, contacts, companies, marketing campaigns, and workflow enrollments across the inbound sales and marketing lifecycle.
metadata: {"openclaw":{"requires":{"env":["HUBSPOT_ACCESS_TOKEN"]}},"primaryEnv":"HUBSPOT_ACCESS_TOKEN"}
---

# HubSpot

## What it is
HubSpot is a widely adopted CRM and inbound marketing platform used by enterprise sales, marketing, and customer success teams. In this segment the sales enablement and marketing agents use HubSpot to retrieve deal stage and pipeline context, look up contact and company records, review campaign performance metrics, and check marketing workflow enrollment status. It complements Salesforce in organizations that use both platforms.

## When to use this skill
- Looking up a deal's current stage, associated contacts, and close date for deal prep
- Searching for a company or contact record to understand the engagement history
- Retrieving marketing campaign performance (sessions, contacts generated, influenced revenue)
- Checking workflow enrollment status or step completion for a marketing sequence
- Reading email asset open and click rates to assess campaign effectiveness

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `HUBSPOT_ACCESS_TOKEN` - private app access token (preferred over legacy API keys)

## Key operations
- `GET /crm/v3/objects/deals/{dealId}` - retrieve a deal record
- `GET /crm/v3/objects/contacts/search` - search contacts by email or property
- `GET /crm/v3/objects/companies/{companyId}` - retrieve a company record
- `GET /marketing/v3/campaigns` - list marketing campaigns
- `GET /automation/v4/flows/{workflowId}` - retrieve workflow definition and enrollment counts
- `POST /crm/v3/objects/notes` - log a note against a CRM record

## Notes
- Use private app access tokens; legacy API keys were deprecated in November 2022.
- Rate limit: 110 requests/10 seconds and 150,000/day for free/starter; higher tiers have higher limits.
- CRM search endpoint supports filtering, sorting, and property selection to minimize response payload.
- HubSpot has a sandbox portal (developer test account) separate from production; use for non-production testing.
- Association APIs are needed to traverse relationships between deals, contacts, and companies.
