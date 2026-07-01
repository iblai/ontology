---
name: lexisnexis-worldcompliance
description: LexisNexis WorldCompliance screening platform; lets an agent screen individuals and entities against OFAC SDN, PEP databases, global sanctions lists, and adverse media with confidence-scored match results.
metadata: {"openclaw":{"requires":{"env":["LEXISNEXIS_WC_API_KEY","LEXISNEXIS_WC_API_SECRET","LEXISNEXIS_WC_BASE_URL"]}},"primaryEnv":"LEXISNEXIS_WC_API_KEY"}
---

# LexisNexis WorldCompliance

## What it is
LexisNexis WorldCompliance is a global sanctions, PEP (Politically Exposed Person), and adverse media screening database used by financial institutions to satisfy AML, KYC, and OFAC compliance obligations. It covers OFAC SDN and consolidated non-SDN lists, FATF grey/black lists, hundreds of global sanctions programs, law enforcement databases, and real-time adverse media. The KYC/AML and compliance agents rely on it as the primary watchlist screening engine.

## When to use this skill
- Screen a new customer's name, date of birth, and nationality against OFAC and global sanctions lists
- Run PEP screening to identify politically exposed persons and their close associates
- Retrieve adverse media results for enhanced due diligence (EDD) on high-risk customers
- Log the list version and screening timestamp for AML audit trail requirements
- Confirm match dispositions (true match vs. false positive) and record analyst sign-off
- Run ongoing monitoring alerts for existing customers against updated list versions

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `LEXISNEXIS_WC_API_KEY` - WorldCompliance API key
- `LEXISNEXIS_WC_API_SECRET` - WorldCompliance API secret
- `LEXISNEXIS_WC_BASE_URL` - API base URL (e.g. `https://api.worldcompliance.com/v1`)

## Key operations
- `POST /screening/entity` — screen an individual or entity; returns match results with confidence scores and list detail
- `GET /screening/results/{screeningId}` — retrieve a previous screening result by ID
- `POST /screening/entity/batch` — submit a batch of entities for bulk screening
- `GET /lists` — retrieve available list versions and their effective dates
- `POST /dispositions/{screeningId}` — record a match disposition (true match / false positive) with analyst ID
- `GET /monitoring/alerts` — retrieve ongoing monitoring alerts for enrolled entities

## Notes
- Always log the list version and screening timestamp with each result — regulators expect evidence that the correct list version was in effect at the time of screening
- Confidence score thresholds for auto-pass vs. manual review should be set by your compliance officer; do not change thresholds without approval
- Adverse media screening is a separate entitlement from sanctions/PEP screening; confirm subscription scope
- Sandbox environment uses test entity profiles that return predictable match results; never run sandbox credentials against production lists
