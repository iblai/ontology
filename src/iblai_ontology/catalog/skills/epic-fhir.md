---
name: epic-fhir
description: Epic EHR FHIR R4 API — lets an agent read and write patient clinical data (demographics, encounters, diagnoses, medications, notes, orders) within an Epic-hosted health system.
metadata: {"openclaw":{"requires":{"env":["EPIC_CLIENT_ID","EPIC_FHIR_BASE_URL","EPIC_PRIVATE_KEY_PATH","EPIC_SCOPE"]}},"primaryEnv":"EPIC_CLIENT_ID"}
---

# Epic FHIR R4

## What it is
Epic is the dominant EHR platform in US health systems. Its FHIR R4 API (via SMART on FHIR / backend service auth) exposes standardized clinical resources — Patient, Encounter, Condition, MedicationRequest, Observation, DocumentReference, ServiceRequest, and more. Agents use it to read encounter context, surface patient data, and (with write scopes) create draft notes or referral orders for clinician review.

## When to use this skill
- Retrieve active diagnoses, medications, allergies, or lab results for clinical decision support
- Read encounter context (admit date, service type, attending provider) before routing a request
- Fetch or draft clinical documentation (DocumentReference) via the In-Basket workflow
- Create or check referral orders (ServiceRequest) during care coordination
- Access care plan activities or discharge instructions (CarePlan) for patient education

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `EPIC_FHIR_BASE_URL` - FHIR R4 base endpoint (e.g., `https://fhir.epicinstance.org/api/FHIR/R4`)
- `EPIC_CLIENT_ID` - OAuth 2.0 client ID registered in Epic App Orchard
- `EPIC_PRIVATE_KEY_PATH` - path to RSA private key used for JWT client assertion (backend service auth)
- `EPIC_SCOPE` - space-separated SMART scopes (e.g., `system/Patient.read system/Observation.read`)

## Key operations
- `GET /Patient/{id}` — demographics, MRN, language preference
- `GET /Encounter?patient={id}` — encounter list with class, service type, status
- `GET /Condition?patient={id}&clinical-status=active` — active problem list
- `GET /MedicationRequest?patient={id}&status=active` — current medications
- `GET /Observation?patient={id}&category=laboratory` — lab results with LOINC codes
- `GET /DocumentReference?patient={id}&type={LOINC}` — clinical notes by type
- `POST /ServiceRequest` — create referral order (write scope required)
- `POST /DocumentReference` — submit draft note to In-Basket (write scope required)

## Notes
- Backend service (system) scopes require Epic App Orchard registration and IT security review; allow 4-8 weeks.
- Sandbox environment available at `open.epic.com` with synthetic patient data.
- Rate limit: 500 requests/min per client ID in production; exponential backoff on 429.
- All PHI transmitted over this skill is subject to your BAA with Epic.
- Use minimum-necessary scopes; request only the resource types the agent actually reads.
