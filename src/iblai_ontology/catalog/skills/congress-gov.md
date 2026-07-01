---
name: congress-gov
description: Official U.S. Congress legislative data API; lets agents search bills, retrieve full text and status, track co-sponsors, committee referrals, and floor votes.
metadata: {"openclaw":{"requires":{"env":["CONGRESS_GOV_API_KEY"]}},"primaryEnv":"CONGRESS_GOV_API_KEY"}
---

# Congress.gov API

## What it is
The Congress.gov API is the official public data interface provided by the Library of Congress for U.S. legislative data. It covers all bills, resolutions, amendments, committee activity, Congressional Record entries, and member information from the 93rd Congress (1973) to the present. Legislative affairs agents rely on it as the authoritative source for federal bill tracking and legislative analysis.

## When to use this skill
- Searching for bills by keyword, subject area, sponsor, or Congress session
- Retrieving full bill text, summary, and all legislative actions for a specific bill number
- Checking committee referrals, hearing schedules, and markup results
- Monitoring floor actions, recorded votes, and amendment activity
- Tracking the sponsorship and co-sponsorship patterns for a piece of legislation

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `CONGRESS_GOV_API_KEY` - API key obtained from the Congress.gov API registration portal (`api.congress.gov`)

## Key operations
- `GET /v3/bill` — search bills with filters for Congress, bill type, offset/limit, and sort order
- `GET /v3/bill/{congress}/{billType}/{billNumber}` — retrieve full bill record including status and summary
- `GET /v3/bill/{congress}/{billType}/{billNumber}/text` — list available text versions with format URLs
- `GET /v3/bill/{congress}/{billType}/{billNumber}/actions` — retrieve chronological action history
- `GET /v3/bill/{congress}/{billType}/{billNumber}/cosponsors` — list co-sponsors with sponsorship date
- `GET /v3/bill/{congress}/{billType}/{billNumber}/committees` — show committee referrals and activity
- `GET /v3/member/{bioguideId}` — retrieve member profile and sponsored legislation list

## Notes
- API key is free; register at `api.congress.gov` with a `.gov` or organizational email.
- Rate limit: 5,000 requests/hour per API key.
- Full bill text is linked via URL in the text endpoint; retrieve the document directly from the provided CDN URL (no key needed for the text file itself).
- Bill status descriptions (e.g., "Became Law") are human-readable strings, not machine codes; parse with care in automated pipelines.
