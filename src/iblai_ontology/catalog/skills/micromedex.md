---
name: micromedex
description: Micromedex (Merative/IBM) — lets an agent perform drug interaction screening, dose range checking, toxicology lookups, and IV compatibility queries using the Micromedex drug knowledge base.
metadata: {"openclaw":{"requires":{"env":["MICROMEDEX_API_KEY","MICROMEDEX_BASE_URL","MICROMEDEX_FACILITY_ID"]}},"primaryEnv":"MICROMEDEX_API_KEY"}
---

# Micromedex

## What it is
Micromedex is a comprehensive clinical drug information platform widely deployed in hospital pharmacies and EHR environments. It covers drug-drug interactions, drug-allergy cross-reactivity, adult and pediatric dosing (including renal and hepatic adjustments), toxicology, and IV compatibility data. The REST API is used by clinical support and knowledge management agents to surface drug safety information at the point of care or formulary review.

## When to use this skill
- Screen a patient's medication list for drug-drug interactions before adding a new medication
- Look up dose range (adult, pediatric, renal-adjusted, hepatic-adjusted) for a specific drug and indication
- Check IV compatibility between two or more medications in the same line or bag
- Retrieve toxicology data (overdose management, antidotes) for a suspected ingestion
- Support formulary decision-making by comparing drug classes and therapeutic alternatives

## Credentials
This skill authenticates using variables declared in the metadata above. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and fill in real values. Required variables:
- `MICROMEDEX_API_KEY` - facility-level API key issued with the Micromedex license (Merative customer portal)
- `MICROMEDEX_BASE_URL` - API base URL (e.g., `https://api.micromedexsolutions.com/micromedex/v1`)
- `MICROMEDEX_FACILITY_ID` - facility identifier for license entitlement validation

## Key operations
- `GET /interaction?drugs={rxnorm1},{rxnorm2}` — drug-drug interaction check returning severity (contraindicated/major/moderate/minor), mechanism, and management
- `GET /drug/{rxnorm}/dosing` — dosing by indication, route, frequency, and patient population
- `GET /drug/{rxnorm}/monograph` — full drug monograph including class, indications, contraindications, adverse effects
- `GET /iv-compatibility?drugs={drugList}` — IV compatibility result (compatible/incompatible/uncertain) for listed agents
- `GET /toxicology/{substance}` — toxic dose thresholds, clinical effects, antidote, and treatment protocol
- `GET /allergy-crossreactivity?allergen={substance}&drug={rxnorm}` — cross-reactivity assessment

## Notes
- Interaction severity levels: use `contraindicated` as a hard stop; `major` requires prescriber acknowledgment; `moderate`/`minor` are advisory.
- Rate limit: 120 requests/min per facility API key.
- RxNorm codes are the preferred drug identifier; NDC codes are also accepted.
- Pediatric dosing requires patient weight (kg) and age as query parameters; include these when available.
- License includes access to IBM/Merative sandbox with synthetic drug data for development and testing.
