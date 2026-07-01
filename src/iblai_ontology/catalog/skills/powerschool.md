---
name: powerschool
description: PowerSchool SIS — read and write student records, enrollment, attendance, grades, and demographic data for K-12 school and district operations.
metadata: {"openclaw":{"requires":{"env":["POWERSCHOOL_CLIENT_ID","POWERSCHOOL_CLIENT_SECRET","POWERSCHOOL_BASE_URL"]}},"primaryEnv":"POWERSCHOOL_CLIENT_ID"}
---

# PowerSchool

## What it is
PowerSchool is the most widely deployed Student Information System (SIS) in K-12 education, used by thousands of districts to manage student enrollment, attendance, scheduling, gradebooks, demographics, and state reporting. It provides a REST API and legacy PowerQuery interface for programmatic access to student and staff records.

## When to use this skill
- Resolving a student's grade level, enrollment status, or school assignment from a session context
- Pulling class roster size, ELL percentage, or IEP counts for lesson planning or differentiation
- Reading gradebook data (scores, missing assignments, category weights) for tutoring context
- Retrieving guardian contact information and communication preferences for family outreach
- Generating attendance summaries, chronic absenteeism rates, or demographic extracts for admin reporting

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `POWERSCHOOL_BASE_URL` - base URL of the district's PowerSchool instance (e.g. `https://district.powerschool.com`)
- `POWERSCHOOL_CLIENT_ID` - OAuth2 client ID from the PowerSchool plugin/API setup
- `POWERSCHOOL_CLIENT_SECRET` - OAuth2 client secret; never log or expose this value

## Key operations
- `POST /oauth/access_token` — obtain a bearer token using client_credentials grant
- `GET /ws/v1/student/{id}` — fetch individual student profile (demographics, enrollment, grade)
- `GET /ws/v1/school/{id}/student` — enumerate enrolled students for a school
- `GET /ws/v1/section/{id}/attendance` — retrieve section-level attendance records
- `GET /ws/v1/student/{id}/grades` — read current gradebook scores and missing flags
- `GET /ws/v1/guardian` — look up authorized guardian contacts and communication preferences

## Notes
- All student data is FERPA-protected; only staff with a legitimate educational interest may query it.
- The API enforces scope-based permissions; request only the scopes required for the task.
- PowerSchool rate limits OAuth tokens; cache the access token until expiry rather than requesting a new one per call.
- On-premises deployments may sit behind a VPN; confirm network egress rules before enabling.
