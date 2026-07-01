---
name: frontline
description: Frontline Education suite — access HR, absence management, professional development, and special education data across Frontline's K-12 platform products.
metadata: {"openclaw":{"requires":{"env":["FRONTLINE_CLIENT_ID","FRONTLINE_CLIENT_SECRET","FRONTLINE_BASE_URL"]}},"primaryEnv":"FRONTLINE_CLIENT_ID"}
---

# Frontline Education

## What it is
Frontline Education provides a suite of SaaS platforms purpose-built for K-12 district operations, including Frontline Central (HR and recruiting), Frontline Absence Management (substitute management), Frontline Professional Growth (PD tracking), and Frontline Special Ed & Interventions (IEP management). All products share a common SSO and API gateway.

## When to use this skill
- Retrieving teacher PD transcript hours, course completions, and certification credit types for PD planning
- Checking position vacancies, employee certification status, and hiring pipeline for HR reporting
- Reading daily absence counts and substitute fill rates for administration dashboards
- Accessing IEP goal text, eligibility dates, placement type, and progress notes for special education support
- Reading observation rubric scores and growth goals (read-only) to inform PD recommendations

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `FRONTLINE_BASE_URL` - Frontline API gateway base URL (e.g. `https://api.frontlineeducation.com`)
- `FRONTLINE_CLIENT_ID` - OAuth2 client ID issued by Frontline for the district integration
- `FRONTLINE_CLIENT_SECRET` - OAuth2 client secret; store in secrets manager, never in plaintext config

## Key operations
- `GET /professional-growth/transcripts/{employee_id}` — fetch PD credit hours and course completions
- `GET /absence-management/absences` — query daily absence log with reason codes and fill status
- `GET /central/employees/{id}` — retrieve employee profile including certifications and evaluation scores
- `GET /special-ed/ieps/{student_id}` — read IEP document with goals, accommodations, and services
- `GET /special-ed/ieps/{student_id}/progress-notes` — retrieve periodic progress monitoring entries
- `GET /evaluation/observations/{employee_id}` — read-only access to observation ratings and feedback notes

## Notes
- IEP data is protected under both FERPA and IDEA; access must be limited to staff with an educational need.
- Frontline uses product-scoped OAuth tokens; a single client credential does not grant access to all products — request only the product scopes needed.
- The Special Ed API is read-only for the agent; IEP documents must be reviewed and finalized by qualified staff.
- Rate limits and SLA tiers vary by product; check the Frontline developer portal for current quotas.
