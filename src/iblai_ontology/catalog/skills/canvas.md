---
name: canvas
description: Instructure Canvas LMS — lets an agent read and write course content, assignments, grades, and engagement analytics.
metadata: {"openclaw":{"requires":{"env":["CANVAS_API_TOKEN","CANVAS_BASE_URL"]}},"primaryEnv":"CANVAS_API_TOKEN"}
---

# Canvas

## What it is
Canvas by Instructure is the most widely-adopted learning management system in US higher education. It hosts course modules, assignments, quizzes, grade books, and discussion boards. Agents use it to support faculty content creation, grading workflows, and student engagement monitoring.

## When to use this skill
- Faculty need to publish or update assignments, rubrics, or announcements
- A tutoring agent needs to read the course syllabus and assignment rubric to ground a session
- A retention agent needs per-student engagement metrics (last login, submission rate)
- Batch grade feedback must be written back after rubric scoring
- Quiz question banks need to be generated or uploaded

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `CANVAS_BASE_URL` - institution's Canvas instance URL (e.g. `https://canvas.university.edu`)
- `CANVAS_API_TOKEN` - long-lived API token generated from Canvas user settings

## Key operations
- `GET /api/v1/courses/:id/assignments` — list assignments with due dates and rubrics
- `GET /api/v1/courses/:id/students` — roster with enrollment status
- `PUT /api/v1/courses/:id/assignments/:id/submissions/:user_id` — post grade and comment
- `GET /api/v1/courses/:id/analytics/student_summaries` — per-student engagement metrics
- `POST /api/v1/courses/:id/quizzes` — create quiz with question bank
- `GET /api/v1/courses/:id/modules` — retrieve module structure and content items

## Notes
- Rate limit: 3,000 requests per hour per token; prefer bulk endpoints to reduce call count.
- The institution must enable the API token feature; some accounts restrict external integrations to OAuth apps only.
- Grade passback to Banner/SIS requires a separate LTI or SIS integration; Canvas API writes grades to the Canvas gradebook only.
- Use `per_page=100` on list endpoints to minimize pagination overhead.
