---
name: civitas-learning
description: Civitas Learning analytics platform — lets an agent retrieve student risk scores, graduation probability, course success predictions, and intervention outcome tracking.
metadata: {"openclaw":{"requires":{"env":["CIVITAS_API_KEY","CIVITAS_BASE_URL"]}},"primaryEnv":"CIVITAS_API_KEY"}
---

# Civitas Learning

## What it is
Civitas Learning is a predictive analytics platform purpose-built for higher education. It ingests SIS, LMS, and financial data to produce student-level risk scores, graduation probability estimates, course success predictions, and schedule optimization recommendations. Academic advisor and retention agents use it to identify at-risk students proactively and measure intervention effectiveness.

## When to use this skill
- Pulling a student's graduation probability score and the top risk factors driving it
- Identifying the highest-risk student cohorts in a given term for targeted outreach
- Checking course success probabilities before a student finalizes their schedule
- Retrieving schedule optimization suggestions based on peer cohort outcomes
- Benchmarking institution-level retention rates and tracking intervention outcomes over time

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `CIVITAS_BASE_URL` - Civitas Learning API base URL provided at onboarding
- `CIVITAS_API_KEY` - API key issued by Civitas Learning institutional account

## Key operations
- `GET /students/:id/risk` — graduation probability score and contributing risk factors
- `GET /students/:id/courseSuccess` — per-course success probability for planned schedule
- `GET /cohorts/atRisk` — ranked list of at-risk students by program and term
- `GET /interventions/:id/outcomes` — measured outcome change for a tracked intervention
- `GET /students/:id/scheduleRecommendations` — peer-cohort-informed schedule suggestions

## Notes
- Risk scores are probabilistic; agents must present them as decision-support signals, not deterministic predictions, and always involve human advisors in intervention decisions.
- Score refresh cadence varies by institution contract (typically daily or weekly); surface the score's `as_of_date` alongside the value.
- Civitas data contains derived PII; access is governed by institutional data use agreement and FERPA.
- The API requires IP-allowlisting in addition to the API key; ensure the agent's egress IP is registered with Civitas.
