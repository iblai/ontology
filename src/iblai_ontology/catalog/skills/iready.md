---
name: iready
description: iReady (Curriculum Associates) — retrieve student diagnostic placement levels and domain scores to align tutoring and instructional content to each student's instructional zone.
metadata: {"openclaw":{"requires":{"env":["IREADY_API_KEY","IREADY_DISTRICT_ID"]}},"primaryEnv":"IREADY_API_KEY"}
---

# iReady

## What it is
iReady by Curriculum Associates is an adaptive diagnostic and instructional platform used across K-12 for reading and mathematics. Its diagnostic produces domain-level placement scores and grade-equivalent levels that teachers and agents use to identify each student's instructional zone and tailor learning pathways.

## When to use this skill
- Determining a student's overall placement level and domain scores before a tutoring session
- Identifying specific skill gaps (e.g., Number and Operations, Phonics) to target with tailored explanations
- Comparing typical and stretch growth targets to gauge whether a student is on track
- Supplying placement data for present-level-of-performance narratives in IEP documents
- Recommending instructional resources calibrated to the student's current iReady level

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `IREADY_API_KEY` - API key from the Curriculum Associates iReady integration portal
- `IREADY_DISTRICT_ID` - district identifier required for scoped student data access

## Key operations
- `GET /v1/students/{studentId}/diagnostics` — retrieve the most recent diagnostic results including overall placement and domain scores
- `GET /v1/students/{studentId}/growth` — fetch typical growth, stretch growth, and observed growth across diagnostic windows
- `GET /v1/students/{studentId}/lessons` — list completed and in-progress iReady instructional lessons
- `GET /v1/classes/{classId}/students/diagnostics` — retrieve diagnostic summaries for all students in a class (teacher-scoped)
- `GET /v1/domains` — look up domain definitions and the skills they encompass for reading or math

## Notes
- iReady diagnostic data is student-level and FERPA-protected; access must be scoped to the appropriate teacher-student relationship.
- Domain scores are reported in grade-equivalent bands (e.g., "Mid Grade 4") rather than scaled scores; use the grade_level_equivalence field for instructional calibration.
- The iReady API requires a data-sharing agreement between the district and Curriculum Associates; confirm access before deployment.
- Diagnostic results are available after each testing window (typically fall, winter, spring); mid-year data may reflect the most recent window only.
