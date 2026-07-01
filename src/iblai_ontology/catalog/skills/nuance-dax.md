---
name: nuance-dax
description: Nuance DAX (Dragon Ambient eXperience) — lets an agent submit encounter audio or transcripts and retrieve AI-generated structured clinical note drafts for clinician review.
metadata: {"openclaw":{"requires":{"env":["NUANCE_DAX_API_KEY","NUANCE_DAX_BASE_URL","NUANCE_DAX_FACILITY_ID"]}},"primaryEnv":"NUANCE_DAX_API_KEY"}
---

# Nuance DAX

## What it is
Nuance DAX (Dragon Ambient eXperience) is Microsoft's leading ambient AI documentation platform used by over 550 US health systems. It converts real-time encounter audio into structured clinical note drafts (SOAP, H&P, progress notes, procedure notes) that surface in the EHR In-Basket for clinician review and approval before any note is finalized. DAX Copilot is the current SaaS iteration, integrated natively into Epic and Cerner workflows.

## When to use this skill
- Retrieve a completed DAX ambient note draft after a clinical encounter
- Check note generation status for a given encounter ID
- Submit a corrected or amended note segment back into the DAX review queue
- Pull specialty-specific note template configurations (e.g., cardiology H&P vs. primary care SOAP)
- Integrate DAX output with EHR draft note APIs (Epic In-Basket, Cerner PowerNote)

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `NUANCE_DAX_API_KEY` - API key issued by Nuance/Microsoft for the facility integration
- `NUANCE_DAX_BASE_URL` - DAX API base URL (facility-specific endpoint provided at onboarding)
- `NUANCE_DAX_FACILITY_ID` - facility identifier assigned during DAX deployment

## Key operations
- `GET /encounters/{encounter_id}/note-draft` — retrieve generated note draft by encounter ID
- `GET /encounters/{encounter_id}/status` — check processing status (queued/processing/complete/failed)
- `POST /encounters/{encounter_id}/corrections` — submit clinician correction segment for reprocessing
- `GET /templates` — list available specialty note templates
- `GET /templates/{template_id}` — fetch template structure (sections, fields, default text)
- `POST /encounters` — register a new encounter session before audio capture begins

## Notes
- Note drafts are returned as structured JSON with section-level text; convert to HL7 CDA or FHIR DocumentReference before writing to EHR.
- DAX operates under a BAA with Microsoft/Nuance; all audio and transcription data is encrypted at rest and in transit.
- Audio capture is handled by the DAX mobile app or EHR plugin — this API skill covers server-side note retrieval and integration, not audio streaming.
- Typical processing latency: 2-5 minutes post-encounter; implement polling with exponential backoff.
- Sandbox / test environment credentials are separate from production; never use production keys in development.
