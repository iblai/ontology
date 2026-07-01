---
name: factset
description: FactSet financial data and research platform; lets an agent retrieve equity fundamentals, earnings estimates, sell-side research, sector classifications, and benchmark data for investment analysis and reporting.
metadata: {"openclaw":{"requires":{"env":["FACTSET_API_KEY","FACTSET_API_SECRET","FACTSET_BASE_URL"]}},"primaryEnv":"FACTSET_API_KEY"}
---

# FactSet

## What it is
FactSet is an integrated financial data and analytics platform used by buy-side and sell-side professionals for fundamental equity research, portfolio analytics, and risk management. It aggregates data from thousands of global sources including company financials, consensus estimates, broker research, ownership data, and index constituents. In this segment, FactSet serves the client advisory, portfolio analysis, and risk assessment agents as a primary data backbone.

## When to use this skill
- Retrieve equity fundamentals: revenue, EPS, P/E, EV/EBITDA, debt/equity, dividend yield
- Pull consensus earnings estimates and earnings calendar entries by ticker
- Access sell-side research reports, analyst ratings, and price targets
- Retrieve GICS sector and industry classification for portfolio construction or attribution
- Pull benchmark index constituents and weights for tracking error or active share analysis
- Run custom security screening on fundamental or estimate criteria

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `FACTSET_API_KEY` - FactSet API key (username-serial format, e.g. `USERNAME-SERIAL`)
- `FACTSET_API_SECRET` - FactSet API secret / password
- `FACTSET_BASE_URL` - API base URL (e.g. `https://api.factset.com/content`)

## Key operations
- `POST /factset-fundamentals/v2/fundamentals` — retrieve fundamental data for a list of securities
- `POST /factset-estimates/v2/consensus-estimates` — pull consensus EPS/revenue estimates by period
- `POST /factset-estimates/v2/rolling-estimates` — retrieve rolling 12-month estimate series
- `GET /factset-prices/v1/prices` — fetch historical or current price data
- `POST /factset-security-research/v1/research` — retrieve research reports by security or analyst
- `POST /factset-benchmarks/v1/constituents` — pull index constituent weights and returns

## Notes
- FactSet API uses HTTP Basic Auth with the API key as username and secret as password; some endpoints additionally require an OAuth2 bearer token
- Rate limits vary by endpoint tier; core data endpoints allow ~10 requests/second; analytics endpoints may be lower
- FactSet environment URLs: production uses `api.factset.com`; a developer sandbox is available at `api-sandbox.factset.com`
- Data entitlements are enforced at the API layer — a 403 on a specific dataset indicates a missing content subscription, not an auth failure
