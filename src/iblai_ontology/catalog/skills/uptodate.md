---
name: uptodate
description: UpToDate (Wolters Kluwer) — lets an agent query evidence-based clinical decision support content including treatment recommendations, drug monographs, and clinical practice guidelines.
metadata: {"openclaw":{"requires":{"env":["UPTODATE_API_KEY","UPTODATE_BASE_URL"]}},"primaryEnv":"UPTODATE_API_KEY"}
---

# UpToDate

## What it is
UpToDate is the most widely used clinical decision support resource in US hospitals, with institutional subscriptions at the majority of health systems. It provides physician-authored, peer-reviewed clinical summaries covering diagnosis, treatment, and prevention across all specialties. The REST API enables agents to retrieve topic content, recommendation grades, evidence levels, and related topic links programmatically within the clinical workflow.

## When to use this skill
- Retrieve treatment recommendations for an active diagnosis or clinical question
- Look up drug dosing, indications, and contraindications from the drug monograph library
- Surface the graded recommendation strength (A/B/C) and evidence level (1/2/3) for a proposed intervention
- Identify relevant clinical practice guidelines (AHA, IDSA, ACOG, etc.) linked to a topic
- Support clinical decision making at the point of care for physician or nursing queries

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `UPTODATE_API_KEY` - institutional API key issued with the UpToDate license
- `UPTODATE_BASE_URL` - API base URL (typically `https://www.uptodate.com/services/app/contents/api`)

## Key operations
- `GET /search?q={query}` — keyword or clinical question search returning ranked topic list
- `GET /topic/{topicId}` — full topic content with structured sections (Recommendations, Evidence Summary, References)
- `GET /drug/{drugName}` — drug monograph (dosing, indications, contraindications, pregnancy safety, renal/hepatic adjustments)
- `GET /topic/{topicId}/graded-recommendations` — extracted recommendation statements with grade and evidence level
- `GET /topic/{topicId}/related` — linked topics and related guidelines

## Notes
- Access requires an active institutional UpToDate license; individual clinician keys cannot be used for agent/system integrations.
- API responses include a `lastReviewedDate` field; surface this to clinicians so they can assess currency.
- Rate limit: 60 requests/min per API key; cache topic responses for repeated queries within a session.
- Content is licensed; do not store or redistribute full topic text outside the agent session context.
- UpToDate content is copyright Wolters Kluwer; display attribution in any output surfaced to end users.
