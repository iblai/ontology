---
name: salesforce-government-cloud
description: FedRAMP High CRM platform for government; lets agents create, read, and update citizen service cases, constituent records, and SLA compliance data.
metadata: {"openclaw":{"requires":{"env":["SALESFORCE_GOV_INSTANCE_URL","SALESFORCE_GOV_CLIENT_ID","SALESFORCE_GOV_CLIENT_SECRET","SALESFORCE_GOV_USERNAME","SALESFORCE_GOV_PASSWORD"]}},"primaryEnv":"SALESFORCE_GOV_CLIENT_SECRET"}
---

# Salesforce Government Cloud

## What it is
Salesforce Government Cloud is a FedRAMP High-authorized deployment of the Salesforce CRM platform used by federal, state, and local agencies for citizen service delivery, case management, and constituent relationship management. It provides a unified view of constituent interactions across phone, web, chat, and in-person channels.

## When to use this skill
- Creating a new citizen service case from an inbound request and routing it to the correct case worker
- Reading or updating the status, notes, and resolution summary on an existing case
- Looking up a constituent's contact record and full case history
- Checking SLA compliance flags for overdue cases nearing or past response/resolution deadlines
- Linking knowledge articles to cases to provide consistent resolution guidance

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `SALESFORCE_GOV_INSTANCE_URL` - agency Salesforce org URL (e.g., `https://agency.my.salesforce.com`)
- `SALESFORCE_GOV_CLIENT_ID` - connected app consumer key
- `SALESFORCE_GOV_CLIENT_SECRET` - connected app consumer secret
- `SALESFORCE_GOV_USERNAME` - API service account username
- `SALESFORCE_GOV_PASSWORD` - API service account password (append security token if required)

## Key operations
- `POST /services/oauth2/token` — obtain OAuth 2.0 access token (username-password or JWT flow)
- `GET /services/data/v60.0/sobjects/Case/{id}` — retrieve a case by Salesforce record ID
- `POST /services/data/v60.0/sobjects/Case` — create a new service case
- `PATCH /services/data/v60.0/sobjects/Case/{id}` — update case status, priority, or resolution notes
- `GET /services/data/v60.0/query?q=SELECT...` — SOQL query for cases, contacts, or entitlements
- `GET /services/data/v60.0/sobjects/Contact/{id}` — retrieve constituent contact record

## Notes
- Government Cloud orgs run in isolated FedRAMP environments; confirm your instance URL is a `.my.salesforce.com` Gov Cloud endpoint, not commercial.
- API rate limits depend on org edition; Government Cloud typically allows 100,000 API calls per 24-hour period per org.
- Case ownership and queue assignments follow agency-specific workflow rules; do not hard-code queue IDs across deployments.
- PII in constituent records is subject to Privacy Act and agency data handling policies; log all automated reads in the audit trail.
