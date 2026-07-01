---
name: bloomberg-terminal
description: Bloomberg's financial data platform; lets an agent fetch real-time and historical price data, volatility surfaces, rates curves, credit spreads, and sell-side research via the Bloomberg API.
metadata: {"openclaw":{"requires":{"env":["BLOOMBERG_API_HOST","BLOOMBERG_API_PORT","BLOOMBERG_DATA_LICENSE_KEY"]}},"primaryEnv":"BLOOMBERG_API_HOST"}
---

# Bloomberg Terminal

## What it is
Bloomberg Terminal (accessed programmatically via the Bloomberg API / BPIPE or the Bloomberg Data License) is the primary market data and research platform for capital markets professionals. It provides real-time pricing, historical time series, volatility surfaces, rates curves, credit spreads, earnings data, and sell-side research notes across all asset classes.

## When to use this skill
- Retrieve real-time or historical prices, bid/ask spreads, or total return data for equities, fixed income, FX, or commodities
- Pull interest rate curves, volatility surfaces, or credit spread term structures for risk or scenario analysis
- Access sell-side research notes, sector primers, or earnings estimates by ticker
- Fetch corporate action data, dividend schedules, or index constituent weights
- Support stress scenario construction with cross-asset market data inputs
- Troubleshoot Bloomberg Terminal connectivity or BPIPE API issues for staff

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `BLOOMBERG_API_HOST` - Bloomberg API server hostname or IP (e.g. `localhost` for BPIPE)
- `BLOOMBERG_API_PORT` - BPIPE service port (default `8194`)
- `BLOOMBERG_DATA_LICENSE_KEY` - Data License credential for server-side B-PIPE or DL access

## Key operations
- `ReferenceDataRequest` — snapshot field values for one or more securities (price, rating, fundamentals)
- `HistoricalDataRequest` — time-series data for a security and field over a date range
- `IntradayTickRequest` / `IntradayBarRequest` — intraday tick or OHLCV bar data
- `FieldSearchRequest` — discover available Bloomberg fields by mnemonic or keyword
- Bloomberg Data License bulk extract — overnight delivery of large datasets (constituents, index weights)

## Notes
- BPIPE requires a Bloomberg Terminal or server-side license; an active B-PIPE session must be running on the host
- Data License (DL) is the server-side bulk delivery product — different from BPIPE; separate entitlements apply
- Bloomberg enforces concurrent session limits per license; avoid spawning parallel request threads without connection pooling
- Test connectivity with `blpapi` Python SDK `SessionOptions` before issuing data requests
- All data retrieved via Bloomberg is subject to Bloomberg's redistribution restrictions — do not write raw output to unauthenticated endpoints
