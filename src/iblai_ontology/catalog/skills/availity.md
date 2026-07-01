---
name: availity
description: Availity Essentials — lets an agent perform real-time eligibility verification, prior authorization initiation and status checks, and payer enrollment management via the Availity clearinghouse REST API.
metadata: {"openclaw":{"requires":{"env":["AVAILITY_CLIENT_ID","AVAILITY_CLIENT_SECRET","AVAILITY_BASE_URL","AVAILITY_ORG_ID"]}},"primaryEnv":"AVAILITY_CLIENT_ID"}
---

# Availity Essentials

## What it is
Availity is the largest healthcare information network in the US, connecting providers to hundreds of payers for eligibility, benefits, and administrative transactions. Availity Essentials (the payer-agnostic portal and API layer) supports X12 270/271 eligibility transactions, X12 278 prior authorization requests and responses, payer-specific PA requirement lookups, and provider enrollment management. Agents use it to automate revenue cycle and PA workflows without manual portal navigation.

## When to use this skill
- Verify a patient's insurance coverage, deductible status, and copay/coinsurance before a procedure
- Check whether a specific CPT/HCPCS code requires prior authorization for a given payer
- Submit a PA request (X12 278) and retrieve authorization number or denial with reason codes
- Check the status of a pending prior authorization
- Manage provider enrollment status and roster submissions across multiple payers

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `AVAILITY_CLIENT_ID` - OAuth 2.0 client ID from Availity developer portal
- `AVAILITY_CLIENT_SECRET` - OAuth 2.0 client secret for token exchange
- `AVAILITY_BASE_URL` - API base URL (`https://api.availity.com/availity/v1`)
- `AVAILITY_ORG_ID` - Availity organization ID assigned to the provider group/health system

## Key operations
- `POST /eligibility-benefit-inquiry` — real-time eligibility and benefits check (X12 270/271 equivalent); returns coverage, deductible, OOP max, PA required flag
- `POST /authorizations` — submit prior authorization request (X12 278 equivalent) with diagnosis, procedure, and clinical attachment
- `GET /authorizations/{authId}` — retrieve PA status (approved/denied/pending) and authorization number
- `GET /payers/{payerId}/pa-requirements?cpt={code}` — lookup whether PA is required for a specific CPT by payer
- `GET /providers/{npi}/enrollments` — list payer enrollment status by provider NPI
- `POST /enrollments` — submit new payer enrollment transaction

## Notes
- Eligibility responses include a `paRequired` flag per service category; always surface this to the ordering workflow before scheduling.
- X12 denial reason codes (AAA/CA segments) are mapped to human-readable text in the response `denyReasonDescription` field.
- Availity sandbox (`sandbox.availity.com`) provides test payer simulators for development.
- Rate limit: 300 requests/min for eligibility; 60 requests/min for PA submissions.
- A signed Trading Partner Agreement with Availity is required before production API access is granted.
