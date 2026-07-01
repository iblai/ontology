---
name: morningstar-direct
description: Morningstar Direct investment research and data platform; lets an agent retrieve fund ratings, ESG scores, performance data, peer universe comparisons, and holdings for advisor due diligence and portfolio construction.
metadata: {"openclaw":{"requires":{"env":["MORNINGSTAR_CLIENT_ID","MORNINGSTAR_CLIENT_SECRET","MORNINGSTAR_BASE_URL"]}},"primaryEnv":"MORNINGSTAR_CLIENT_ID"}
---

# Morningstar Direct

## What it is
Morningstar Direct is the institutional investment research and data platform used by asset managers, wealth management firms, and investment consultants. It provides comprehensive mutual fund and ETF data including star ratings, analyst ratings, ESG sustainability scores, fee data, peer category rankings, and underlying holdings. The client advisory and portfolio analysis agents use it for manager due diligence, suitability analysis, and portfolio construction.

## When to use this skill
- Retrieve Morningstar star rating, analyst rating, and sustainability rating for a fund
- Pull fund performance data: total return, category rank, alpha, beta, Sharpe ratio by period
- Run Portfolio X-Ray to analyze holdings overlap between funds in a proposed portfolio
- Compare a fund against its peer universe by category and time horizon
- Access Morningstar style box and factor exposure for external manager analysis
- Retrieve expense ratio, AUM, inception date, and benchmark assignment for due diligence

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `MORNINGSTAR_CLIENT_ID` - Morningstar Direct API OAuth2 client ID
- `MORNINGSTAR_CLIENT_SECRET` - Morningstar Direct API OAuth2 client secret
- `MORNINGSTAR_BASE_URL` - API base URL (e.g. `https://direct.morningstar.com/api`)

## Key operations
- `GET /securities/{secId}/snapshot` — retrieve key fund data points (rating, return, expense ratio, AUM)
- `POST /securities/screener` — run a universe screen with fundamental or rating criteria
- `GET /securities/{secId}/performance` — retrieve trailing and calendar-year return data by period
- `GET /securities/{secId}/holdings` — retrieve fund holdings with weights, sectors, and countries
- `POST /portfolios/xray` — submit a portfolio of funds and retrieve holdings overlap and risk analytics
- `GET /securities/{secId}/sustainability` — retrieve ESG risk score and controversy rating

## Notes
- Morningstar Direct API requires an active Direct license; data entitlements (e.g. sustainability, institutional ratings) are provisioned separately
- Data is updated on Morningstar's publishing schedule — daily for pricing, monthly for portfolio holdings; do not assume intraday freshness
- Portfolio X-Ray is computationally intensive; avoid submitting portfolios with more than 50 funds in a single request
- Morningstar provides a sandbox environment with anonymized data; confirm sandbox base URL with your Morningstar account representative
