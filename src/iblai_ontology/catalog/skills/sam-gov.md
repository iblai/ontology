---
name: sam-gov
description: Official U.S. government vendor and contract opportunities registry; lets agents verify vendor registrations, check exclusions, and search contract opportunities.
metadata: {"openclaw":{"requires":{"env":["SAM_GOV_API_KEY"]}},"primaryEnv":"SAM_GOV_API_KEY"}
---

# SAM.gov

## What it is
SAM.gov (System for Award Management) is the authoritative federal system for entity registrations, contract opportunities, federal award data, and exclusions (debarment/suspension). All vendors receiving federal contracts or grants must be registered in SAM. It is mandatory for procurement agents to verify SAM status before obligating funds.

## When to use this skill
- Verifying that a vendor holds an active SAM registration before issuing a purchase order or contract award
- Checking Unique Entity Identifier (UEI) and CAGE code details for a prospective awardee
- Confirming no active exclusion (debarment or suspension) exists for a vendor or individual
- Retrieving NAICS codes and small business designations (SB, WOSB, SDVOSB, HUBZone, 8(a))
- Searching open contract opportunities or solicitations by NAICS, set-aside type, or agency

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `SAM_GOV_API_KEY` - public API key issued from SAM.gov developer portal (system account required for sensitive fields)

## Key operations
- `GET /entity-information/v3/entities` — search entities by UEI, CAGE, legal name, or NAICS; returns registration status and exclusion flag
- `GET /exclusions/v1/exclusions` — query active exclusions by name, SSN/EIN, or CAGE code
- `GET /opportunities/v2/search` — search active contract opportunities by keyword, NAICS, set-aside, or agency
- `GET /contract-data/v1/federalawarddata` — retrieve federal award history for a vendor or agency
- `GET /entity-information/v3/entities/{entityId}/points-of-contact` — retrieve vendor POC details for a registered entity

## Notes
- Public API key grants access to public data only; a System Account (SAM.gov account with approved roles) is required for FOUO fields such as banking information.
- Rate limit: 1,000 requests/day for public keys; higher limits available with a registered system account.
- SAM registrations expire annually; always check `registrationExpirationDate` before obligating funds.
- The exclusions endpoint must be queried separately from entity registration; a valid registration does NOT guarantee absence of exclusion.
