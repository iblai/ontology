---
name: granicus-govdelivery
description: Government digital communications platform; lets agents draft, schedule, and send subscriber email/SMS bulletins and retrieve delivery analytics.
metadata: {"openclaw":{"requires":{"env":["GRANICUS_API_BASE_URL","GRANICUS_API_TOKEN"]}},"primaryEnv":"GRANICUS_API_TOKEN"}
---

# Granicus / GovDelivery

## What it is
Granicus (formerly GovDelivery) is the leading digital communications platform purpose-built for government agencies. It manages subscriber lists, sends email and SMS bulletins to opted-in constituents, and provides engagement analytics. Used by thousands of federal, state, and local agencies to deliver service notifications, emergency updates, and public information campaigns.

## When to use this skill
- Drafting and scheduling email or SMS bulletins to subscriber lists on a specific topic
- Sending immediate notifications for service disruptions, emergency updates, or deadline reminders
- Looking up subscriber counts, topic subscriptions, and list growth metrics
- Retrieving delivery analytics (open rates, click-through rates, bounces, unsubscribes) for a recent bulletin
- Managing topic subscriptions and public subscribe page configurations

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `GRANICUS_API_BASE_URL` - agency Granicus API base URL (e.g., `https://api.govdelivery.com`)
- `GRANICUS_API_TOKEN` - bearer token issued from the Granicus admin console

## Key operations
- `GET /api/account/bulletins` — list recent bulletins with status and send dates
- `POST /api/account/bulletins` — create a new email or SMS bulletin draft
- `POST /api/account/bulletins/{id}/publish` — publish/send a draft bulletin immediately
- `POST /api/account/bulletins/{id}/schedule` — schedule a bulletin for future delivery
- `GET /api/account/topics` — list subscriber topics with counts and category assignments
- `GET /api/account/bulletins/{id}/stats` — retrieve open rate, CTR, bounce, and unsubscribe counts
- `GET /api/account/subscribers` — look up subscriber record by email address

## Notes
- Bulletins sent via the API bypass the CMS workflow approval step; agencies should implement a supervisor approval gate before calling the publish endpoint.
- SMS messages are subject to TCPA regulations and carrier delivery rate limits; confirm opt-in compliance with the agency legal counsel.
- The API uses account-scoped authentication; each Granicus account corresponds to one agency or sub-agency deployment.
- Rate limit: not publicly documented; follow exponential back-off on 429 responses and avoid bulk send loops.
