---
name: cerner-fhir
description: Cerner Millennium FHIR R4 API — lets an agent read patient clinical data (demographics, encounters, diagnoses, medications, notes) within a Cerner-hosted health system.
metadata: {"openclaw":{"requires":{"env":["CERNER_CLIENT_ID","CERNER_FHIR_BASE_URL","CERNER_CLIENT_SECRET","CERNER_TENANT_ID"]}},"primaryEnv":"CERNER_CLIENT_ID"}
---

# Cerner Millennium FHIR R4

## What it is
Cerner Millennium (now Oracle Health) is the second-largest EHR platform in US health systems. Its FHIR R4 API exposes the same standard resource types as Epic (Patient, Encounter, Condition, MedicationRequest, Observation, DocumentReference, Procedure) via SMART on FHIR backend service auth. Agents use it as the Cerner-deployment equivalent of the Epic FHIR skill, providing the same clinical context to downstream workflows.

## When to use this skill
- Read active diagnoses, medications, and allergy lists from a Cerner-hosted chart
- Retrieve encounter context (class, service, attending NPI) for routing and documentation
- Fetch clinical notes or discharge summaries (DocumentReference) for coding or CDI workflows
- Access procedure records and lab observations for quality measurement
- Create draft documentation or orders in the Cerner PowerChart note workflow (write scope)

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `CERNER_FHIR_BASE_URL` - FHIR R4 base endpoint (e.g., `https://fhir-ehr.cerner.com/r4/{tenant-id}`)
- `CERNER_CLIENT_ID` - OAuth 2.0 client ID from Cerner code console
- `CERNER_CLIENT_SECRET` - OAuth 2.0 client secret (system app auth)
- `CERNER_TENANT_ID` - health system tenant identifier issued during registration

## Key operations
- `GET /Patient/{id}` — demographics, MRN, preferred language
- `GET /Encounter?patient={id}` — encounter list with class, status, period
- `GET /Condition?patient={id}` — problem list with ICD-10/SNOMED codes
- `GET /MedicationRequest?patient={id}&status=active` — active medication list
- `GET /Observation?patient={id}&category=laboratory` — lab results with LOINC
- `GET /DocumentReference?patient={id}` — clinical notes and reports
- `GET /Procedure?patient={id}` — completed and planned procedures
- `POST /DocumentReference` — write draft note to Cerner workflow (write scope required)

## Notes
- Tenant registration is required via Cerner code console; submit non-production (sandbox) app first.
- Cerner open sandbox (`fhir-open.cerner.com`) provides public read-only access to synthetic data.
- Rate limit: 400 requests/min per client in production; retry-after header returned on 429.
- Note that Cerner FHIR scope names follow a slightly different convention than Epic; verify scope strings against the Cerner authorization server metadata endpoint.
- All PHI access requires a signed BAA with Oracle Health (Cerner).
