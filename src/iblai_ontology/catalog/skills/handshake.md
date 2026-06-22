---
name: handshake
description: Handshake career platform — lets an agent search jobs and internships, retrieve employer profiles, and surface career fair registrations for students.
metadata: {"openclaw":{"requires":{"env":["HANDSHAKE_API_KEY","HANDSHAKE_BASE_URL"]}},"primaryEnv":"HANDSHAKE_API_KEY"}
---

# Handshake

## What it is
Handshake is the dominant career services platform in US higher education, connecting students and recent graduates with employers for jobs, internships, and career events. It replaces legacy on-campus recruiting systems and provides an integrated job board, career fair management, appointment scheduling, and employer relationship management tool. The career services agent uses it as the primary job search and recruiting channel.

## When to use this skill
- Searching for job or internship postings matching a student's major, location preference, or employer type
- Retrieving employer profiles and their on-campus recruiting calendars
- Helping a student RSVP to a career fair or employer info session
- Submitting a career center appointment request for resume review or mock interview
- Pulling employment outcome data by major and graduation year for advising conversations

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `HANDSHAKE_BASE_URL` - Handshake API base URL (e.g. `https://app.joinhandshake.com/api/v1`)
- `HANDSHAKE_API_KEY` - Handshake API key from school admin settings

## Key operations
- `GET /jobs` — search postings by keyword, job_type, location, and employer_industry
- `GET /employers/:id` — retrieve employer profile, description, and open positions
- `GET /career_fair_registrations` — list career fairs with RSVP status and logistics
- `POST /appointments` — create a career center appointment for a student
- `GET /survey_answers` — retrieve first-destination survey outcome data by cohort

## Notes
- Handshake's API is available to institution partners; the school's career center admin must provision the API key.
- Student-facing job search should filter to `posted_to_school: true` to surface only roles targeted to the institution's students.
- Employment outcome data (salaries, employers) is derived from self-reported surveys and LinkedIn matching; treat as directional, not authoritative.
- FERPA applies to student records accessed through Handshake; agents must not share one student's data with another.
