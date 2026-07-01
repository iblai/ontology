---
name: splunk
description: Splunk SIEM platform; lets an agent query authentication logs, endpoint events, and network activity to investigate security incidents, correlate fraud signals, and support threat hunting.
metadata: {"openclaw":{"requires":{"env":["SPLUNK_BASE_URL","SPLUNK_API_TOKEN","SPLUNK_APP"]}},"primaryEnv":"SPLUNK_API_TOKEN"}
---

# Splunk

## What it is
Splunk is the leading Security Information and Event Management (SIEM) platform deployed in financial services firms to aggregate, index, and search log data from authentication systems, endpoints, network infrastructure, and applications. The IT Help Desk and Fraud Detection agents use it to correlate login anomalies, failed authentication attempts, device change events, and suspicious transaction activity into coherent investigation timelines.

## When to use this skill
- Query authentication logs to identify failed logins, impossible travel, or concurrent session anomalies
- Retrieve device change events (new device registered, password reset) correlated with suspicious transactions
- Pull IP geolocation data to validate whether a transaction originated from an expected location
- Investigate endpoint security alerts flagged by CrowdStrike Falcon by correlating with network and auth logs
- Support fraud case investigations with authentication and access event timelines
- Run threat hunting searches across log sources for indicators of compromise

## Credentials
This skill authenticates using env vars declared in `metadata` above. Set them in `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `SPLUNK_BASE_URL` - Splunk REST API base URL (e.g. `https://splunk.yourfirm.com:8089`)
- `SPLUNK_API_TOKEN` - Splunk authentication token (preferred over username/password)
- `SPLUNK_APP` - Splunk app context for searches (e.g. `search` or `financial_crime`)

## Key operations
- `POST /services/search/jobs` — submit a Splunk search job (SPL query)
- `GET /services/search/jobs/{sid}/results` — retrieve search results once job is complete
- `GET /services/search/jobs/{sid}` — poll job status (isDone, eventCount, scanCount)
- `POST /services/search/jobs/export` — stream results for large result sets
- `GET /services/saved/searches` — list saved searches / correlation rules available in the app
- `POST /services/receivers/simple` — send an event to Splunk HTTP Event Collector (HEC)

## Notes
- Splunk searches can be resource-intensive; use time-bounded queries and index constraints (e.g. `index=auth`) to avoid full-scan overhead
- Token-based auth (`Authorization: Bearer <token>`) is strongly preferred; username/password Basic Auth should be disabled in production
- Search jobs are asynchronous — poll the job status endpoint until `isDone=true` before fetching results
- PII in log data (usernames, account numbers) is subject to data retention and access policies; confirm with the CISO before extracting to external stores
