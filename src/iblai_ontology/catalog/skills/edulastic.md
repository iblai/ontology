---
name: edulastic
description: Edulastic — generate, import, and manage standards-aligned assessments; retrieve performance data and class mastery reports for K-12 assessment workflows.
metadata: {"openclaw":{"requires":{"env":["EDULASTIC_API_KEY","EDULASTIC_DISTRICT_ID"]}},"primaryEnv":"EDULASTIC_API_KEY"}
---

# Edulastic

## What it is
Edulastic is a cloud-based assessment platform used by K-12 teachers to create standards-tagged formative and summative assessments, administer them digitally, and receive real-time performance analytics. It supports technology-enhanced question types, QTI import/export, and auto-grading with automatic gradebook passback.

## When to use this skill
- Generating standards-tagged question banks aligned to CCSS, NGSS, or state standards
- Creating or publishing a formative or summative assessment for a specific course section
- Importing or exporting assessment items in QTI format for interoperability with other platforms
- Retrieving class-level performance reports and per-standard mastery data after an assessment
- Checking DOK level distribution across a created assessment before publishing

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `EDULASTIC_API_KEY` - API key from the Edulastic district admin or developer portal
- `EDULASTIC_DISTRICT_ID` - district identifier required in scoped API requests

## Key operations
- `GET /api/v1/tests` — list available assessments for the authenticated teacher or district
- `POST /api/v1/tests` — create a new assessment with items, standards tags, and settings
- `GET /api/v1/tests/{id}/report` — retrieve class-level and student-level performance results
- `GET /api/v1/items` — search the item bank by standard code, DOK level, or question type
- `POST /api/v1/tests/{id}/assign` — assign an assessment to one or more class sections
- `GET /api/v1/standards` — look up supported standards frameworks and individual standard codes

## Notes
- Auto-grading applies to objective question types; constructed-response items require teacher review before scores are finalized.
- QTI import/export is available at the district tier; confirm the subscription level before attempting bulk item imports.
- Student-level results are FERPA-protected; do not surface individual scores to unauthorized users.
- Edulastic enforces per-teacher API rate limits; batch report requests rather than polling per-student.
