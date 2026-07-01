---
name: usaspending
description: Public federal spending transparency API; lets agents retrieve award history, obligation data, and vendor spend benchmarks for budget and procurement research.
metadata: {"openclaw":{"requires":{"env":["USASPENDING_API_BASE_URL"]}}}
---

# USASpending.gov

## What it is
USASpending.gov is the official open-data source for U.S. federal spending, operated by the Department of the Treasury. It provides public access to contract awards, grants, loans, and sub-award data reported by federal agencies under the DATA Act and FFATA. Procurement and budget agents use it for market research, price benchmarking, and spending transparency reporting.

## When to use this skill
- Researching prior government award history for a vendor or NAICS/PSC code during market research
- Benchmarking prices by looking at historical award amounts for similar product/service categories
- Generating budget transparency reports showing agency obligation and outlay data
- Cross-checking agency internal obligation data against public disclosure records
- Identifying competitive vs. sole-source award rates for a commodity area

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `USASPENDING_API_BASE_URL` - base URL for the API (default: `https://api.usaspending.gov`)

> Note: USASpending.gov is a public API and does not require an API key for standard usage. No secret credentials are needed.

## Key operations
- `POST /api/v2/search/spending_by_award/` — search awards by keyword, vendor, NAICS, PSC, agency, fiscal year, and award type
- `GET /api/v2/awards/{award_id}/` — retrieve full details for a specific award by internal award ID or PIID
- `POST /api/v2/references/recipients/` — look up recipient (vendor) details and award history by UEI or name
- `POST /api/v2/agency/{toptier_code}/budget_function/` — get agency spending by budget function and fiscal year
- `GET /api/v2/references/naics/` — retrieve NAICS code hierarchy for category filtering
- `POST /api/v2/download/awards/` — request a bulk download of award data matching filter criteria

## Notes
- No authentication is required; the API is fully public and rate-limited by IP.
- Default rate limit: 100 requests/minute per IP; bulk download requests count separately.
- Data in USASpending reflects reported obligations; there is typically a 30-90 day lag in sub-award reporting.
- Always note the fiscal year scope when presenting spending figures; partial-year comparisons can be misleading.
