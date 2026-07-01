---
name: salesforce-financial-services-cloud
description: Salesforce CRM for financial advisors and wealth management firms; lets an agent read and write client profiles, household data, suitability records, and onboarding workflow state.
metadata: {"openclaw":{"requires":{"env":["SFDC_FSC_CLIENT_ID","SFDC_FSC_CLIENT_SECRET","SFDC_FSC_USERNAME","SFDC_FSC_PASSWORD","SFDC_FSC_BASE_URL"]}},"primaryEnv":"SFDC_FSC_CLIENT_ID"}
---

# Salesforce Financial Services Cloud

## What it is
Salesforce Financial Services Cloud (FSC) is the industry-specific CRM built for wealth management, banking, and insurance. It extends Salesforce with household relationship maps, financial account objects, suitability records, and advisory workflow automation. Firms use it as the system of record for client relationships, risk profiles, and interaction history.

## When to use this skill
- Retrieve or update a client's investment objectives, risk tolerance, and time horizon
- Look up household relationship maps and linked accounts for advisory conversations
- Log advisory interactions, next actions, or document delivery confirmations
- Track onboarding workflow stage and outstanding items for a new account
- Pull upcoming client review dates, birthday reminders, or workflow tasks
- Create or update household and account records during client onboarding

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `SFDC_FSC_CLIENT_ID` - Connected App OAuth client ID
- `SFDC_FSC_CLIENT_SECRET` - Connected App OAuth client secret
- `SFDC_FSC_USERNAME` - API service account username
- `SFDC_FSC_PASSWORD` - API service account password + security token
- `SFDC_FSC_BASE_URL` - Instance URL (e.g. `https://yourorg.my.salesforce.com`)

## Key operations
- `GET /services/data/vXX.X/sobjects/Account/{id}` — retrieve client or household record
- `GET /services/data/vXX.X/query?q=SELECT...` — SOQL query for client profiles, tasks, notes
- `POST /services/data/vXX.X/sobjects/Task/` — log interaction or create follow-up task
- `PATCH /services/data/vXX.X/sobjects/FinancialAccount/{id}` — update account suitability fields
- `GET /services/data/vXX.X/sobjects/FinancialGoal/` — retrieve financial plan goals

## Notes
- API version should be pinned; FSC objects require API v48.0+ for full Financial Services data model support
- Governor limits: 100,000 SOQL queries per 24-hour period per org; batch inserts limited to 200 records per call
- Use a dedicated integration user with least-privilege FSC permission set; avoid sharing advisor-facing login credentials
- Sandbox environments use a separate `SFDC_FSC_BASE_URL` ending in `.sandbox.my.salesforce.com`
