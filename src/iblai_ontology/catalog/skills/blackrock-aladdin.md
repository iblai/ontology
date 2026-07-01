---
name: blackrock-aladdin
description: BlackRock Aladdin risk and portfolio management platform; lets an agent query VaR, factor exposures, stress test scenarios, risk limit utilization, and performance attribution across multi-asset portfolios.
metadata: {"openclaw":{"requires":{"env":["ALADDIN_API_KEY","ALADDIN_BASE_URL","ALADDIN_CLIENT_ID"]}},"primaryEnv":"ALADDIN_API_KEY"}
---

# BlackRock Aladdin

## What it is
BlackRock Aladdin is the enterprise risk and portfolio management operating system used by asset managers, insurance companies, and pension funds worldwide. It provides factor-based risk decomposition, VaR and CVaR analytics, stress testing, performance attribution, compliance monitoring, and order management. Aladdin processes trillions in assets and is a foundational infrastructure component for institutional investment operations.

## When to use this skill
- Retrieve portfolio-level VaR, CVaR, tracking error, beta, duration, and DV01
- Run or retrieve results from standard or custom stress scenarios
- Access factor return decomposition — systematic vs. idiosyncratic alpha breakdown
- Check risk limit utilization and retrieve breach records
- Pull performance attribution (Brinson-style allocation/selection/interaction effects)
- Retrieve live portfolio positions and exposures for pre-trade risk checks

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `ALADDIN_API_KEY` - Aladdin API key issued by BlackRock Aladdin Client Services
- `ALADDIN_BASE_URL` - Aladdin API base URL (e.g. `https://api.aladdin.blackrock.com`)
- `ALADDIN_CLIENT_ID` - Client identifier assigned by BlackRock

## Key operations
- `GET /portfolios/{portfolioId}/risk` — retrieve risk decomposition (VaR, tracking error, factor contributions)
- `GET /portfolios/{portfolioId}/stress-tests` — retrieve stress scenario results for a portfolio
- `GET /portfolios/{portfolioId}/attribution` — retrieve performance attribution report
- `GET /portfolios/{portfolioId}/positions` — retrieve current holdings and exposures
- `GET /risk-limits/{limitId}` — retrieve limit utilization and breach status
- `POST /scenarios` — submit a custom scenario definition and retrieve estimated P&L impact

## Notes
- Aladdin API access requires a signed data use agreement with BlackRock; access is granted per client and per environment
- Risk calculations are typically run in overnight batch cycles; real-time risk requires the Aladdin Risk on-demand endpoint and may incur additional licensing cost
- Position data is as-of the last portfolio snapshot; ensure freshness is acceptable for the use case before acting on values
- Aladdin environments: `qa` (sandbox) and `prod` have separate API keys and base URLs
