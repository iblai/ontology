---
name: classdojo
description: ClassDojo — post classroom story updates and send direct messages to authorized guardians for K-12 family engagement and communication.
metadata: {"openclaw":{"requires":{"env":["CLASSDOJO_API_KEY","CLASSDOJO_TEACHER_ID"]}},"primaryEnv":"CLASSDOJO_API_KEY"}
---

# ClassDojo

## What it is
ClassDojo is a classroom community platform used by millions of K-12 teachers to share classroom moments via a story feed, communicate directly with families, and recognize student behavior. It is especially prevalent in elementary and middle school settings where it serves as the primary home-school communication channel.

## When to use this skill
- Posting a classroom story update (photo caption or text post) to share learning highlights with families
- Sending a direct message to an authorized guardian about a student's progress, attendance, or upcoming event
- Looking up which guardians are connected to a class and their messaging preferences
- Drafting bilingual messages for families whose home language differs from the classroom language

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `CLASSDOJO_API_KEY` - API key from the ClassDojo developer or school integration portal
- `CLASSDOJO_TEACHER_ID` - teacher account identifier used to scope class and message access

## Key operations
- `GET /api/ta/v1/classes` — list the authenticated teacher's active classes and connected guardian counts
- `POST /api/ta/v1/classes/{classId}/story` — create a new classroom story post (text and/or media)
- `GET /api/ta/v1/classes/{classId}/students` — retrieve student roster with connected guardian status
- `POST /api/ta/v1/messages` — send a direct message to a specific guardian
- `GET /api/ta/v1/messages` — read message thread history for an authorized guardian

## Notes
- ClassDojo messages must be sent by or explicitly authorized by the classroom teacher; agents draft messages for teacher review and approval.
- Do not post student names, photos, or performance data in classroom story posts without confirming guardian photo/data consent.
- Messages are end-to-end visible to the teacher; all agent-drafted content should be reviewed before delivery.
- ClassDojo's API is available to verified school and district integrations; contact ClassDojo support for API access credentials.
