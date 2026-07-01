---
name: innovaccer
description: Innovaccer — lets an agent query population health analytics, patient risk scores, care gap lists, and SDOH screening data from the Innovaccer unified patient data platform.
metadata: {"openclaw":{"requires":{"env":["INNOVACCER_API_KEY","INNOVACCER_BASE_URL","INNOVACCER_TENANT_ID","INNOVACCER_CLIENT_SECRET"]}},"primaryEnv":"INNOVACCER_API_KEY"}
---

# Innovaccer

## What it is
Innovaccer is a leading population health management and healthcare analytics platform that aggregates data across EHRs, claims, labs, and SDOH sources into a unified patient record. It provides risk stratification (low/medium/high/rising risk), care gap identification (HEDIS measures, STAR ratings), care plan management, and SDOH screening integration. Agents use the Innovaccer REST API to power care coordination workflows, quality improvement analytics, and proactive outreach prioritization.

## When to use this skill
- Retrieve a patient's current risk score and risk tier to guide care coordination intensity
- Pull a list of open care gaps for a patient or panel (e.g., A1c overdue, mammogram due, colorectal screening)
- Identify rising-risk patients in a provider panel who need proactive outreach
- Access SDOH screening results (food insecurity, housing instability, transportation barriers) linked to a patient
- Retrieve care gap closure rates by measure and provider for quality improvement reporting

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `INNOVACCER_API_KEY` - API key issued by Innovaccer for the facility integration
- `INNOVACCER_BASE_URL` - tenant-specific API base URL (e.g., `https://api.innovaccer.com/v1`)
- `INNOVACCER_TENANT_ID` - health system tenant identifier in the Innovaccer platform
- `INNOVACCER_CLIENT_SECRET` - client secret for OAuth 2.0 token exchange (if using OAuth flow)

## Key operations
- `GET /patients/{patientId}/risk-score` — current risk score (0-100), risk tier, top risk drivers (diagnosis codes, utilization events, SDOH flags)
- `GET /patients/{patientId}/care-gaps` — open care gaps with gap name, measure, last service date, target service date, and closure priority
- `GET /panels/{providerId}/rising-risk` — list of rising-risk patients in a provider panel sorted by risk score change
- `GET /patients/{patientId}/sdoh` — SDOH screening results by domain (food, housing, transportation, financial, behavioral health)
- `GET /analytics/care-gaps?measure={hedisId}&period={year}` — aggregate care gap performance by measure across the population
- `GET /patients/{patientId}/care-plan` — active care plan goals, activities, and care manager assignment

## Notes
- Patient identifiers in Innovaccer are internal platform IDs; cross-reference with EHR MRN via the patient matching API before use.
- Risk scores are recalculated nightly; do not treat intra-day changes as meaningful.
- Care gap data is sourced from claims and EHR feeds; there may be a 24-48 hour lag after a qualifying service is rendered.
- PHI is present in all patient-level endpoints; all requests are logged in the Innovaccer audit trail.
- Aggregate analytics endpoints (panels, measures) enforce minimum cell size of n=10 to prevent re-identification.
