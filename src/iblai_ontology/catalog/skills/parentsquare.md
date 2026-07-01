---
name: parentsquare
description: ParentSquare — compose, schedule, and send school-to-family communications (mass messages, direct messages, announcements) and read delivery analytics.
metadata: {"openclaw":{"requires":{"env":["PARENTSQUARE_API_KEY","PARENTSQUARE_DISTRICT_ID"]}},"primaryEnv":"PARENTSQUARE_API_KEY"}
---

# ParentSquare

## What it is
ParentSquare is a unified school-to-home communication platform used by thousands of K-12 districts to send mass notifications, newsletters, direct messages, and event announcements to families. It supports email, SMS, app push, voice, and automated translation into family home languages.

## When to use this skill
- Drafting and scheduling mass messages to school or district family groups
- Composing direct messages to individual guardians (e.g., absence follow-up, IEP meeting invitation)
- Creating event announcements with RSVP links for conferences or school activities
- Checking delivery and open-rate analytics on sent communications
- Triggering automated translations of drafted messages before review and send

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `PARENTSQUARE_API_KEY` - API key issued from the ParentSquare district admin portal
- `PARENTSQUARE_DISTRICT_ID` - numeric district identifier used in all API paths

## Key operations
- `POST /api/v3/posts` — create and optionally schedule a school-wide or group post/message
- `POST /api/v3/direct_messages` — send a direct message to a specific guardian
- `GET /api/v3/posts/{id}/stats` — retrieve delivery, open, and click statistics for a sent message
- `GET /api/v3/schools` — list schools and their group IDs for targeting
- `POST /api/v3/posts/{id}/translate` — request automatic translation of a drafted post
- `GET /api/v3/contacts` — look up guardian contact records and communication preferences (read-only)

## Notes
- Messages must be reviewed and approved by an authorized school or district staff member before sending; agents draft, humans send.
- Automated translation is available for common languages (Spanish, Vietnamese, Mandarin, etc.) but flag for human review before distributing.
- COPPA and FERPA apply; do not include personally identifiable student information in mass communications.
- The API enforces per-minute rate limits on message creation; queue bulk operations rather than sending simultaneously.
