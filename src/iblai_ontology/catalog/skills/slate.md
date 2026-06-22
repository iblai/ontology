---
name: slate
description: Technolutions Slate CRM — lets an agent read and write prospect, applicant, and admitted-student records and trigger enrollment communication workflows.
metadata: {"openclaw":{"requires":{"env":["SLATE_API_KEY","SLATE_BASE_URL"]}},"primaryEnv":"SLATE_API_KEY"}
---

# Slate

## What it is
Slate by Technolutions is the dominant CRM and admissions platform in higher education. It manages the full enrollment funnel from first inquiry through enrollment confirmation: prospect capture, application review, communications, event registrations, and yield tracking. It is used by enrollment, application-reader, prospective-student, and yield agents.

## When to use this skill
- Capturing a new prospect's contact info and program interest from a chatbot conversation
- Retrieving a complete application record including essays, test scores, and recommendations
- Logging yield outreach interactions and updating a student's decision stage
- Querying segment lists for targeted communication campaigns
- Pulling cohort statistics for percentile benchmarking during application review

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `SLATE_BASE_URL` - institution's Slate instance URL (e.g. `https://apply.university.edu`)
- `SLATE_API_KEY` - Slate REST API key issued under Configuration > API

## Key operations
- `POST /manage/query/run` — execute a saved Slate query to retrieve prospect or applicant record sets
- `POST /manage/service/` — write interaction records, update field values, and advance funnel stage
- `GET /manage/lookup/query` — resolve a person record by email or student ID
- `POST /manage/export/` — bulk export applicant data for cohort benchmarking
- Webhook inbound: Slate can push application status change events to the agent endpoint

## Notes
- Slate's API is query-based rather than RESTful resource-based; most reads use the Query endpoint with a saved query GUID.
- Never write directly to the source-of-record application fields without institutional approval; use interaction/note records for agent-generated data.
- Test environment is a separate Slate instance; configure `SLATE_BASE_URL` accordingly for sandbox testing.
- FERPA applies to all applicant data; limit field retrieval to only the fields the agent's task requires.
