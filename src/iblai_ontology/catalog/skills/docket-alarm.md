---
name: docket-alarm
description: Docket Alarm court monitoring and analytics platform; lets an agent track docket updates, set filing alerts, and pull judge analytics for motion strategy.
metadata: {"openclaw":{"requires":{"env":["DOCKET_ALARM_USERNAME","DOCKET_ALARM_PASSWORD","DOCKET_ALARM_BASE_URL"]}},"primaryEnv":"DOCKET_ALARM_PASSWORD"}
---

# Docket Alarm

## What it is
Docket Alarm is a legal intelligence platform that monitors federal and state court dockets in real time, provides alerts on new filings and orders, and delivers judge and attorney analytics. Law firms use it to stay current on active cases, identify strategic insights about a judge's motion practice, and research how similar motions have fared before a specific court. It covers PACER federal courts, state courts, the USPTO TTAB, and the ITC.

## When to use this skill
- Setting up docket monitoring alerts for an active federal or state litigation matter
- Retrieving newly filed documents or orders as soon as they appear on the docket
- Pulling judge analytics (motion grant rates, typical ruling timelines, citation preferences) before filing a motion
- Researching similar motion outcomes in the same court to inform brief strategy
- Looking up attorney-before-judge history to understand prior interactions
- Verifying upcoming hearing dates and deadlines from the court's public docket

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `DOCKET_ALARM_USERNAME` - Docket Alarm account username (email)
- `DOCKET_ALARM_PASSWORD` - Docket Alarm account password
- `DOCKET_ALARM_BASE_URL` - API base URL (e.g., `https://www.docketalarm.com`)

## Key operations
- `POST /api/v1/login/` — authenticate and obtain a session token
- `GET /api/v1/docket/` — retrieve docket entries for a case by court and docket number
- `POST /api/v1/alert/` — create or update a docket monitoring alert for a case
- `GET /api/v1/search/` — search for cases by party name, judge, or keyword across supported courts
- `GET /api/v1/judge/` — retrieve judge analytics (motion statistics, average ruling time, citation patterns)
- `GET /api/v1/notifications/` — pull recent docket change notifications for monitored cases

## Notes
- Session tokens are short-lived; re-authenticate at the start of each workflow rather than caching tokens across sessions.
- Docket Alarm's PACER integration incurs pass-through PACER fees for documents not already in its cache; cost-code requests appropriately.
- Judge analytics are statistical summaries based on historical data; they are advisory and should not be the sole basis for litigation strategy.
- State court coverage varies; confirm that the specific court is supported before setting up monitoring alerts.
- Downloaded documents are cached by Docket Alarm and do not re-incur PACER fees on repeat access within the platform.
