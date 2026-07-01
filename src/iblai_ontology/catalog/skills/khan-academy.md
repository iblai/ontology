---
name: khan-academy
description: Khan Academy — retrieve student skill mastery, exercise progress, and course completion data to personalize tutoring and avoid re-teaching mastered content.
metadata: {"openclaw":{"requires":{"env":["KHAN_ACADEMY_CLIENT_ID","KHAN_ACADEMY_CLIENT_SECRET","KHAN_ACADEMY_REDIRECT_URI"]}},"primaryEnv":"KHAN_ACADEMY_CLIENT_ID"}
---

# Khan Academy

## What it is
Khan Academy is a free, widely used instructional platform providing video lessons, practice exercises, and mastery-based learning pathways for K-12 students in math, science, ELA, computing, and more. Its progress API allows agents to read a student's mastered skills, in-progress exercises, and time-on-task data to personalize tutoring sessions.

## When to use this skill
- Checking which skills a student has already mastered before selecting practice problems
- Identifying in-progress or struggling exercises to target during a tutoring session
- Recommending the next skill in a learning pathway based on the student's current mastery level
- Supplementing a tutoring session with a direct link to the relevant Khan Academy video or exercise
- Reviewing course mastery percentage to inform parent or teacher progress updates

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `KHAN_ACADEMY_CLIENT_ID` - OAuth2 client ID from the Khan Academy developer console
- `KHAN_ACADEMY_CLIENT_SECRET` - OAuth2 client secret
- `KHAN_ACADEMY_REDIRECT_URI` - registered redirect URI for the OAuth2 authorization flow

## Key operations
- `GET /api/v1/user` — retrieve the authenticated student's profile and overall mastery summary
- `GET /api/v1/user/exercises` — list all exercises with mastery status (mastered/proficient/practiced/not started)
- `GET /api/v1/user/topic_exercises` — fetch exercise progress grouped by topic and grade band
- `GET /api/v1/exercises/{exercise_name}` — look up a specific exercise's description, related skills, and video links
- `GET /api/v1/topic/{topic_slug}/exercises` — enumerate all exercises within a topic for pathway planning

## Notes
- The Khan Academy API uses OAuth2 per-user authorization; each student must grant consent before their progress data can be read.
- API access is limited to approved educational integrations; register the application at khanacademy.org/api/auth2.
- Mastery levels update after exercise completion; there may be a short delay before the API reflects the latest session activity.
- Do not expose a student's exercise history to other students; scope all progress reads to the currently authenticated learner.
