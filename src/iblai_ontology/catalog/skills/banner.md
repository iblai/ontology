---
name: banner
description: Ellucian Banner SIS — lets an agent query student academic records, registration, financial aid awards, and employee HR data via Banner REST APIs.
metadata: {"openclaw":{"requires":{"env":["BANNER_API_KEY","BANNER_BASE_URL","BANNER_CLIENT_ID","BANNER_CLIENT_SECRET"]}},"primaryEnv":"BANNER_API_KEY"}
---

# Banner

## What it is
Ellucian Banner is the most widely deployed Student Information System (SIS) in North American higher education. It is the authoritative source for student enrollment, academic records, degree requirements, financial aid awards, and employee HR data. Banner 9 exposes a REST API layer used by academic advisor, financial aid, retention, and administrative agents.

## When to use this skill
- Retrieving a student's GPA, academic standing, credits earned, and registration status
- Checking financial aid award package, SAP status, and disbursement schedule
- Verifying holds (advising, financial, immunization) that block registration
- Pulling employee records, PTO balances, and onboarding task completion status
- Submitting registration changes (add, drop, swap) on behalf of a student

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `BANNER_BASE_URL` - Banner 9 API base URL (e.g. `https://banner.university.edu/api`)
- `BANNER_API_KEY` - API key issued by the Banner integration admin
- `BANNER_CLIENT_ID` - OAuth 2.0 client ID for token-based auth flows
- `BANNER_CLIENT_SECRET` - OAuth 2.0 client secret

## Key operations
- `GET /student/api/v1/studentAcademicStandings` — academic standing and GPA
- `GET /student/api/v1/registrationStatus` — enrollment and hold status
- `GET /financial-aid/api/v1/awardsByAidYear` — financial aid award package
- `GET /hr/api/v1/employees/:pidm` — employee record fields
- `POST /student/api/v1/registrationRequest` — initiate a registration action

## Notes
- Banner uses PIDM (internal ID) as the primary key; resolve student ID to PIDM before most queries.
- Writes (registration, address updates) require elevated integration credentials and are subject to institutional workflow approval.
- Many Banner instances run behind a campus API gateway (Ellucian Ethos); `BANNER_BASE_URL` may point to the Ethos API layer rather than Banner directly.
- PII data is covered by FERPA; agents must enforce consent before surfacing record details.
