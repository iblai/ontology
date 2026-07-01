---
name: google-classroom
description: Google Classroom — read and write courses, coursework, materials, and student submissions via the Google Classroom API for K-12 workflows.
metadata: {"openclaw":{"requires":{"env":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN"]}},"primaryEnv":"GOOGLE_CLIENT_ID"}
---

# Google Classroom

## What it is
Google Classroom is Google's free LMS integrated into Google Workspace for Education, widely adopted in K-12 for assignment distribution, submission collection, grading, and class communication. It is accessed via the Google Classroom REST API and Google Drive API for attached files.

## When to use this skill
- Fetching classwork titles, descriptions, due dates, and attached materials for tutoring context
- Retrieving student submission documents (linked Google Docs) for writing feedback
- Publishing teacher-created materials or assignments to a class topic
- Reading teacher comments and prior feedback to inform writing portfolio analysis
- Looking up course roster and topic structure for lesson-planning alignment

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `GOOGLE_CLIENT_ID` - OAuth2 client ID from the Google Cloud project
- `GOOGLE_CLIENT_SECRET` - OAuth2 client secret
- `GOOGLE_REFRESH_TOKEN` - long-lived refresh token obtained via the OAuth2 authorization flow

## Key operations
- `GET /v1/courses` — list active courses for the authenticated teacher or student
- `GET /v1/courses/{id}/courseWork` — retrieve all assignments and materials with due dates
- `GET /v1/courses/{id}/courseWork/{cwId}/studentSubmissions` — read student submission status and attached file IDs
- `POST /v1/courses/{id}/courseWorkMaterials` — publish a new material item to a topic
- `PATCH /v1/courses/{id}/courseWork/{cwId}/studentSubmissions/{sid}` — return a grade or drafted feedback
- `GET /v1/userProfiles/{id}` — look up name, email, and role for identity resolution

## Notes
- The Classroom API requires appropriate OAuth2 scopes; use the least-privileged scope for each operation.
- Google Drive API is needed separately to read or write the content of attached Docs/Slides files.
- Tokens expire after 1 hour; always use the refresh token flow rather than prompting for re-authorization.
- Student submission data is FERPA-protected; do not cache submission content outside the sandbox workspace.
