---
name: nwea-map
description: NWEA MAP Growth — retrieve student RIT scores, instructional area recommendations, and growth projections to calibrate tutoring and instructional support.
metadata: {"openclaw":{"requires":{"env":["NWEA_MAP_API_KEY","NWEA_MAP_BASE_URL"]}},"primaryEnv":"NWEA_MAP_API_KEY"}
---

# NWEA MAP Growth

## What it is
NWEA MAP Growth is an adaptive assessment platform used by millions of K-12 students to measure academic achievement and growth in reading, mathematics, language usage, and science. It produces RIT scores that map directly to instructional level, enabling agents to calibrate the difficulty and content of tutoring sessions and differentiated resources.

## When to use this skill
- Determining a student's current instructional level before beginning a tutoring session
- Identifying specific goal areas (e.g., Operations & Algebraic Thinking, Informational Text) where the student needs targeted support
- Comparing a student's growth projection to typical growth norms to assess acceleration or intervention need
- Supplying present-level-of-performance data for IEP goal narratives or progress monitoring

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `NWEA_MAP_API_KEY` - API key from the NWEA MAP API developer registration
- `NWEA_MAP_BASE_URL` - MAP API base URL (e.g. `https://api.mapnwea.org`)

## Key operations
- `GET /results/student/{studentId}` — retrieve the most recent RIT scores and percentile ranks per subject
- `GET /results/student/{studentId}/goals` — fetch goal area RIT scores and instructional area labels
- `GET /results/student/{studentId}/growth` — compare projected vs. observed growth across terms
- `GET /norms/{grade}/{subject}` — look up grade-level norms for contextualization
- `GET /instructionalRanges` — map a RIT score to the recommended instructional range for resource selection

## Notes
- MAP data is student-level and FERPA-protected; only authorized staff or the tutoring context for that student may access it.
- RIT scores are on a continuous scale (roughly 100–300); do not compare across subjects as scales are independent.
- Use the most recent testing term's results; stale scores more than one academic year old may not reflect current level.
- The MAP API requires a district-level data sharing agreement with NWEA before access is granted.
