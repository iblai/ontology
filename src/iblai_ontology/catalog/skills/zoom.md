---
name: zoom
description: Zoom video conferencing platform - lets an agent retrieve meeting metadata, participant lists, cloud recording URLs, and auto-generated transcripts to support meeting intelligence workflows.
metadata: {"openclaw":{"requires":{"env":["ZOOM_ACCOUNT_ID","ZOOM_CLIENT_ID","ZOOM_CLIENT_SECRET"]}},"primaryEnv":"ZOOM_ACCOUNT_ID"}
---

# Zoom

## What it is
Zoom is the dominant enterprise video conferencing platform, used across organizations for internal meetings, customer calls, and all-hands events. In this segment the meeting agent uses Zoom to fetch recording links, retrieve auto-generated transcripts, and pull participant metadata so it can generate meeting summaries and extract action items without requiring manual upload of recordings.

## When to use this skill
- Retrieving the cloud recording URL and transcript for a completed meeting
- Listing recent meetings for a user to identify which ones need recaps
- Fetching participant join/leave times and attendance duration for a meeting report
- Checking whether a recording has finished processing before attempting to retrieve the transcript
- Pulling meeting topic, host, and scheduled time for calendar context enrichment

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `ZOOM_ACCOUNT_ID` - Zoom account ID (from Server-to-Server OAuth app)
- `ZOOM_CLIENT_ID` - OAuth app client ID
- `ZOOM_CLIENT_SECRET` - OAuth app client secret

## Key operations
- `POST /oauth/token?grant_type=account_credentials` - obtain access token via Server-to-Server OAuth
- `GET /v2/users/{userId}/recordings` - list cloud recordings for a user
- `GET /v2/meetings/{meetingId}/recordings` - get recording files and transcript download URLs
- `GET /v2/report/meetings/{meetingId}/participants` - get participant report
- `GET /v2/users/{userId}/meetings?type=previous_meetings` - list past meetings

## Notes
- Use Server-to-Server OAuth (not JWT, which was deprecated in June 2023) for production integrations.
- Auto-generated transcripts require the "Audio Transcript" setting to be enabled in the Zoom account admin.
- Transcript download URLs are pre-signed and time-limited; download and process immediately.
- Cloud recordings are deleted after the account's retention period (default 30 days); check before fetching.
- Rate limits: 30 requests/second per token; recording endpoints have lower sub-limits. Implement exponential backoff.
