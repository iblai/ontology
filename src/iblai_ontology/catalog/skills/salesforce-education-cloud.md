---
name: salesforce-education-cloud
description: Salesforce Education Cloud and NPSP — lets an agent query and update enrollment CRM records, alumni giving history, campaign membership, and engagement scores.
metadata: {"openclaw":{"requires":{"env":["SALESFORCE_CLIENT_ID","SALESFORCE_CLIENT_SECRET","SALESFORCE_INSTANCE_URL","SALESFORCE_USERNAME","SALESFORCE_PASSWORD"]}},"primaryEnv":"SALESFORCE_CLIENT_ID"}
---

# Salesforce Education Cloud

## What it is
Salesforce Education Cloud (and its Nonprofit Success Pack variant used by advancement offices) is widely deployed at universities for enrollment management and alumni/donor relations. It provides contact records, campaign management, engagement scoring, and next-best-action recommendations. Enrollment and alumni agents use it to drive personalized outreach at Salesforce-based institutions.

## When to use this skill
- Querying prospect or alumni contact records by program, geography, or giving history
- Updating campaign membership and recording communication touchpoints
- Pulling engagement scores and next-best-action recommendations for a prospect
- Tracking opportunity (gift) records and recurring donation schedules
- Retrieving constituent household records and wealth screening scores

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `SALESFORCE_INSTANCE_URL` - org instance URL (e.g. `https://university.my.salesforce.com`)
- `SALESFORCE_CLIENT_ID` - Connected App consumer key
- `SALESFORCE_CLIENT_SECRET` - Connected App consumer secret
- `SALESFORCE_USERNAME` - integration user's Salesforce username
- `SALESFORCE_PASSWORD` - integration user's password + security token combined

## Key operations
- `GET /services/data/vXX.0/query?q=SELECT...` — SOQL query on any object (Contact, Lead, Opportunity, CampaignMember)
- `POST /services/data/vXX.0/sobjects/Task` — log a communication activity
- `PATCH /services/data/vXX.0/sobjects/Contact/:id` — update contact fields
- `POST /services/data/vXX.0/sobjects/CampaignMember` — add contact to a campaign
- `GET /services/data/vXX.0/sobjects/Opportunity` — retrieve gift/opportunity records

## Notes
- API rate limits: 15,000 calls per 24 hours per org on most editions; Enterprise/Unlimited tiers are higher.
- Use the OAuth 2.0 JWT Bearer flow for server-to-server integrations rather than username/password where possible.
- NPSP objects (npo02__Household_Account__c, npsp__Allocation__c) are custom and require the NPSP namespace prefix in SOQL.
- All alumni and donor data is subject to institutional privacy policy and applicable fundraising regulations.
