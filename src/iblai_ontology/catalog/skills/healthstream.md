---
name: healthstream
description: HealthStream LMS — lets an agent query employee training transcripts, assign compliance curricula, check credential expiration alerts, and pull completion reports from the HealthStream learning management system.
metadata: {"openclaw":{"requires":{"env":["HEALTHSTREAM_API_KEY","HEALTHSTREAM_BASE_URL","HEALTHSTREAM_FACILITY_ID"]}},"primaryEnv":"HEALTHSTREAM_API_KEY"}
---

# HealthStream

## What it is
HealthStream is the most widely used learning management system in US healthcare, deployed at over 4,700 hospitals. It provides a library of HIPAA, OIG, CMS Conditions of Participation, Joint Commission, and clinical competency courses alongside a transcript and credential management engine. Agents use the HealthStream REST API to automate compliance tracking, trigger training assignments based on role or hire event, and surface expiring credential alerts to managers and staff.

## When to use this skill
- Check whether an employee has completed a required compliance course (HIPAA, infection control, fire safety)
- Retrieve a transcript showing all completed, overdue, or upcoming training assignments for a staff member
- Assign a training curriculum to a new hire or role group triggered by an HR onboarding event
- Surface a list of staff with expiring certifications (BLS, ACLS, annual HIPAA) within a given time window
- Pull aggregate completion rates by department for compliance reporting

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `HEALTHSTREAM_API_KEY` - API key issued by HealthStream for the facility integration
- `HEALTHSTREAM_BASE_URL` - REST API base URL (facility-specific, e.g., `https://api.healthstream.com/v2`)
- `HEALTHSTREAM_FACILITY_ID` - HealthStream facility/organization identifier

## Key operations
- `GET /transcripts?employeeId={id}` — full training transcript for an employee (completion dates, scores, certificate numbers, expiration dates)
- `GET /transcripts?employeeId={id}&status=overdue` — filter to overdue assignments only
- `POST /assignments` — assign a course or curriculum to an employee or group
- `GET /certifications/expiring?facilityId={id}&daysAhead={n}` — list certifications expiring within n days
- `GET /courses/{courseId}` — course metadata (title, category, required hours, accreditation)
- `GET /reports/completion?department={dept}&courseId={id}` — aggregate completion rate report by department

## Notes
- Employee IDs passed to this API should be internal HR identifiers (not SSN or personal details); hash or tokenize before logging.
- Completion records are immutable; corrections require a manual administrative override through the HealthStream admin console.
- Rate limit: 200 requests/min per API key; batch transcript pulls using the bulk endpoint for large cohorts.
- Sandbox environment available; request test credentials from your HealthStream customer success manager.
- Transcript data surfaced outside the LMS must comply with your organization's workforce privacy policy.
