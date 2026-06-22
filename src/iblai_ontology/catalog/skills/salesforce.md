---
name: salesforce
description: Salesforce CRM and Sales Cloud - lets an agent read and write opportunities, accounts, contacts, cases, and activities across the enterprise revenue and support lifecycle.
metadata: {"openclaw":{"requires":{"env":["SALESFORCE_CLIENT_ID","SALESFORCE_INSTANCE_URL","SALESFORCE_CLIENT_SECRET","SALESFORCE_USERNAME","SALESFORCE_PASSWORD","SALESFORCE_SECURITY_TOKEN"]}},"primaryEnv":"SALESFORCE_CLIENT_ID"}
---

# Salesforce

## What it is
Salesforce is the world's leading CRM platform, used by enterprise sales, marketing, and support teams to manage customer relationships, revenue pipelines, and service cases. In this segment it serves as the authoritative system of record for accounts, deals, and customer interactions. Agents use it to surface deal context, log activity, track cases, and correlate campaign attribution with closed revenue.

## When to use this skill
- Retrieving opportunity stage, amount, close date, or forecast category for a deal
- Looking up account details, contact profiles, or activity history for a prospect or customer
- Creating or updating a Service Cloud case on behalf of a customer support interaction
- Correlating marketing campaign data with pipeline influence and won revenue
- Checking entitlement records to determine support tier and SLA for an account

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `SALESFORCE_INSTANCE_URL` - base URL of the Salesforce org (e.g. `https://mycompany.my.salesforce.com`)
- `SALESFORCE_CLIENT_ID` - connected app consumer key
- `SALESFORCE_CLIENT_SECRET` - connected app consumer secret
- `SALESFORCE_USERNAME` - service account login email
- `SALESFORCE_PASSWORD` - service account password
- `SALESFORCE_SECURITY_TOKEN` - API security token appended to password for login flow

## Key operations
- `GET /services/data/vXX.0/sobjects/Opportunity/{id}` - fetch opportunity record
- `GET /services/data/vXX.0/query?q=SELECT+...` - run SOQL query
- `PATCH /services/data/vXX.0/sobjects/Case/{id}` - update a support case
- `POST /services/data/vXX.0/sobjects/Task` - log an activity
- `GET /services/data/vXX.0/sobjects/Account/{id}` - retrieve account details

## Notes
- Use OAuth 2.0 JWT Bearer or username-password flow; prefer JWT for server-to-server.
- API version should match org version; default to `v59.0` unless org is older.
- Respect field-level security; queries against restricted fields return empty, not errors.
- Daily API limit is 15,000 calls per license for Enterprise edition; bulk queries count as one call.
- Sandbox orgs use `https://test.salesforce.com` for auth; set `SALESFORCE_INSTANCE_URL` accordingly.
