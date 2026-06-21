---
name: workday
description: Workday HCM and Workday Student — lets an agent retrieve employee records, student financial aid awards, and initiate HR self-service workflows.
metadata: {"openclaw":{"requires":{"env":["WORKDAY_CLIENT_ID","WORKDAY_CLIENT_SECRET","WORKDAY_BASE_URL","WORKDAY_TENANT"]}},"primaryEnv":"WORKDAY_CLIENT_ID"}
---

# Workday

## What it is
Workday is an enterprise cloud platform used by many universities for both HR (HCM) and student records (Workday Student). As an HCM system it manages employee positions, payroll, benefits, and onboarding. As a student system it handles enrollment, financial aid awards, and account balances. Administrative and financial aid agents rely on it at Workday-deployed institutions.

## When to use this skill
- Retrieving employee position, department, supervisor, hire date, and benefit enrollment status
- Checking PTO balance, pay stub availability, or W-2 readiness
- Pulling student financial aid awards, pending disbursements, and account balances
- Initiating HR onboarding workflow tasks (direct deposit, I-9 status, required training)
- Confirming payment plan enrollment status for students

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `WORKDAY_BASE_URL` - tenant-specific Workday API base URL (e.g. `https://wd2-impl-services1.workday.com/ccx/api/v1/university`)
- `WORKDAY_CLIENT_ID` - OAuth 2.0 client ID from Workday API client registration
- `WORKDAY_CLIENT_SECRET` - OAuth 2.0 client secret
- `WORKDAY_TENANT` - Workday tenant name

## Key operations
- `GET /workers/:id` — employee record (position, compensation, org chart)
- `GET /workers/:id/timeOff` — PTO balance and scheduled time off
- `GET /students/:id/financialAidAwards` — aid package by award year
- `GET /students/:id/accountBalance` — student account balance and pending charges
- `POST /businessProcesses/hrOnboarding` — trigger onboarding workflow step

## Notes
- Workday APIs use OAuth 2.0 with short-lived access tokens (1-hour TTL); implement token refresh automatically.
- The Workday REST API is available in Workday 2020R2 and later; older deployments may require SOAP web services instead.
- Integration System Users (ISUs) must be provisioned by the institution's Workday admin with appropriate security domain access.
- Financial data (payroll, compensation) requires elevated ISU permissions beyond standard HR read access.
