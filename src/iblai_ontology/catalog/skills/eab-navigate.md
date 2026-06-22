---
name: eab-navigate
description: EAB Navigate student success platform — lets an agent manage early alerts, advising appointments, four-year plans, and at-risk cohort outreach.
metadata: {"openclaw":{"requires":{"env":["EAB_NAVIGATE_API_KEY","EAB_NAVIGATE_BASE_URL"]}},"primaryEnv":"EAB_NAVIGATE_API_KEY"}
---

# EAB Navigate

## What it is
EAB Navigate is a student success and advising platform used by hundreds of colleges and universities. It centralizes early alert workflows, advising appointment scheduling, four-year degree planning, and at-risk cohort campaigns. Academic advisor and retention agents use it as the primary coordination hub for student support interventions.

## When to use this skill
- Pulling the early alert queue to identify students flagged by instructors for academic or attendance concerns
- Scheduling advising appointments or creating referral appointments on behalf of students
- Updating alert resolution status after an outreach attempt
- Launching a targeted outreach campaign to an at-risk cohort
- Reviewing a student's four-year plan progress and advising appointment history

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `EAB_NAVIGATE_BASE_URL` - institution's Navigate API base URL
- `EAB_NAVIGATE_API_KEY` - API key from Navigate's integration settings

## Key operations
- `GET /api/alerts` — retrieve open early alerts with type, course, instructor, and urgency
- `PATCH /api/alerts/:id` — update alert status (resolved, in-progress, no-contact)
- `POST /api/appointments` — create advising or referral appointment
- `GET /api/students/:id/plans` — retrieve four-year plan and degree progress
- `POST /api/campaigns/outreach` — trigger an outreach campaign for a defined student segment

## Notes
- Navigate's API access requires an institutional data-sharing agreement with EAB; verify integration is enabled before deploying.
- Student record access is governed by FERPA; agents should only surface alert details to the student's assigned advisor or care-team members.
- Appointment creation requires the student's consent flow if initiated on their behalf via an automated agent.
- Some Navigate API features are licensed add-ons; check institutional contract for availability of campaign automation endpoints.
