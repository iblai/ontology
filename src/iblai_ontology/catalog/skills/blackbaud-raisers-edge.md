---
name: blackbaud-raisers-edge
description: Blackbaud Raiser's Edge NXT — lets an agent query alumni constituent records, giving history, pledge tracking, and wealth screening scores for advancement workflows.
metadata: {"openclaw":{"requires":{"env":["RAISERS_EDGE_API_KEY","RAISERS_EDGE_CLIENT_ID","RAISERS_EDGE_CLIENT_SECRET","RAISERS_EDGE_BASE_URL","RAISERS_EDGE_REDIRECT_URI"]}},"primaryEnv":"RAISERS_EDGE_API_KEY"}
---

# Blackbaud Raiser's Edge NXT

## What it is
Blackbaud Raiser's Edge NXT is the most widely used fundraising CRM in higher education advancement offices. It stores constituent profiles, lifetime giving history, pledge schedules, event attendance, volunteer records, and wealth screening data. The alumni agent relies on it to personalize donor outreach, track engagement, and support gift officer workflows.

## When to use this skill
- Retrieving an alumnus's giving history, pledge status, and engagement score
- Checking do-not-contact flags and preferred communication channels before outreach
- Logging an interaction record after an alumni outreach touchpoint
- Pulling wealth screening scores to inform solicitation strategy (for gift officers only)
- Surfacing event attendance history to personalize reunion or campaign messaging

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `RAISERS_EDGE_BASE_URL` - Raiser's Edge NXT API base URL (e.g. `https://api.sky.blackbaud.com`)
- `RAISERS_EDGE_API_KEY` - Blackbaud SKY API subscription key from developer portal
- `RAISERS_EDGE_CLIENT_ID` - OAuth 2.0 client ID from Blackbaud developer app registration
- `RAISERS_EDGE_CLIENT_SECRET` - OAuth 2.0 client secret
- `RAISERS_EDGE_REDIRECT_URI` - OAuth redirect URI for authorization code flow

## Key operations
- `GET /constituent/v1/constituents/:id` — full constituent profile with bio and contact data
- `GET /gift/v1/gifts?constituent_id=` — giving history with amounts, dates, and designations
- `GET /constituent/v1/constituents/:id/ratings` — wealth screening scores and capacity ratings
- `POST /constituent/v1/interactions` — log an interaction record (call, email, visit)
- `GET /event/v1/eventattendees?constituent_id=` — event attendance history

## Notes
- Raiser's Edge NXT uses Blackbaud's SKY API platform; access requires both a subscription key (header `Bb-Api-Subscription-Key`) and an OAuth 2.0 bearer token.
- Wealth screening data is highly sensitive; restrict access to authenticated gift officer profiles only — never surface capacity ratings to the constituent directly.
- Do-not-contact and do-not-solicit flags must be checked on every constituent before any outreach action is taken.
- API rate limit: 300 requests per minute per subscription key across all endpoints.
