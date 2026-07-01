---
name: nice-actimize
description: NICE Actimize financial crime platform; lets an agent retrieve fraud and AML transaction monitoring alerts, update dispositions, and route SAR candidates to the BSA Officer.
metadata: {"openclaw":{"requires":{"env":["ACTIMIZE_BASE_URL","ACTIMIZE_API_KEY","ACTIMIZE_CLIENT_ID","ACTIMIZE_CLIENT_SECRET"]}},"primaryEnv":"ACTIMIZE_API_KEY"}
---

# NICE Actimize

## What it is
NICE Actimize is the leading financial crime, risk, and compliance platform deployed across retail banks, broker-dealers, and wealth management firms. It encompasses the Suspicious Activity Monitoring (SAM) module for AML transaction monitoring and the Fraud suite for real-time behavioral fraud detection. Firms use it to triage alerts, document investigations, and manage SAR filing pipelines.

## When to use this skill
- Retrieve open fraud or AML alerts from the alert queue, sorted by risk score or typology
- Pull transaction detail, device fingerprint, and behavioral analytics for a specific alert
- Update alert disposition (true positive, false positive, escalated) and log investigation notes
- Route SAR-eligible cases to the BSA Officer review queue
- Access customer risk profiles and peer group deviation scores for investigation context
- Pull aged alert and SLA compliance reports for operations management

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `ACTIMIZE_BASE_URL` - Base URL of the Actimize REST API (e.g. `https://actimize.yourfirm.com/api`)
- `ACTIMIZE_API_KEY` - Service account API key or OAuth2 client credential
- `ACTIMIZE_CLIENT_ID` - OAuth2 client ID (if using OAuth flow)
- `ACTIMIZE_CLIENT_SECRET` - OAuth2 client secret (if using OAuth flow)

## Key operations
- `GET /alerts` — list alerts with filters for status, risk score, typology, date range, and analyst assignment
- `GET /alerts/{alertId}` — retrieve full alert detail including transaction data and contributing features
- `PATCH /alerts/{alertId}/disposition` — update disposition and add investigation notes
- `POST /alerts/{alertId}/escalate` — escalate alert to SAR review queue
- `GET /cases/{caseId}` — retrieve full case file with linked alerts and investigation history
- `GET /customers/{customerId}/risk-profile` — retrieve customer entity risk score and activity profile

## Notes
- Actimize REST API availability depends on the deployment version (ActOne platform vs. legacy); confirm endpoint schema with your Actimize instance version
- All disposition updates are audit-logged and immutable; corrections require a supervisor override workflow
- SAR routing triggers downstream BSA workflow — test in the staging environment before enabling in production
- Access to PII fields (customer name, SSN) may require an elevated role separate from standard analyst access
